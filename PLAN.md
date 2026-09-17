# Build Plan — Worship Archive (web + Electron)

Replacement for the SwiftTec Song Management System. Browser-based, offline-first,
LAN-hosted, packaged as an Electron desktop app for the host machine.

Read [`docs/FEATURE-INVENTORY.md`](docs/FEATURE-INVENTORY.md) first — it is the scope
contract. This document is *how*, that one is *what*.

---

## 1. Constraints that shape everything

| Constraint | Consequence |
|---|---|
| **Must work with no internet, ever** | No CDNs, no external fonts, no telemetry, no licence check. Every asset bundled. |
| **LAN-only, possibly a router with no WAN** | Server binds `0.0.0.0`; discovery must not assume DNS or internet. |
| **Runs on the leader's laptop** | Electron app, one double-click. Windows + macOS. |
| **Must also work alone, offline** | The web app is a PWA with a full local library in IndexedDB. Server is optional. |
| **PC, laptop, tablet, phone** | One responsive codebase, 390px → 1920px. Touch and keyboard both first-class. |
| **153 existing songs must survive** | Importer is a v1 blocker. Identity is `(uuid, title)` — the legacy uuids collide. `.song` export is the escape hatch. |
| **Romanian default, English switchable** | i18n from commit one. No hardcoded user-facing strings, ever. |
| **The whole song fits on one screen** | No pagination, no mid-song scrolling. The renderer auto-scales text and reflows into columns to fit. See §4b — this constrains the whole view layer. |
| **No format lock-in** | Songs live on disk as ChordPro text. SQLite is a disposable index. |

### Explicitly out of scope

Congregation projection, Bible, images, video, audio, PowerPoint, alerts, playlists,
licensing, MySQL. See the ❌ sections in the inventory.

---

## 2. Architecture

```
┌──────────────────────── Leader's laptop ─────────────────────────┐
│  Electron app                                                     │
│  ┌─────────────────────┐      ┌──────────────────────────────┐   │
│  │  main process       │      │  renderer (BrowserWindow)     │   │
│  │  ─────────────────  │      │  ──────────────────────────   │   │
│  │  Fastify HTTP       │◄────►│  the same React app every     │   │
│  │  WebSocket hub      │      │  other device loads           │   │
│  │  SQLite (library)   │      │  (loaded from the local       │   │
│  │  mDNS advertiser    │      │   server, not file://)        │   │
│  │  file import/export │      └──────────────────────────────┘   │
│  └──────────┬──────────┘                                          │
└─────────────┼─────────────────────────────────────────────────────┘
              │  http://192.168.1.x:7373   ·   http://worship.local:7373
              │  WebSocket /ws
  ┌───────────┼───────────────┬──────────────────┬─────────────────┐
  │           │               │                  │                 │
┌─▼────────┐ ┌▼────────────┐ ┌▼──────────────┐ ┌▼───────────────┐
│ Band     │ │ Band        │ │ Stage display │ │ Anyone, at     │
│ phone    │ │ tablet      │ │ (TV/monitor)  │ │ home, offline  │
│ /band    │ │ /band       │ │ /stage        │ │ no server      │
└──────────┘ └─────────────┘ └───────────────┘ └────────────────┘
```

### Why Electron hosts the server

The Electron main process *is* a Node process. Running Fastify + `ws` + `better-sqlite3`
there means:

- one process, one icon, one double-click — no terminal, no separate install
- the leader's own UI is just another client of `http://localhost:7373`, so there is
  **exactly one frontend codebase** and no "desktop-only" divergence
- native file dialogs for import/export/backup via IPC
- `app.setLoginItemSettings`, tray icon, "prevent sleep" (`powerSaveBlocker`) come free

**Rule: the renderer never talks to SQLite or the filesystem directly.** It uses the same
HTTP/WS API as a phone on the WiFi. Electron adds a thin IPC layer *only* for things a
browser genuinely cannot do (native file picker, choosing the data folder, quit/restart).
Break this rule and the web and desktop builds will drift apart.

### The three runtime modes

