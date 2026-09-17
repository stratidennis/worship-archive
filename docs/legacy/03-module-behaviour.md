# Legacy Module Behaviour & UI

The MFC menus are mostly boilerplate — the real UI is custom-drawn toolbars. Their
captions are not in the binaries but in `app/resources/SongBase.ini`, which is
effectively the app's UI manifest. `\n` in a caption is a line break on a two-line button.

---

## SongLeader — the control surface

### Toolbar (verbatim from `SongBase.ini [buttons]`)

```
New              Open            Load           Save          Save As        Print
Add\nSong        Add Song\nFrom File            Add Song\nFrom DB
Delete\nSong
Transpose\nDown  Transpose\nUp   Capo\nDown     Capo\nUp
Updates:\nAuto   Updates:\nManual
Mode:\nBlock     Mode:\nSong
Select\nProfile  Select\nLeader
Clear\nText      Blackout
Edit\nSequence   Save\nSequence
Edit\nSong       Edit Song\nIn DB   Edit Song\nIn Set
Create New Song  Create Song\nIn DB Create Song\nIn Set
Set\nTempo       Reset\nTempo
Show\nSong List  Hide\nSong List
```

### What each control does

| Control | Behaviour |
|---|---|
| **Updates: Auto / Manual** | The killer feature. In **Auto**, moving the leader's cursor pushes immediately to every display. In **Manual**, the leader can scroll ahead and browse privately; nothing goes live until they commit. Lets a leader line up the next song mid-worship without flashing it on screen. |
| **Mode: Block / Song** | **Song** mode pushes the whole song; **Block** mode pushes one section (block) at a time — projection-style, one verse on screen. `SongSlave` has a matching `Block Mode` + `Show Block Highlights` toggle. |
| **Clear Text** | Blank the lyrics but keep the background. |
| **Blackout** | Kill the output entirely. Distinct from Clear Text. |
| **Transpose ↑/↓, Capo ↑/↓** | Independent. Transpose changes the written key; capo changes guitar fingering. Applied live, propagated to followers. |
| **Set / Reset Tempo** | Drives the beat LED metronome on all connected displays. |
| **Edit Sequence / Save Sequence** | Re-order the song's sections live, mid-service. |
| **Select Profile** | Switch the rendering profile in use. |
| **Select Leader** | Pick which leader to follow (relevant for the follower-ish apps and when several leaders run). |
| **Show / Hide Song List** | Collapse the set list to maximise lyric area. |
| **Add Song From File / From DB** | Two sources: loose files or the indexed library. |
| **Edit Song In DB / In Set** | Explicit choice: edit the library master, or only this service's copy. |

### Persisted state (`SongLeader.exe` strings)

```
SelectedProfile   SelectedSong    SelectedSongSet   SongFolder   SongSetFolder
LiveMode          BlockMode       Blackout          Tempo
songlistwidth     tempowidth      width/height/state/fullscreen
selectionFontName/Size/Style/Color[0..2]
selectionSelectedBgColor[0..2]   selectionUnselectedBgColor[0..2]
```

The `[0..2]` triples are three selection *levels* — almost certainly
current / next / other, rendered with different colours in the set list.

`SongSetNotSaved` → *"The current song set has changed. Do you want to save it?"*

---

## SongFollower — band member view

*"A tool for song and worship group members"*

Has the leader's toolbar vocabulary (`CapoUp`, `CapoDown`, `ClearText`, `Blackout`,
`Author`…) but **its navigation is local only**. It shows connection state in the UI:

```
Waiting for connection to leader...   Connecting to leader:    Connected to leader
Lost connection to leader             Waiting to acquire licence from leader...
```

This is the "same view as the leader, but moving around doesn't affect anyone" module
you remembered. It follows the leader's *set*, and by default the leader's *position*,
but the musician can break away to check the bridge chords and come back.

---

## SongSlave — the dumb slaved display

Right-click popup menu (its only UI):

```
Select Profile
Select Leader
─────────────
Block Mode
Show Block Highlights
─────────────
Exit
```

Command line:

```
--profile <name>   --highlight-blocks   --no-highlight-blocks
```

Settings: `BlockMode`, `BlockHighlights`. No decisions of its own — it renders whatever
the leader sends, in whatever profile it was told to use. This is the stage-monitor /
second-screen module.

---

## SongViewer — standalone viewer & printer

Not networked. MDI, opens `.song` and `.sng` directly.

### View modes (from menu 132)

```
Songsheet                    Songsheet with Chords
Songsheet with Bass Notes    Large Print Songsheet
OHP
Multi-Column                 Capo chords in brackets
```

`OHP` = overhead-projector layout (lyrics only, huge). "Multi-Column" reflows a long
song into columns to fit a page.

### Keyboard

| Action | Key |
|---|---|
| Transpose Up | `Shift+F4` |
| Transpose Down | `Shift+F3` |
| Capo Up | `F4` |
| Capo Down | `F3` |
| Print | `Ctrl+P` |
| Open | `Ctrl+O` |

Also: *Copy song text to clipboard*, Print Preview, full print pipeline.
Status text includes `Bass:` and `(with capo)`.

---

## SongEditor — authoring

Menus: File / Edit / View / Key / **Section** / **Line** / **Sequence** / Help.

