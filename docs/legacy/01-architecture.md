# Legacy Architecture

## The module inventory

17 executables and 14 DLLs ship in `app/`. Grouped by role:

### Live-service modules (the ones that matter to you)

| Module | Self-description (from its own version resource) | Role |
|---|---|---|
| `SongLeader.exe` | *"A tool for song and worship leaders"* | **Control surface.** Builds/loads a song set, decides what everyone else sees. Acts as the TCP **server**. |
| `SongFollower.exe` | *"A tool for song and worship group members"* | **Band member view.** Sees the leader's set; can navigate independently without affecting anyone. |
| `SongSlave.exe` | — | **Slaved display.** Follows the leader exactly. Fullscreen, profile-driven. This is what feeds a stage monitor. |
| `SongViewer.exe` | — | **Standalone song/file viewer.** Opens `.song`/`.sng` files directly, MDI, printable. Not networked. |
| `SongMonitor.exe` | *"A tool for tracing and monitor SongLeader network activity"* | **Protocol debugger.** Logs leader traffic. |

### Presentation modules

| Module | Role |
|---|---|
| `Presenter.exe` | Full projection console — playlists, Bible passages, images, video, PowerPoint, alerts, transitions. Drives `Projector.exe`. |
| `PresenterFollower.exe` | Read-only follower of the Presenter; can auto-save the songs that go live. |
| `Projector.exe` *(nested installer)* | The actual fullscreen output window. One instance per physical screen. Controlled purely over a network API. |
| `ProjectorPlayer.exe`, `TestProjector.exe` *(nested)* | Media playback helper and a CLI test harness. |

### Authoring / data modules

| Module | Role |
|---|---|
| `SongEditor.exe` | Song authoring: lyrics, chords, sections, sequence, metadata. |
| `SongDatabaseManager.exe` | Browse/organise the song library (list with Title, Last Modified, sortable). |
| `BibleDatabaseManager.exe` | Bible import/management — full 66-book list is compiled in. |
| `ProfileEditor.exe` | Edits **display profiles** (`.sdp`) — the rendering rules per context. |
| `SNGsetup.exe` / `SNGusersetup.exe` | Install-time and per-user setup wizard: data folders, licence keys, database backend. |

### Support modules

| Module | Role |
|---|---|
| `IPDSServer.exe` *(nested)* | **Inter-Program Discovery Server.** A background service holding a registry of "adverts" (which program is running where, on what port). |
| `IPDSMonitor.exe`, `ListAdverts.exe`, `ShutdownIPDSServer.exe`, `lookuphost.exe` *(nested)* | Discovery diagnostics. |

### Shared libraries

`SongBase.dll` (data model + XML + licensing), `SongWndBase.dll` (song rendering view),
`ProjectorBase.dll`/`ProjectorClient.dll` (projection API), `IPDSBase.dll` (discovery
client), `db_umt.dll` (SQLite **and** MySQL — `DBSqliteDatabase.cpp`,
`DBMySqlDatabase.cpp`, `DBOpenConnectivityDatabase.cpp`), `xml_umt.dll`, `swift_umt.dll`,
`util_umt.dll`, `cbase_umt.dll`, `CxImageMfcDll.dll`, `MfcExt.dll`, `WndExt.dll`.

---

## How the pieces talk to each other

```
                    ┌──────────────────────┐
                    │  IPDSServer.exe      │  registry of "adverts":
                    │  (discovery daemon)  │  name → hostname, ipaddr, port
                    └──────────┬───────────┘
                     advertise │ │ query
             ┌─────────────────┘ └──────────────────┐
             │                                      │
   ┌─────────▼──────────┐              ┌────────────▼─────────────┐
   │   SongLeader.exe   │              │  SongFollower / SongSlave │
   │   TCP server       │◄─────────────┤  SongMonitor / Presenter  │
   │   + licence source │  TCP, push   │  "SongLeaderListener"     │
   └────────────────────┘              └───────────────────────────┘
             │
             │ ProjectorClient (separate network API)
             ▼
   ┌────────────────────┐
   │   Projector.exe    │  one per screen, fullscreen output
   └────────────────────┘
```

### Discovery — the IPDS layer

`IPDSBase.dll` exports the whole client surface, which tells us the design exactly:

```
AdvertClient::connect(host, port)          AdvertNotifyClient::connect(host, port, port)
AdvertClient::getAdverts(SWArray<SWAdvert>&)   AdvertNotifyClient::waitForNotification(SWMsg&)
AdvertClient::sendAndReceive(SWMsg&, int)      AdvertNotifyClient::processNotification(SWMsg&)
AdvertClient::getVersionInfo(SWString&)
AdvertClient::shutdownServer()
SWAdvert::hostname() / ipaddr() / port()
```