| Mode | How it starts | Library source | Session |
|---|---|---|---|
| **Host** | Electron app on the leader's laptop | SQLite on disk | Owns it |
| **Connected client** | Browser → `http://<host>:7373` | Synced from host into IndexedDB | Follows host |
| **Standalone** | Browser/PWA, no host reachable | IndexedDB only | None — solo practice |

A client transitions Connected ↔ Standalone automatically as the network comes and goes.
**This is the single most important behaviour to get right.** WiFi in church buildings is
bad; the app must never lose a song because of it.

---

## 3. Data model

This is the **in-memory model**. On disk it is serialised to ChordPro (see below); in
SQLite and IndexedDB it is cached as JSON for speed. The ChordPro file is always the
source of truth.

```ts
type Uuid = string;
type Singers = 'Leader'|'All'|'Women'|'Men'|'Choir'|'Children'|'Adults'|'Congregation';

type BlockType =
  | 'Verse' | 'Chorus' | 'PreChorus' | 'Bridge' | 'Ending' | 'Tag'
  | 'Intro' | 'Instrumental' | 'Solo' | 'Note';   // ← last 4 replace 303 "Misc" blocks

interface Song {
  id: Uuid;                       // OURS. Minted fresh when the legacy uuid collides.
  legacyUuid: Uuid | null;        // the original <uuid>, kept for traceability — see below
  title: string;
  writtenKey: string | null;      // the key the chords are literally written in
  performanceKey: string | null;  // the key it's actually played in          ← D3
  tempo: number | null;
  timeSignature: string | null;
  authors: string[];
  copyright: string | null;
  ccli: string | null;
  tags: string[];
  collectionIds: Uuid[];
  blocks: Block[];
  arrangement: string[] | null;   // block ids in play order; null = as written  ← C1/C2
  lang: string | null;
  createdAt: string; updatedAt: string;
  rev: number;                    // monotonic, for sync + history
}

interface Block {
  id: string;                     // "V1", "C2", "S1" — legacy-compatible
  type: BlockType;
  label: string | null;           // "Dennis" on a Solo, "forte" on an Instrumental
  singers: Singers | null;
  repeat: number | null;
  indent: number | null;
  bandOnly: boolean;              // cue the band sees, never shown on a shared display
  lines: Line[];
}

interface Line {
  text: string;                   // lyrics only, no markup
  chords: Anchor[];               // guitar/piano chords
  bass: Anchor[];                 // separate layer                            ← B5
  singers: Singers | null;
  repeat: number | null;
  indent: number | null;
}

interface Anchor {
  at: number;                     // UTF-16 index into `text`, 0 = before first char
  raw: string;                    // EXACTLY as authored — "Cm#", "G(A)", "C#/A"
}
```

### Three decisions worth defending

**`raw` is never rewritten on import.** The legacy library has 73 chord spellings
including 67 malformed ones. Normalising silently on import would mean a musician opens
a song they have played for years and finds it changed. Instead: store `raw`, parse
leniently at render time, and offer an explicit, reviewable, revertible cleanup (D12).

**`writtenKey` and `performanceKey` are separate.** This is the fix for the workflow the
library exposes: chords written in G, performed in Bb, the gap recorded as a
`TRANSPOSE: G+3=>Bb` text note and in the filename. Once both are fields, 22 note blocks
and 153 filename prefixes become data, and every view can transpose correctly on its own.

**`arrangement` is a list of block ids, not duplicated content.** `['V1','C1','V2','C1','B1','C1','C1','E1']`
renders the chorus four times from one source. `null` means "play the blocks as written",
which is what all 153 existing songs mean by `<sequence>auto</sequence>`.

### Sets

```ts
interface ServiceSet {
  id: Uuid; title: string; date: string | null;
  items: SetItem[];
  createdAt: string; updatedAt: string; rev: number;
}

type SetItem =
  | { kind: 'song'; songId: Uuid;
      keyOverride: string | null;        // E6
      capoOverride: number | null;
      arrangementOverride: string[] | null; }   // C4
  | { kind: 'note'; text: string }                // E7
  | { kind: 'gap';  label: string; minutes: number | null };  // E8
```

