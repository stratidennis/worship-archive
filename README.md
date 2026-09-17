# Worship Archive

A browser-based replacement for the SwiftTec Song Management System — the Windows suite
the band currently uses to lead worship. Offline-first, LAN-hosted, packaged as an
Electron desktop app.

**Phases 0–5 are built.** Library and search, the fit-to-one-screen song view, the song
editor, service sets, and the live session all work against the real 153-song
collection. Offline support, discovery and the Electron package are next — see
[`PLAN.md`](PLAN.md).

During a service:

| Route | Who |
|---|---|
| `/lead` | the leader — drives everyone, Auto or Manual |
| `/band` | musicians — follow, or break away to check the bridge |
| `/stage` | a TV or monitor — follows exactly, no controls |

## Running it

```bash
pnpm install
pnpm migrate --in "~/Downloads/Song Files" --out ./data   # one time, from .song XML
WORSHIP_DATA="$PWD/data" pnpm dev                          # server on 7374, UI on 7373
```

Then open `http://localhost:7373`, or `http://<your-lan-ip>:7373` from any device on the
same WiFi. The migration prints three verification gates and writes a report; all three
must pass before it writes anything.

## Read in this order

| | |
|---|---|
| [`PLAN.md`](PLAN.md) | **The build plan** — architecture, data model, sync protocol, phased delivery |
| [`docs/FEATURE-INVENTORY.md`](docs/FEATURE-INVENTORY.md) | **The scope contract** — every feature, keep/drop/change, all decisions taken |
| [`docs/legacy/`](docs/legacy/) | Reverse-engineering of the old Windows suite + analysis of the real 153-song library |

## What it will be

One React app, three ways to run it:

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

Imports: ChordPro, plain text pasted from a website, OpenSong XML, and the legacy `.song`
files.

## Two non-negotiables

**The whole song fits on one screen.** No pagination, no scrolling mid-song. Text
auto-scales to fill the available space, using multiple columns when that helps. This is
the behaviour of the old app people rely on, and it drives the renderer's design.

**It works with no internet, ever.** No CDNs, no external fonts, no licence check.

## The two biggest improvements over the old system

1. **Written key vs performance key as real fields.** Today the chords are written in one
   key and played in another, with the gap recorded in a text comment, in the filename,
   *and* sometimes crammed into the key field as `C-D`. Three hand-made conventions for
   one missing field. Making both real removes all three.

2. **Typed cue blocks instead of 303 free-text notes.** `INTRO:`, `INSTRUMENTAL:`,
   `SOLO Dennis:`, `STRUCTURA: Strofa -> Refren x2` are hand-typed because the old model
   had nowhere to put them. They become first-class blocks and an arrangement strip.

Both were found by analysing the actual song library rather than the old feature list —
see [`docs/legacy/04-real-library-analysis.md`](docs/legacy/04-real-library-analysis.md).