| Action | Key |
|---|---|
| Guitar Chord | `F9` |
| Bass Note | `F10` |
| Song Information | `F2` |
| Sequence | `Ctrl+F2` |
| Section type Verse / Chorus / Bridge | `F6` / `F7` / `F8` |
| Pre-Chorus / Tag | `Shift+F7` / `Shift+F8` |
| Intro / Ending / Misc | `Shift+F6` / `Ctrl+F6` / `Ctrl+F8` |
| Transpose Up / Down | `Shift+F4` / `Shift+F3` |

Section submenu: Target, Type, Singers, Link/Unlink to previous, Repeat ±, Indent ±.
Line submenu: Singers, Repeat ±, Indent ±.

Custom cursors in `resources/` reveal the editing interaction model:

```
AddChord.cur   EditChord.cur   PointerStartOfLine.cur   PointerEndOfLine.cur
PointerSequence.cur   HandGrab.cur   HandGrabPlus.cur   HandPoint.cur   HandPointPlus.cur
```

— chords are placed by clicking into the lyric line, and sections are dragged.

---

## SongMonitor — protocol tracer

Popup menu: `Clear`, `Save Log`, `Select Leader`, `About`.
*"A tool for tracing and monitor SongLeader network activity"*. A developer/support tool.

---

## Presenter — the projection console

The largest module. Panes: **Playlist / Schedule**, **Item Selection**, **Selected Item**,
**Live Item**, **Display Control**.

Content types (`presenter/filetypes`): Songs, Bibles, Images, Video, Audio, Powerpoint,
Webpage, Text, Media, Alerts, Headers, Footers, Logos.

Display controls: background colour / background image / image mode, font, text colour,
outline colour + width, horizontal align (left/center/right), vertical align
(top/middle/bottom), wrap text, freeze, blackout, transitions (`TransitionType`,
`TransitionDuration`), `transitionblackout` / `transitioncleartext` / `transitionlogo` /
`transitiondefault`.

Media transport: play, pause, stop, next, previous, forward, reverse, volume up/down/mute.
PowerPoint: `--ppt-open`, `--ppt-next`, `--ppt-previous`, `--ppt-close`.

`PreferredSongLeader` + `leaderautoitem` — **the Presenter can follow the SongLeader**
and auto-advance its own live item to whatever the leader selects. That's the link
between the band's world and the congregation's projection.

State: `CurrentPlaylist.xml`, `LiveAutoSelect`, `AutoStartLocalProjectors`,
pane widths/heights.

---

## PresenterFollower

Popup menu:

```
Copy Song Text to Clipboard
View Song Information
Save Song as file
───────────────────────
Auto-Save Songs
Options...
```

Settings: `AutoSave`, `AutoSaveFolder`, `AutoSaveFileType`, `AutoSaveKeepFiles`,
`SelectionMode`, `SelectedProfile`. A passive observer that can archive the service.

---

## Projector — the output surface

Entirely CLI/network-driven. Full flag list recovered:

```
--display N        --rect x,y,w,h     --fullscreen / --no-fullscreen   --exclusive
--text …           --header …         --footer …
--fgcolor / --bgcolor / --fgimage / --bgimage / --bgimagemode / --local-bgimage
--halign / --valign
--freeze           --black            --black-trans     --trans      --off
--alert …
--media-open / --media-play / --media-pause / --media-stop
--ppt-open / --ppt-next / --ppt-previous / --ppt-close
--browser-open / --browser-close
--host / --port    --no-advertise     --status   --shutdown
--install / --uninstall / --release   --log   --test   --help
--no-load-position / --no-save-position
```

This is a clean, complete display API — worth mirroring in the new app's projector
route, even though the mechanism will be WebSocket rather than argv.

---

## Setup (`SNGsetup.exe`)

Wizard pages: Data Folders, Database, Devices, Licence.
Database backend is selectable (SQLite default, MySQL supported).
The Devices page is vestigial — it contains *Cash Drawer*, *Receipt Printer*,
*Door Release*, leaked in from a SwiftTec point-of-sale product sharing the same
wizard framework. Ignore it.

---

## Behaviours worth fixing in the rewrite

Observations from the artefacts, not from running the app — confirm against your own
experience of using it:

1. **Discovery is fragile by design** — a separate daemon holding a TCP registry, with
   retry loops (`can't bind socket - waiting to retry`, `no connection - sleeping`).
2. **Licence coupling** — followers block waiting to acquire a licence from the leader.
   Pure DRM; a network hiccup degrades worship. Gone in the rewrite.
3. **Blocking modal timeouts** — `SelectProfileTimeout` / `SelectLeaderTimeout` prompt
   with a countdown at startup. Should be silent auto-reconnect with a manual override.
4. **Reconnect is a sleep-poll loop** — no exponential backoff, no session resume. A
   follower that drops mid-song has to be re-established.
5. **Windows-only, per-machine install**, plus a VC++ redistributable. Every stage
   device needs an install. The browser rewrite removes this entirely.
6. **Two apps for one job** — SongFollower vs SongSlave differ only in whether local
   navigation is allowed. That is a *setting*, not a separate program.
7. **Naming** — "Slave" should not survive into the new app.