Overrides live on the set, never on the song. Changing Sunday's key must not edit the
library.

### Storage — ChordPro on disk, SQLite as a disposable index

**The `.chopro` files are the database.** SQLite holds nothing that cannot be rebuilt
from them.

```
<data folder>/
├── songs/
│   ├── bunatatea-ta.chopro          ← source of truth
│   └── domn-al-trezirii.chopro
├── sets/
│   └── 2026-09-20.json              ← sets are ours, no standard exists
├── collections.json                 ← incl. band ownership (see below)
└── index.db                         ← SQLite + FTS5. Deletable. Rebuilt on launch if missing.
```

| Where | What |
|---|---|
| `songs/*.chopro` | Every song, as ChordPro text. Git-friendly, human-readable, portable. |
| `index.db` | Parsed songs, FTS5 search, revision history, device registry, settings |
| IndexedDB (client) | Mirror of parsed songs/sets + `pendingOps` for offline edits |
| Data folder | `~/Library/Application Support/Worship Archive` (mac), `%APPDATA%` (win); relocatable |

A file-watcher reindexes on external change, so editing a `.chopro` in a text editor or
pulling from git Just Works.

### The ChordPro mapping

Standard directives carry everything standard tools understand:

```
{title: Bunatatea Ta}            {key: G}            {tempo: 72}
{time: 4/4}                      {capo: 0}           {artist: …}
{ccli: …}                        {copyright: …}
{start_of_verse: V1} … {end_of_verse}
{start_of_chorus: C1}            {start_of_bridge: B1}
{comment: …}
Eu Te iu[G]besc, mila [C]Ta e nesfâr[G]șită
```

Our extensions use the `x_` custom-directive convention. **Every ChordPro parser in
existence ignores unknown directives**, so these files stay valid and readable elsewhere —
other tools simply see a slightly plainer song.

| Extension | Purpose | Inventory ref |
|---|---|---|
| `{x_id: <uuid>}` | Stable identity across renames | A15 |
| `{x_legacy_uuid: …}` | Original SwiftTec uuid, for traceability | — |
| `{x_performance_key: Bb}` | The key it is actually played in | **D3** |
| `{x_block: Solo\|S1\|Dennis}` | Typed cue blocks ChordPro has no slot for | C5–C7 |
| `{x_singers: Leader}` | Applies to the following line or block | B8/B9 |
| `{x_bass: 4:G 11:D}` | Bass-note layer, `index:note` pairs | **B5** |
| `{x_arrangement: V1 C1 V2 C1 B1 C1 E1}` | Play order as block ids | C1/C2 |
| `{x_band_only: true}` | Cue the band sees, never a shared display | C9 |
| `{x_link_prev: true}` | Keep this block with the previous one | **B15** |
| `{x_indent: 2}` | Line indent | B13 |
| `{x_line_color: …}` | Per-line colour | **J6** |
| `{x_tags: comuniune, craciun}` | Category / theme | **B20** |
| `{x_rev: 7}` `{x_updated: …}` | Sync bookkeeping | — |

Intro / Instrumental / Solo / Note map to `{start_of_verse: …}` + `{x_block: …}` so they
degrade to *something* readable in other tools rather than vanishing.

**Round-trip fidelity is a test, not a hope:** parse → serialise → parse must be
byte-identical for every song in the library, enforced in CI.

---

## 4. The chord engine

Its own package, zero dependencies, 100% unit-tested. Everything else depends on it, and
it is the part most likely to be quietly wrong.

```ts
parseChord(raw: string): ParsedChord | null
transpose(c: ParsedChord, semitones: number, spelling: KeySpelling): string
formatForCapo(c: ParsedChord, capo: number): string
normalise(raw: string): { fixed: string; reason: string } | null
```

Requirements drawn directly from the real library:

