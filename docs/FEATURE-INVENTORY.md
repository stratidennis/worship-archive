# Feature Inventory — Keep / Drop / Change

Every functionality found in the legacy SwiftTec suite, plus gaps the real song library
exposes. **Go through this and mark each row.** Everything marked KEEP or NEW becomes the
build plan.

**How to mark:** edit the `→` column on each row.
`KEEP` · `DROP` · `CHANGE` (keep the idea, different design) · `LATER` (v2) · `?` (discuss)

My recommendation is pre-filled in the `Rec` column — overwrite freely, it's a starting
point, not a decision.

**Evidence** column: where the feature was found. `ini` = `SongBase.ini`,
`menu` = extracted Win32 menu, `str` = binary string table, `cli` = command-line flag,
`lib` = observed in your 153 real songs.

---

## A. Song Library

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| A1 | Central song library, browsable list | `SongDatabaseManager` | KEEP | |
| A2 | Sort by Title / Last Modified | str | KEEP | |
| A3 | Full-text search across lyrics | — (legacy had only `Filter:`) | NEW | |
| A4 | Filter by key, category, singer, block type | `Categories`, `category` | NEW | |
| A5 | Collections with an **owning band** (`L&I`) and sharing | `lib` + user | **KEEP — refined** | KEEP |
| A6 | Tags / themes on songs | `theme`, `category` | KEEP | |
| A7 | Import `.song` XML (the 153 existing files) | `lib` | **KEEP — mandatory** | |
| A8 | Import folder in bulk | `SongDatabase::importFolder` | KEEP | |
| A9 | Import plain text / paste from a website (chords above lyrics) | ini, real-world | **KEEP** | BUILT |
| A10 | Import OpenSong XML | ini `SongFileType` | **KEEP** | BUILT |
| A11 | Import `.sng` (Presentation Manager Pro) | ini `SongFileType` | DROP | |
| A12 | Import ChordPro — **and it is now the storage format** | — | **NEW — core** | KEEP |
| A13 | Export to ChordPro / `.song` / OpenSong | — | KEEP (escape hatch) | KEEP |
| A14 | `.songbundle` multi-song archive | str | CHANGE → zip/JSON backup | |
| A15 | Stable `uuid` identity, re-import merges not duplicates | `lib` | **KEEP — mandatory** | |
| A16 | `updated` timestamp per song | `lib` | KEEP | |
| A17 | Duplicate detection / merge | — | NEW | |
| A18 | Song revision history / undo a bad edit | — | NEW | |
| A19 | SQLite index over the library — **disposable, rebuilt from `.chopro` files** | `db_umt.dll` | KEEP (internal) | KEEP |
| A20 | MySQL / ODBC backend option | `db_umt.dll` | DROP | |
| A21 | Image database | `ImageDatabaseDir` | DROP (no media) | DROP |
| A22 | Media database | `MediaDatabaseDir` | DROP (no media) | DROP |

---

