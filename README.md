# Worship Archive

A browser-based replacement for the SwiftTec Song Management System — the Windows suite
the band currently uses to lead worship. Offline-first, LAN-hosted, packaged as an
Electron desktop app for Windows and macOS.

**All nine phases are built.** Library and search, the fit-to-one-screen song view, the
song editor, service sets, the live session, the offline mirror, the desktop package and
the polish pass all work against the real 153-song collection.

Joining: open `/join` on the host for a QR code. Every device also keeps its own copy of
the library, so it still works at home with nothing to connect to.

During a service:

| Route    | Who                                                   |
| -------- | ----------------------------------------------------- |
| `/lead`  | the leader — drives everyone, Auto or Manual          |
| `/band`  | musicians — follow, or break away to check the bridge |
| `/stage` | a TV or monitor — follows exactly, no controls        |

## Running it in a browser

This is the fast path, and the one to use while changing anything: no packaging step, hot
reload, and every device on the WiFi can reach it.

```bash
pnpm install
pnpm migrate --in "~/Downloads/Song Files" --out ./data   # one time, from .song XML
WORSHIP_DATA="$PWD/data" pnpm dev                          # server on 7374, UI on 7373
```

Then open `http://localhost:7373`, or `http://<your-lan-ip>:7373` from any phone or
tablet on the same WiFi. The migration prints three verification gates and writes a
report; all three must pass before it writes anything.

**The desktop app is the same web app in a window.** Nothing is desktop-only except the
native file dialogs and the tray icon, so a change made here is a change made everywhere
— there is no need to rebuild the installer to try something.

## Running the desktop app

```bash
pnpm abi:electron     # better-sqlite3 has to match Electron's ABI — see below
pnpm dev:desktop      # builds the UI, bundles the main process, launches Electron
pnpm abi:node         # switch back before running the tests
```

There is one copy of the `better-sqlite3` native addon and Node and Electron want
different ABI versions of it, so `pnpm test` and `electron .` cannot both work at the
same moment. `pnpm abi:node` / `pnpm abi:electron` switch between them in a few seconds
and verify the result rather than trusting the rebuild's own report. Run
`node tools/src/native-abi.mjs` with no argument to see which one is installed. CI never
needs this — the test job and the packaging job are different machines.

## Building the installers

They are built by GitHub Actions, not locally: **Actions → Desktop builds → Run
workflow** produces a Windows `.exe` and a macOS `.dmg` (Apple Silicon and Intel) as
downloadable artifacts. Pushing a `v*` tag does the same and opens a draft release.

Locally, if you want one:

```bash
pnpm abi:electron
pnpm --filter @worship/desktop dist
```

The builds are not signed with a publisher certificate — there is no Apple developer
account or Windows certificate behind this. The macOS bundle is fully ad-hoc signed so
Gatekeeper can verify its integrity, but it is not Apple-notarised. Windows SmartScreen
needs _More info → Run anyway_. On macOS, right-click the app and choose _Open_ the
first time; if it is still blocked, try once and then use _System Settings → Privacy &
Security → Open Anyway_.

## Read in this order

|                                                          |                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [`PLAN.md`](PLAN.md)                                     | **The build plan** — architecture, data model, sync protocol, phased delivery        |
| [`docs/FEATURE-INVENTORY.md`](docs/FEATURE-INVENTORY.md) | **The scope contract** — every feature, keep/drop/change, all decisions taken        |
| [`docs/legacy/`](docs/legacy/)                           | Reverse-engineering of the old Windows suite + analysis of the real 153-song library |

## One app, three ways to run it

- **Host** — Electron app on the leader's laptop. Runs the server, serves everyone else.
- **Client** — any phone, tablet or laptop on the same WiFi, in a browser. No install.
- **Standalone** — the same app at home with no server at all, full library cached offline.

No internet required at any point.

## Songs are stored as ChordPro

Each song is a plain-text `.chopro` file — the de-facto standard, readable by OnSong,
SongBook, Chordii, MobileSheets, Planning Center and any text editor. SQLite exists only
as a disposable search index, rebuildable from the files at any time.

```
{title: Bunatatea Ta}
{key: G}
{x_performance_key: Bb}
{start_of_verse}
Eu Te iu[G]besc, mila [C]Ta e nesfâr[G]șită
```

Anything ChordPro can't express — the bass-note layer, per-line singers, labelled cues —
goes in `{x_*}` directives that other tools safely ignore. **Nothing is ever locked in.**

**Importing** takes ChordPro, OpenSong XML, the legacy `.song` files, and plain
chords-over-lyrics text pasted from anywhere on the web. The format is detected from the
content rather than the extension, and every file is shown with what was understood from
it — sections, chords, key — before anything is saved.

**Backups** are one JSON file holding the _source text_ of every song and set, not the
parsed model: a backup made today still restores in five years, whatever the parser has
become. Settings → Backup.

## Two non-negotiables

**The whole song fits on one screen.** No pagination, no scrolling mid-song. Text
auto-scales to fill the available space, using multiple columns when that helps. This is
the behaviour of the old app people rely on, and it drives the renderer's design.

**It works with no internet, ever.** No CDNs, no external fonts, no licence check. The
app shell is precached by a service worker and the library is mirrored into IndexedDB,
so a device with no host reachable still opens, searches and transposes.

## The two biggest improvements over the old system

1. **Written key vs performance key as real fields.** Today the chords are written in one
   key and played in another, with the gap recorded in a text comment, in the filename,
   _and_ sometimes crammed into the key field as `C-D`. Three hand-made conventions for
   one missing field. Making both real removes all three.

2. **Typed cue blocks instead of 303 free-text notes.** `INTRO:`, `INSTRUMENTAL:`,
   `SOLO Dennis:`, `STRUCTURA: Strofa -> Refren x2` are hand-typed because the old model
   had nowhere to put them. They become first-class blocks and an arrangement strip.

Both were found by analysing the actual song library rather than the old feature list —
see [`docs/legacy/04-real-library-analysis.md`](docs/legacy/04-real-library-analysis.md).

## Romanian and English

The interface is Romanian by default and switches to English in Settings, including the
section headings above the lyrics and the plural rules — 153 songs is _153 de cântări_,
not _153 cântări_. The English dictionary is typed against the Romanian one, so a missing
translation fails the build rather than reaching a musician mid-service.