| Input | Must produce |
|---|---|
| `Cm#`, `Fm#`, `Gm#` (67 occurrences) | Parse as `C#m`, `F#m`, `G#m` — modifier order reversed |
| `C#min` | Parse as `C#m` |
| `b`, `c#` (27 occurrences) | Parse as `B`, `C#` — lowercase root |
| `C#/A`, `G/B`, `Em/D` | Transpose **both** sides |
| `G(A)`, `Am(Bm)`, `Em(C,D)` | Transpose root **and** every alternate inside the parens |
| `G A` | Two chords in one anchor — split, transpose both |
| Anything unparseable | Return `null`, render verbatim, never throw, never lose it |

Enharmonic spelling follows the target key (F♯ major → `F#`, G♭ major → `Gb`), not a
fixed table. Getting this wrong is the classic transposition bug.

**Capo vs transpose are independent** (D1/D2, and two distinct legacy render modes):

- `GuitarWithCapo` — sounding key fixed, shapes shown for a capoed guitar
- `PianoWithLocalTranspose` — actual sounding pitches
- capo chords optionally in brackets beside concert chords (D8)

Each is a per-device preference (D5, G4). The guitarist sees capo 3 shapes; the pianist
sees concert pitch; the leader changed neither.

---

## 4b. The fit-to-one-screen renderer

> *"A nice thing about the old app is that the whole song is always displayed on one page,
> and there is no need to have it displayed on multiple pages."*

This is a hard requirement, not a nicety, and it shapes the entire view layer. A musician
mid-song must never scroll, swipe, or lose their place. The legacy app achieved it with
`FontMinPtSize`/`FontMaxPtSize` auto-fit plus multi-column layout.

### Algorithm

1. Render the song into a measuring container at the maximum font size.
2. If it overflows, try **two columns**, then three (only on wide screens).
3. If it still overflows, binary-search the font size down towards the minimum.
4. If it *still* overflows at minimum size — the only honest failure — degrade in this
   order, telling the user which happened:
   - tighten line-height and block spacing to their floor
   - hide `Note` blocks behind a tap
   - **last resort:** paginate with an explicit page indicator

Steps 1–3 must complete in one frame. Use `ResizeObserver` + a hidden measurement layer,
not a layout loop that thrashes.

### Consequences

- Font size is an **output** of the layout, not a user setting. The per-device "font size"
  preference becomes a *preferred maximum* — a hint, not a command.
- Chords sit above their syllable, so line height must account for the chord row; songs
  with chords fit less text and will scale smaller than words-only views. Instrument mode
  and words mode therefore compute independently.
- It must re-run on: orientation change, window resize, transpose (chord widths change),
  chords/bass toggled, translation layer toggled, profile change.
- **Block mode (F4) is the escape valve.** When a song genuinely cannot fit legibly — a
  long song on a phone — block mode shows one section at a time, and the app should
  suggest it rather than shrinking text into illegibility.
- Multi-column (J9) is now a *layout strategy*, not just a print option.

This deserves its own package (`core/layout`) and visual regression tests at 390px,
768px, 1280px and 1920px, in both chord and words modes.

---

## 5. Sync protocol

WebSocket at `/ws`, JSON frames. Two independent channels with different consistency needs.

### Session (live service) — host is authoritative

```jsonc
// host → all
{ "t": "session", "rev": 41, "state": {
    "setId": "…", "itemIndex": 3, "blockId": "C2",
    "mode": "block",          // "song" | "block"           ← F4
    "output": "live",         // "live" | "cleared" | "black" ← F5/F6
    "tempo": 72, "beat": 3,   // metronome                    ← F9/F10
    "transpose": 0
}}

// client → host
{ "t": "session/select", "itemIndex": 4, "blockId": "V1" }   // leader only
{ "t": "hello", "role": "band", "name": "Dennis — guitar" }  // ← L13
```

Full state on every change — it is tiny, and it makes reconnection trivial: a client that
missed messages gets the truth in the next frame (L12). `rev` lets a client ignore
out-of-order frames.

**Auto vs Manual (F3)** is purely client-side on the leader: in Manual, the leader's local
cursor moves without emitting `session/select`, and a "Go live" button emits the current
position. The protocol does not need to know.

### Library — last-write-wins per song, with history