## B. Song Editor

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| B1 | Create / edit song, autosave | menu | KEEP | |
| B2 | Type lyrics as plain text | — | KEEP | |
| B3 | Place chords inline by clicking into a syllable | `AddChord.cur`, `EditChord.cur` | KEEP | |
| B4 | Chord entry by keyboard (`F9`) | menu | KEEP | |
| B5 | **Bass-note layer, separate from guitar chords** (`F10`) | menu | **KEEP — confirmed used** | KEEP |
| B6 | Block types: Verse, Chorus, PreChorus, Bridge, Intro, Ending, Tag, Misc | `lib` | KEEP | |
| B7 | Block type keyboard shortcuts (F6/F7/F8…) | menu | KEEP | |
| B8 | `singers` per line: Leader / Women / Men / All / Choir / Children / Adults / Congregation | `lib` (179 uses) | **KEEP — actively used** | |
| B9 | `singers` per block | `lib` (6 uses) | KEEP | |
| B10 | `target` per block: All / Leader / Band / Audience | menu | **DROP — 0 uses in 153 songs** | |
| B11 | Repeat count on block | `lib` (37 uses) | KEEP | |
| B12 | Repeat count on line | `lib` (1 use) | DROP | DROP |
| B13 | Indent on line | `lib` (27 uses) | KEEP | |
| B14 | Indent on block | `lib` (1 use) | DROP | DROP |
| B15 | Link / unlink block to previous (keep blocks together) | menu | **KEEP** | KEEP |
| B16 | `/: … :/` repeat brackets rendered properly | `lib` (233 uses) | **KEEP — actively used** | |
| B17 | Convert `/: :/` text → structured repeat | — | NEW | |
| B18 | Song metadata: title, key, tempo, time signature | `lib` | KEEP | |
| B19 | Metadata: author, copyright, CCLI, publisher, artist | `lib` (almost always empty) | KEEP but de-emphasise | |
| B20 | Metadata: category / theme / description | str | **KEEP** — powers search & filter | KEEP |
| B21 | Metadata: user1 / user2 / user3 free fields | str | DROP | |
| B22 | External references (CD, DVD, Book, SongBook, Website, YouTube) | `SongEditor.ini` | DROP | DROP |
| B23 | Live preview while editing | — | NEW | |
| B24 | Undo / redo | menu | KEEP | |
| B25 | Split / merge blocks, reorder blocks by drag | `HandGrab.cur` | KEEP | |
| B26 | Second language / translation lyric layer | `translation` | DROP | DROP |

---

## C. Arrangement & Cues *(the biggest gap — 303 Misc blocks are workarounds)*

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| C1 | Arrangement/sequence: order blocks for performance | menu, `sequence` | **CHANGE — redesign, old one unused** | |
| C2 | Drag-chip arrangement strip (`V1 C1 V2 C1 B1 C1 C1 E1`) | — | NEW | |
| C3 | Parse arrangement from text you already write (`Strofa -> Refren x2 -> Final`) | `lib` (STRUCTURA blocks) | NEW | |
| C4 | Per-set arrangement override (different order this Sunday) | — | NEW | |
| C5 | **Intro cue block** (chords / "prima jumatate de Refren") | `lib` (83 uses) | NEW | |
| C6 | **Instrumental cue block** | `lib` (46 uses) | NEW | |
| C7 | **Solo cue with a named person** ("SOLO Dennis:") | `lib` (23 uses) | NEW | |
| C8 | Free note / comment block | `lib` (Misc) | KEEP | |
| C9 | Cue visible only to the band, not the congregation | — | NEW | |
| C10 | Auto-migrate the 303 existing Misc blocks into typed cues | `lib` | NEW | |

---

## D. Keys, Chords & Transposition *(2nd biggest gap)*

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| D1 | Transpose up / down a semitone, live | menu `Shift+F4`/`F3` | KEEP | |
| D2 | Capo up / down, independent of transpose | menu `F4`/`F3` | KEEP | |
| D3 | **Written key vs performance key as separate fields** | `lib` (22 TRANSPOSE notes + filename prefixes) | **NEW — biggest win** | |
| D4 | Auto-transpose on load to the performance key | `defaulttranspose` (always 0) | NEW | |
| D5 | Per-musician key/capo, not shared | `PianoWithLocalTranspose` | KEEP | |
| D6 | `GuitarWithCapo` mode — show capo shapes | str | KEEP | |
| D7 | `PianoWithLocalTranspose` mode — show sounding pitch | str | KEEP | |
| D8 | Capo chords shown in brackets alongside concert chords | menu | KEEP | |
| D9 | Lenient chord parser (accepts `Cm#`, `C#min`, lowercase `b`) | `lib` (73 variants) | **NEW — mandatory** | |
| D10 | Slash chords transposed on both sides (`C#/A`) | `lib` | KEEP | |
| D11 | Parenthesised alternates preserved (`G(A)`, `Em(C,D)`) | `lib` | KEEP | |
| D12 | Bulk chord-spelling cleanup with review + undo | `lib` (105 chords, 13 spellings) | NEW | BUILT |
| D13 | Nashville numbers / roman numerals view | — | DROP | DROP |
| D14 | Chord diagrams (guitar fingerings) | — | DROP | DROP |

---