So: a **central TCP registry**, not multicast. Programs register an advert (name +
host + ip + port); clients either poll `getAdverts()` or hold a notify socket open and
get pushed `Added leader: …` / `Removed leader: …` events. Log strings confirm both:

```
AdvertListener: started / stopped
AdvertListener: can't bind socket - waiting to retry
Got advert: %s (%s) from %s
Failed to connect to advert server on %s at port %d
There are no active adverts
```

Transport is `SWTcpSocket` + `SWMsgSocket` (a length-framed message socket) — **TCP only,
no UDP broadcast anywhere in the binaries.**

> ⚠️ **This is the legacy design's biggest weakness.** Discovery depends on a separate
> daemon process being alive and reachable at a known host. When it isn't, nothing finds
> anything. The replacement should use real zero-config discovery (mDNS/Bonjour) or a
> QR-code/short-URL join flow instead.

### Leader ↔ follower session

`SongWndBase.dll` / the follower binaries contain a `SongLeaderListener` thread. Its log
strings spell out the lifecycle:

```
SongLeaderListener - starting
SongLeaderListener - no connection - sleeping
SongLeaderListener - Sucessfully connected to %s (%s) on port %d
SongLeaderListener - Success - setting TCP No Delay
SongLeaderListener - got message but no notify window active
SongLeaderListener - socket receive failed
SongLeaderListener - Disconnected from %s (%s) on port %d
SongLeaderListener - Failed - closing socket
SongLeaderListener - stopping
```

UI-facing states, from the same binaries:

```
Waiting for connection to leader...
Connecting to leader: 
Connected to leader
Lost connection to leader
Waiting to acquire licence from leader...
```

Notes:

- **TCP_NODELAY is set explicitly** — latency matters; the leader pushes state changes
  that must land on stage displays immediately.
- **The leader is also the licence authority.** Followers block on
  *"Waiting to acquire licence from leader…"*. A pure copy-protection mechanism — drop it.
- Multiple leaders can coexist on one network; clients pick one
  (`SelectLeader`, `PreferredSongLeader`, `SelectLeaderTimeout`,
  *"\nPlease select the song leader from the following list. (%d)\n"*).
  There is a countdown-with-default selection dialog.

### Payload format

The leader does not send an opaque binary blob. `SongBase.dll` exports
`Song::loadFromXmlString(SWWString&)` and `SongBase::encloseXml(...)`, and the same
class does duty for file load and wire load. **The wire payload is the song XML**
(see `02-data-model.md`), wrapped in framed messages.

### Projection

`Projector.exe` is deliberately decoupled: *"a standalone module which can be used by
other software modules in the SwiftTec family to show text, images and media in a window…
The display is controlled via a network based API."* It is driven entirely by CLI/network
commands (`--text`, `--bgcolor`, `--bgimage`, `--freeze`, `--black`, `--fullscreen`,
`--display`, `--rect`, `--halign`, `--valign`, `--media-play`, `--ppt-next`, …).

`Presenter.exe` auto-starts local projectors (`AutoStartLocalProjectors`) and tracks
`No Active Displays` / `Projector software not installed on this computer`.

---

## Data locations and settings

Configured by `SNGsetup.exe`, stored under the registry key family
`Software/SwiftTec/…` (`Presenter/DisplayConfig`, `DisplayConfig/SongLeader`,
`ProfileEditor/DisplayConfig`, `presenter/options`, `presenter/filetypes`, `options/`):

```
DataDir              UserDataDir          LogFilesDir
SongDatabaseDir      BibleDatabaseDir     ImageDatabaseDir
MediaDatabaseDir     DisplayProfilesDir   InstallDir
```

The song library is a **folder of files**, indexed — `SongDatabase::importFolder()`,
`importFile()`, `SongDBFileEntry`. `db_umt.dll` bundles a full SQLite engine (and a
MySQL client), so the index is a database, but the songs themselves live as XML files
on disk. Good news for migration: your songs are plain `.song` XML, not locked in a blob.

File types in play:

| Extension | Contents |
|---|---|
| `.song` | One song, XML |
| `.songset` / `.sst` | An ordered service set |
| `.songbundle` | Multiple songs in one file |
| `.sdp` | Display profile |
| `.playlist` | Presenter playlist |
| `.book` | Bible book |
| `.sng` | *Presentation Manager Pro* import format |
| `.txt`, OpenSong | Other supported import formats |

Known shipped profiles: `SongViewerChords.sdp`, `SongViewerLargePrint (Screen).sdp`,
`SongViewerLargePrint (Print).sdp`, `SongEditor.sdp`, `PresenterFollower.sdp`.