```jsonc
{ "t": "lib/sync",   "since": 128 }
{ "t": "lib/delta",  "songs": [...], "sets": [...], "rev": 145, "deleted": ["uuid"] }
{ "t": "lib/put",    "song": { ... } }         // client → host, requires editor role
{ "t": "lib/ack",    "id": "…", "rev": 146 }
```

Conflicts resolve by `updatedAt`, and the losing version is kept in `song_revisions`
(A18) so nothing is ever destroyed. Good enough for a team of ten who rarely edit the
same song simultaneously; a CRDT would be over-engineering here.

### Transport rules

- `TCP_NODELAY` equivalent: send immediately, never batch session frames (L9)
- Heartbeat ping every 5 s; client reconnects with exponential backoff 0.5 s → 10 s,
  **silently** — no modal, just a small status dot (L8, replacing the legacy
  countdown dialogs)
- On reconnect: `lib/sync` since last rev, then the next `session` frame restores position

### Discovery — replacing IPDS (L3/L4/L5)

Three independent mechanisms, because each fails differently:

1. **mDNS/Bonjour** — advertise `_worship._tcp.local`, so `http://worship.local:7373`
   works on most networks. Silently absent on some corporate/guest WiFi.
2. **QR code** on the host screen encoding `http://192.168.1.x:7373` — always works,
   zero typing, and is how people will actually join.
3. **Manual IP entry**, remembered per device — the fallback that cannot fail.

No daemon, no registry, no single point of failure.

---

## 6. Offline-first behaviour

The part the legacy app got worst, and the part that matters most in a church hall.

- The web app is a **PWA** with a service worker precaching the entire app shell. Every
  asset is bundled and same-origin — no CDN, so an offline load is indistinguishable from
  an online one.
- On first connect, the client pulls the full library into IndexedDB. 153 songs is well
  under a megabyte; there is no reason to lazy-load.
- Offline edits queue in `pendingOps` and flush on reconnect. If the user's role is
  viewer, editing is disabled rather than queued-then-rejected.
- The UI shows exactly one of: **Live** (green) · **Offline — cached** (amber) ·
  **Solo** (grey). No modals, ever (L7).
- A band member at home with no host on the network gets the **full app**: library,
  search, transpose, print, practice. Only the live-session strip is absent (G9).

---

## 7. UI surfaces

One React app, role-based routes, fully responsive.

| Route | Who | Purpose |
|---|---|---|
| `/` | anyone | Library: search, filter, collections, open a song |
| `/song/:id` | anyone | Song view — chords/words toggle, personal key & capo, print |
| `/edit/:id` | editor+ | Full editor (B1–B25) |
| `/sets` | anyone | Service sets; create, duplicate last Sunday (E10) |
| `/lead` | anyone on host | Leader console |
| `/band` | anyone | Band member view — follows leader, free to roam (G1/G2) |
| `/stage` | display device | Fullscreen, follows exactly, no chrome (H1) |
| `/settings` | anyone | Language, role, font size, capo mode, device name |

### `/lead` — leader console

Three columns on desktop, collapsing to tabs on a phone (F11 comes free from the
responsive layout):

```
┌──────────┬────────────────────────────┬─────────────┐
│ Set list │  Current song              │ Connected   │
│          │  ┌──────────────────────┐  │ devices     │
│ 1 Song A │  │ V1 ─ block chips     │  │ ● Dennis    │
│ 2 Song B │  │ C1  (click to go)    │  │ ● Ana       │
│▸3 Song C │  └──────────────────────┘  │ ● Stage TV  │
│ 4 Prayer │                            │             │
│ 5 Song D │  lyrics + chords           │ [AUTO|MAN]  │
│          │                            │ [SONG|BLOCK]│
│          │                            │ [CLEAR][BLK]│
│          │                            │ ♩ 72  ●○○○  │
└──────────┴────────────────────────────┴─────────────┘
```

- Block chips are the navigation *and* the arrangement strip (C2) — same component.
- The device panel (F13) is new and genuinely useful: the leader can see the stage TV
  dropped off before wondering why it is blank.