## E. Service / Set Planning

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| E1 | Build an ordered set of songs | ini | KEEP | |
| E2 | Save / load / "Save As" a set | ini | KEEP | |
| E3 | Add song from library | ini `Add Song From DB` | KEEP | |
| E4 | Add a loose file straight into a set | ini `Add Song From File` | **KEEP** | KEEP |
| E5 | Delete song from set, reorder by drag | ini | KEEP | |
| E6 | Per-set transpose/capo override per song | `SongSet` entry overrides | KEEP | |
| E7 | Free-text note item in the running order | `SongSet::processLineNode` | KEEP | |
| E8 | Gap / spacer item (prayer, sermon, announcements) | `SongSet::processGapNode` | KEEP | |
| E9 | Edit song **in the set only** vs **in the library** | ini (two separate buttons) | KEEP | |
| E10 | Sets are dated & reusable; "duplicate last Sunday" | — | NEW | |
| E11 | Plan a set on a phone before the service | — | NEW | |
| E12 | Print/export the running order for the team | — | NEW | |
| E13 | Warn on unsaved set changes | ini `SongSetNotSaved` | CHANGE → autosave | |

---

## F. Live Leading (the Leader)

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| F1 | Select current song in the set; everyone follows | ini | **KEEP — core** | |
| F2 | Select current block/section; everyone follows | ini | **KEEP — core** | |
| F3 | **Updates: Auto vs Manual** — browse ahead privately, then commit | ini | **KEEP — best legacy idea** | |
| F4 | **Mode: Song vs Block** — push whole song, or one section at a time | ini | KEEP | |
| F5 | Clear Text — blank lyrics, keep background | ini | KEEP | |
| F6 | Blackout — kill output entirely | ini | KEEP | |
| F7 | Live transpose / capo, propagated | ini | KEEP | |
| F8 | Live re-sequence mid-service | ini `Edit Sequence` | KEEP | |
| F9 | Set / reset tempo | ini | **KEEP — confirmed used** | KEEP |
| F10 | **Beat LED metronome** (red downbeat, green off-beats) on all displays | `beat-led-*.png` | **KEEP — confirmed used** | KEEP |
| F11 | Show / hide the song list to enlarge lyrics | ini | KEEP | |
| F12 | Select display profile live | ini | KEEP | |
| F13 | See who is connected, and what they're looking at | — | NEW | |
| F14 | Next/prev by keyboard, footswitch, or touch swipe | — | NEW | |
| F15 | Leader handover to another device mid-service | — | NEW | |
| F16 | Jump to any song/block instantly (search-to-jump) | — | NEW | |
| F17 | Countdown / "starting soon" screen | — | DROP | DROP |

---

## G. Band Member View (the Follower)

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| G1 | Sees the leader's set and current position | str | **KEEP — core** | |
| G2 | **Can navigate freely without affecting anyone** | str | **KEEP — core** | |
| G3 | "Snap back to leader" / auto-follow toggle | — | NEW | |
| G4 | Personal key/capo, independent of everyone else | `PianoWithLocalTranspose` | KEEP | |
| G5 | Personal font size / chord visibility | profiles | KEEP | |
| G6 | Instrument mode (with chords) vs singer mode (words only) | `SongViewerChords` / `SongViewerWords` | **KEEP — core** | |
| G7 | Personal notes on a song, private to that musician | — | NEW | |
| G8 | Connection state shown clearly | str | KEEP | |
| G9 | Works if WiFi drops — cached set, reconnects silently | — | **NEW — important** | |
| G10 | Choose your role/profile on join (guitar, keys, vocals…) | `SelectProfile` | KEEP | |

---

## H. Stage Display / Monitor

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| H1 | Fullscreen, follows the leader exactly, no local control | `SongSlave` | KEEP | |
| H2 | Block mode — one section at a time | str `BlockMode` | KEEP | |
| H3 | Highlight the current block | str `BlockHighlights` | KEEP | |
| H4 | Highlight fade animation | `highlightFadeTime` | DROP | DROP |
| H5 | Assigned a display profile at startup | `--profile` | KEEP | |
| H6 | **Same URL, choose role — no separate app** | — | **CHANGE — merge Follower/Slave** | |
| H7 | Keep-awake / prevent screen sleep | — | NEW | |

