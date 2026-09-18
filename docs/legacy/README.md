# Legacy System Documentation

Reverse-engineering of **SwiftTec Song Management System v1.0.41** (© SwiftTec 2010-13),
the Windows suite in `Song_Manager_Old/`, plus analysis of the real 153-song library.

Part of **Worship Archive** — see [`../../PLAN.md`](../../PLAN.md) for the replacement
design and [`../FEATURE-INVENTORY.md`](../FEATURE-INVENTORY.md) for the scope contract.

| Doc                                                        | Contents                                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| [00-extraction-report.md](00-extraction-report.md)         | What was in the installers, what was recovered, why the C++ source cannot be   |
| [01-architecture.md](01-architecture.md)                   | All 31 modules, the discovery daemon, the leader↔follower protocol, projection |
| [02-data-model.md](02-data-model.md)                       | Song / set / display-profile schema as designed                                |
| [03-module-behaviour.md](03-module-behaviour.md)           | Per-module UI, toolbars, keyboard shortcuts, settings                          |
| [04-real-library-analysis.md](04-real-library-analysis.md) | **Most important.** What the 153 real songs reveal about actual usage          |

Raw extraction artefacts live in `../../../_extracted/` (outside this app folder):
`v2_latest/` and `v1_english/` (installer payloads), `nested_*/` (Projector and discovery
sub-installers), `resources_v2.json` (parsed Win32 dialogs/menus/strings),
`strings/` and `strings/clean/` (binary string dumps).

## The one-paragraph summary

A suite of 17 Windows executables sharing a C++/MFC core. **SongLeader** runs a TCP
server and holds the service's song set; **SongFollower** (band members, free to navigate
on their own), **SongSlave** (fullscreen stage display, follows exactly), and
**PresenterFollower** connect to it and receive pushed state. A separate daemon,
**IPDSServer**, is a registry that lets them find each other. **Presenter** + **Projector**
handle congregation projection as an independent, network-controlled display API.
**SongEditor**, **SongDatabaseManager** and **ProfileEditor** cover authoring, library and
rendering rules. Songs are UTF-8 XML files on disk (`<song xmlns="swifttec/song">`), with
`<block>` sections containing `<line>`s with inline `<chord>`s.

## The three things worth stealing

1. **Auto vs Manual update mode** on the leader — scroll ahead privately, then commit.
2. **Written key vs capo, kept separate**, with `GuitarWithCapo` and
   `PianoWithLocalTranspose` as distinct rendering modes.
3. **`FontMinPtSize`/`FontMaxPtSize` auto-fit** so lyrics fill any screen size.

## The three things worth discarding

1. **The IPDS discovery daemon** — a single point of failure with retry-sleep loops.
2. **Licence acquisition from the leader** — followers block on DRM during worship.
3. **SongFollower vs SongSlave as separate programs** — that is one boolean setting.