- Keyboard: `↑↓` blocks, `←→` songs, `Space` go-live in manual mode, `B` blackout,
  `C` clear, `/` jump-to (F16). All rebindable later.

### `/band` — band member view

- Follows the leader by default; any local navigation flips a **"Back to leader"** pill
  into view (G3). No hidden state, no confusion about why you are seeing a different verse.
- Per-device: chords on/off (G6), bass notes on/off (B5), font size, capo, key.
- `bandOnly` cue blocks (C9) render here and on `/stage` only if that display opts in.
- Swipe left/right for blocks on touch; large tap targets; screen kept awake (H7).

### Editor

- Lyrics as a plain textarea; chords placed by clicking a character position, or typed
  with `F9`. Chord token floats above its anchor.
- Block type via keyboard (`F6`/`F7`/`F8`, matching muscle memory) or a chip menu.
- Live preview beside the editor (B23).
- The arrangement strip is drag-to-reorder chips (C2) — with a **"parse from text"**
  affordance that reads `Strofa -> Refren x2 -> Final` (C3), because that is what people
  already type.

---

## 8. Tech stack

| Layer | Choice | Why |
|---|---|---|
| UI | **React 19 + TypeScript + Vite** | Chosen. Fast HMR, good Electron story. |
| Styling | **Tailwind CSS v4** | No runtime CSS-in-JS; small bundle; trivially themeable for dark stage mode (J7). |
| State | **Zustand** + **TanStack Query** | Zustand for session/UI state, Query for library cache + optimistic offline writes. Redux is overkill here. |
| Router | **React Router** | Plain, well understood. |
| Local DB | **Dexie** (IndexedDB) | Ergonomic, reliable, good TS types. |
| i18n | **i18next** + `react-i18next` | RO/EN from day one (O8). |
| Server | **Fastify** + **`ws`** | Fastify is fast, small, first-class TS. `ws` over Socket.IO — no fallback transports needed on a LAN. |
| DB | **better-sqlite3** + **FTS5** | Synchronous, zero-config, gives full-text search for free (A3). |
| Discovery | **`bonjour-service`** | Pure JS mDNS, no native dep. |
| Desktop | **Electron** + **electron-builder** | Chosen. Windows + macOS from one config. |
| Testing | **Vitest** + **Playwright** | Unit for the chord engine and importer; E2E for leader↔follower sync. |
| Monorepo | **pnpm workspaces** | Fast, strict, no hoisting surprises. |

Pinned versions and an offline-capable lockfile. `better-sqlite3` is native — it must be
rebuilt for Electron's ABI (`electron-rebuild`); budget an afternoon for this the first time.

---

## 9. Repository layout

```
worship-archive/
├── packages/
│   ├── core/          # domain: types, chord engine, arrangement, transposition,
│   │                  # ChordPro parse/serialise, fit-to-screen layout maths.
│   │                  # ZERO deps, zero DOM, zero Node. Shared by everything.
│   ├── importers/     # .song XML, plain text, OpenSong XML → Song; and the exporters
│   ├── ui/            # React app — the ONLY frontend. Web and Electron both load this.
│   ├── server/        # Fastify + ws + SQLite. Runs standalone or inside Electron.
│   └── desktop/       # Electron main + preload + builder config. Thin.
├── docs/
│   ├── legacy/        # reverse-engineering of the old system
│   ├── FEATURE-INVENTORY.md
│   └── adr/           # architecture decisions, one file each
├── e2e/
└── PLAN.md
```

`core` having no dependencies is deliberate: the chord engine must be testable in
isolation and reusable from the server, the browser, and a CLI migration script without
dragging React or Node into any of them.

---

## 10. Migration

A v1 blocker, and the first thing to build after `core`.

0. **Target format is ChordPro.** Migration converts `.song` XML → `.chopro` text. The
   originals are never modified; they stay in `~/Downloads/Song Files/` untouched.
1. **Parse** all 153 `.song` files (UTF-8 BOM, `\r\n`, `swifttec/song` namespace).
2. **Match on `(uuid, normalised title)`, not uuid alone.** The legacy library has
   **5 uuids shared across 11 different songs** — new songs were made by copying a file,
   and the editor never reissued the id. On a uuid collision with a different title,
   mint a fresh id and keep the original in `legacyUuid`. Report every collision.