---

## I. Congregation Projection — ❌ **OUT OF SCOPE**

> **Decided:** another system already handles congregation projection. The new app is
> band-facing only. All of I1–I12 are dropped.
>
> One consequence worth keeping: **auto-fit text between a min and max font size**
> (I3) is still needed for the *stage display* (H1), because a TV at the back of a
> platform has the same problem. Carried over to J4.

---

## J. Display Profiles & Theming

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| J1 | Named profiles per context (screen/print/projection/editor) | `.sdp` | CHANGE → simplify | |
| J2 | Per-element styling (Title, Verse, Chorus, Chord, Instruction…) | str | KEEP | |
| J3 | Font family / size / weight / italic / colour per element | `ProfileEditor` | KEEP | |
| J4 | Min/max font with auto-fit | str | KEEP | |
| J5 | Background colour / image | str | KEEP | |
| J6 | Per-line colours | `EditProfileWizardLineColors` | **KEEP** | KEEP |
| J7 | Dark mode / high-contrast for stage | — | NEW | |
| J8 | Per-device profile choice, remembered | `SelectedProfile` | KEEP | |
| J9 | Multi-column layout for long songs | menu | KEEP (print) | |
| J10 | Profile editor UI for end users | `ProfileEditor.exe` | LATER | |

---

## K. Printing & Export

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| K1 | Print a song sheet | menu `Ctrl+P` | KEEP | |
| K2 | Songsheet **with chords** | menu | KEEP | |
| K3 | Songsheet **words only** | menu | KEEP | |
| K4 | Songsheet with bass notes | menu | KEEP (B5 is used) | |
| K5 | Large-print songsheet | menu | DROP — superseded by fit-to-screen | DROP |
| K6 | OHP layout (lyrics only, huge) | menu | DROP | DROP |
| K7 | Inverted / dark print variants | str | DROP | |
| K8 | Print preview | menu | CHANGE → browser print | |
| K9 | Export whole set to PDF | `.docx` files in your library | **NEW — you already do this by hand** | |
| K10 | Copy song text to clipboard | menu | KEEP | |

---

## L. Networking & Session

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| L1 | Leader hosts; others connect over LAN | architecture | **KEEP — core** | |
| L2 | Works with **no internet at all** | — | **KEEP — mandatory** | |
| L3 | Discovery daemon (IPDS) | `IPDSServer.exe` | **DROP — fragile** | |
| L4 | Join by QR code / short URL instead | — | NEW | |
| L5 | mDNS/Bonjour name (`http://worship.local`) | — | NEW | |
| L6 | Multiple leaders on one network, pick one | `SelectLeader` | DROP | DROP |
| L7 | Countdown modal to pick leader/profile at startup | `SelectLeaderTimeout` | **DROP — annoying** | |
| L8 | Silent auto-reconnect with backoff | str (sleep-poll loop) | **NEW — replaces L7** | |
| L9 | Low latency push (TCP_NODELAY equivalent) | str | KEEP | |
| L10 | Licence acquired from leader | str | **DROP — pure DRM** | |
| L11 | Network activity monitor / debug log | `SongMonitor.exe` | LATER (dev only) | |
| L12 | Reconnect resumes exactly where the service is | — | NEW | |
| L13 | Client device names ("Dennis — guitar") | — | NEW | |

---

## M. Bible — ❌ **OUT OF SCOPE**

> **Decided:** not used. M1–M4 dropped.

---

## N. Media — ❌ **OUT OF SCOPE**

> **Decided:** not used. N1–N7 dropped.

---

## O. Admin & Setup