3. **Map blocks**: `Verse|Chorus|PreChorus|Bridge|Ending|Tag|Intro` map 1:1.
4. **Classify the 303 `Misc` blocks** by their first word (C10) — a mechanical,
   high-confidence transformation:

   | Pattern | Becomes |
   |---|---|
   | `INTRO:` … (83) | `Intro` block |
   | `INSTRUMENTAL:` / `INSTR` (46) | `Instrumental` block |
   | `SOLO <Name>:` (23) | `Solo` block, `label = "<Name>"` |
   | `TRANSPOSE: X+n => Y` / `GAMA:` (22) | sets `writtenKey: X`, `performanceKey: Y` — **the note disappears into data** |
   | `STRUCTURA: A -> B x2 -> C` | parsed into `arrangement` (C3) |
   | `REFREN x2`, `2 X REF`, `Bridge x1` | arrangement entries |
   | `TOTI:` (15) | `singers: 'All'` on the following block |
   | anything else | `Note` block, text preserved verbatim |

5. **Filename keys.** The convention is `<writtenKey> - <title> - <performanceKey>`,
   e.g. `C - Dumnezeu e dragostea mea - D.song`. Also handle `<key>` fields holding both
   (`C-D`, `G - A`). Prefix → `writtenKey`, suffix → `performanceKey`; fall back to
   `<key>` and the `TRANSPOSE:` notes. Strip the key affixes from the stored title.
6. **Chords**: store `raw` untouched. Run the normaliser in *report-only* mode and write
   `migration-report.html` listing all 67 suspect spellings for review (D12).
7. **Collections.** The two folders become two collections with an owning band:
   root → the main group, `Song files L&I` → band **L&I**, shared with the main group.
   Collections carry `ownerBand` and `sharedWith`, so "L&I's songs that we also use" is
   expressible rather than being just a folder name.
8. **Verify — three gates, all must pass before the importer is trusted:**
   - **Count:** exactly 153 songs imported. Catches the duplicate-uuid trap.
   - **Semantic round-trip:** `.song` → model → `.chopro` → model produces an identical
     model. Guarantees the ChordPro conversion is lossless.
   - **Chord census:** every one of the 3504 chord anchors still present, `raw` byte-identical.

---

## 11. Roles

Library editing uses **simple roles**; live control is **unprotected** (trusted network).
These are deliberately different: a wrong tap during worship is recoverable, a deleted
song is not.

| Role | Library | Sets | Lead | How |
|---|---|---|---|---|
| **viewer** | read | read | yes | default for any new device |
| **editor** | read/write | read/write | yes | chosen in settings |
| **admin** | + delete, import, restore, backup | + | yes | PIN set on first run |

The PIN exists only to stop an accidental "delete all songs" from a phone. It is not
security, and the docs should say so plainly.

---

## 12. Phased delivery

Each phase ends with something genuinely usable. No phase is "just plumbing".

### Phase 0 — Foundations *(~2 days)*
pnpm monorepo, TS config, Vite, Tailwind, Vitest, CI. `core` types. A blank app that runs.
**Done when:** `pnpm dev` serves a page and `pnpm test` runs.

### Phase 1 — Chord engine + ChordPro + importers *(~6 days)*
`core` chord parse/transpose/capo/normalise, tested against the real 73 chord spellings.
ChordPro parser **and** serialiser with byte-identical round-trip. Importers for `.song`
XML, plain text (chords-above-lyrics), and OpenSong XML. Full migration of the 153 songs.
**Done when:** all three verification gates pass, and a song pasted from Ultimate Guitar
imports correctly.

### Phase 2 — Library + song view *(~6 days)*
SQLite + FTS5 index over the `.chopro` files, file-watcher reindex, Fastify API, React
library list, search, filters, collections (with band ownership), song view with
chords/words toggle, personal key + capo, **the fit-to-one-screen renderer (§4b)**,
print stylesheet.
**Done when:** you can open the app, find any of your 153 songs, transpose it, and print it.
*This alone already replaces `vizualizator_cantare.html`.*

### Phase 3 — Editor *(~6 days)*
Full editor: lyrics, click-to-place chords, bass layer, block types, singers, repeat,
indent, metadata, live preview, undo/redo, revision history.
**Done when:** you can author a new song end-to-end without touching Windows.

### Phase 4 — Sets *(~3 days)*
Build, save, reorder, duplicate; notes and gaps; per-set key/capo/arrangement overrides;
export the running order to PDF (K9 — replaces the hand-made `.docx` files).
**Done when:** next Sunday's set can be planned entirely in the app.

### Phase 5 — Live session *(~6 days)*
WebSocket hub, session state, `/lead`, `/band`, `/stage`, auto/manual mode, song/block
mode, clear/blackout, tempo + beat LED, connected-device panel, silent reconnect.
**Done when:** leader + two devices stay in sync across a deliberate WiFi drop.

### Phase 6 — Offline + discovery *(~4 days)*
Service worker, IndexedDB mirror, pending-op queue, mDNS, QR join, manual IP.
**Done when:** a phone in airplane mode still opens the full library, and rejoins cleanly.

### Phase 7 — Electron *(~4 days)*
Main process hosts the server, native file dialogs via IPC, tray icon, prevent-sleep,
`electron-rebuild` for `better-sqlite3`, electron-builder for Windows + macOS,
first-run setup (data folder, admin PIN, import wizard).
**Done when:** a signed-ish installer on a clean Windows laptop starts the whole system
with one double-click.

### Phase 8 — Polish *(~4 days)*
Romanian + English throughout, dark stage theme, keyboard shortcuts, backup/restore,
the chord-cleanup review UI (D12), accessibility pass, on-stage legibility testing.

**Rough total: 7–8 focused weeks.** Phases 1 and 5 carry the real risk; the rest is
well-understood work.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| **Chord transposition subtly wrong** — the classic enharmonic bug | Phase 1 is test-first, built from the real 73 spellings. Round-trip verification. Never ship a chord change the user did not ask for. |
| **Church WiFi blocks client isolation** (devices cannot reach each other) | Detect and say so clearly. Document the fallback: leader's laptop as a hotspot. This is a real and common failure. |
| **`better-sqlite3` native rebuild pain in Electron** | Pin Electron + Node ABI, `electron-rebuild` in CI. Fallback: `node:sqlite` (Node 22+) or `sql.js` if it becomes a time sink. |
| **ChordPro cannot express something we need** | Extensions are `{x_*}` custom directives, ignored by other parsers. Round-trip fidelity is a CI gate, so any loss fails the build rather than reaching a musician. |
| **A song will not fit one screen legibly** | Documented degradation ladder in §4b, ending in block mode rather than unreadable text. Visual regression tests at four widths. |
| **Migration loses or mangles a song** | Round-trip diff over all 153 files as a gate. Originals are never modified. Report-only chord normalisation. **Song count must be exactly 153 after import** — this is what catches the duplicate-uuid trap. |
| **Scope creep back toward projection/Bible/media** | The inventory is the contract. Anything new gets added there first, with a decision. |
| **Offline sync conflicts** | Last-write-wins + full revision history. No silent data loss; anything overwritten is recoverable. |
| **Phones sleeping mid-service** | Wake Lock API on `/band` and `/stage`, `powerSaveBlocker` in Electron. |

---

## 14. Open items

Non-blocking; all are small, additive, and fit the architecture whichever way they go.
Listed at the end of `docs/FEATURE-INVENTORY.md`: A9/A10 (txt & OpenSong import),
B12/B14/B15 (rarely used attributes), B20/B22/B26 (extra metadata, references,
translation layer), D13/D14 (Nashville numbers, chord diagrams), E4, F17, H4, J6,
K5/K6, L6, O9.

Next concrete step: **Phase 0 + Phase 1**, since the chord engine and the importer are
the foundation everything else stands on — and Phase 1 is what proves the 153 songs are
safe.