| # | Feature | Evidence | Rec | → |
|---|---|---|---|---|
| O1 | One command to start the whole system | — | **NEW — replaces installers** | |
| O2 | Configurable data folders | `SNGsetup` | CHANGE → one data dir | |
| O3 | Licence keys / activation | `SNGsetup`, `KEY.txt` | **DROP** | |
| O4 | Demo mode with song limit | ini `[demo]` | **DROP** | |
| O5 | Trial expiry warnings | ini `[licence]` | **DROP** | |
| O6 | Cash drawer / receipt printer / door release | `SNGsetup` | **DROP — leaked from a POS product** | |
| O7 | Backup / restore the library | — | NEW | |
| O8 | UI language: Romanian / English, switchable | `SongBase.ini` is fully externalised | **KEEP — RO default, EN switchable** | KEEP |
| O9 | Auto-archive every song that goes live | `PresenterFollower` AutoSave | DROP | DROP |
| O10 | Per-device settings remembered (font, role, key) | str | KEEP | |
| O11 | Windows-only, per-machine install + VC++ redist | — | **DROP** — replaced by one Electron app on the host; every other device is a browser | DROP |

---

## Summary of my recommendations

**Definitely keep (core):** A7, A15, D1–D2, E1–E9, F1–F6, G1–G2, G6, H1–H3, L1–L2
**Biggest new wins:** D3 (written vs performance key), C5–C7 (typed cues),
C2 (arrangement strip), A3 (search), G9 (survives WiFi drops), L4 (QR join), K9 (set PDF)
**Definitely drop:** B10 (target), L3 (IPDS), L7 (countdown modals), L10 + O3–O5 (licensing),
O6 (POS leftovers), O11 (Windows install), A20 (MySQL)
**Needs your call (`?`):** bass notes (B5), tempo/metronome (F9–F10), the whole of
projection (I), Bible (M), and media (N)

---

## Decisions taken

| Question | Decision |
|---|---|
| Congregation projection (I) | **Out of scope** — another system does it |
| Bible (M) | **Out of scope** — not used |
| Media: images/video/audio/PPT (N) | **Out of scope** — not used |
| Tempo + beat metronome (F9, F10) | **In** — confirmed used |
| Bass-notes layer (B5) | **In** — confirmed used |
| UI language | **Romanian default, English switchable**, fully externalised |
| Host machine | **Leader's laptop**, cross-platform (Windows + macOS) |
| Devices | **PC, laptop, tablet, phone** — fully responsive |
| Song editing | **Full editor in the browser** — replaces SongEditor.exe |
| Standalone use | **Yes, full offline mode** — works alone with no server on the LAN |
| Library editing rights | **Simple roles** — admin / editor / viewer |
| Live control | **Unprotected** — trusted network, whoever is at the leader screen leads |
| Stack | **React 19 + TypeScript + Vite + Tailwind**, Node + Fastify + ws + SQLite |
| Packaging | **Electron** desktop app for the host machine (Windows + macOS) |
| App name | **Worship Archive** — repo `stratidennis/worship-archive` |
| Storage format | **ChordPro `.chopro` files on disk**; SQLite is a disposable index. Our extras use `{x_*}` custom directives. |
| Import formats | ChordPro · plain text / website paste · OpenSong XML · legacy `.song` |
| **Whole song on one screen** | **Hard requirement.** No pagination or mid-song scrolling; text auto-scales and reflows into columns. See PLAN §4b. |

## All rows are now marked

Every `?` has been resolved. Summary of the final round:

**Kept:** A9, A10 (text & OpenSong import), B15 (link blocks together), B20 (category /
theme), E4 (loose file into a set), J6 (per-line colours)

**Dropped:** B12, B14 (each used once in 153 songs), B22 (external references),
B26 (translation layer), D13 (Nashville numbers), D14 (chord diagrams), F17 (countdown),
H4 (highlight fade), K5, K6 (large-print & OHP — superseded by fit-to-screen),
L6 (multiple leaders), O9 (auto-archive)

### One requirement that emerged from this round

> *"A nice thing about the old app is that the whole song is always displayed on one page,
> and there is no need to have it displayed on multiple pages."*

This is now a **hard constraint**, not a preference — it has its own section in the plan
(§4b) and it is why K5 and K6 were dropped: fit-to-screen makes fixed large-print layouts
unnecessary. It also demotes "font size" from a setting to a hint, since the size is
computed to make the song fit.

This inventory is now the scope contract. Anything added later gets a row here first.