# Analysis of the Real Song Library

**Source:** `~/Downloads/Song Files/` — 153 `.song` files, plus a 70-file subfolder
`Song files L&I`, two `.docx` exports, and `vizualizator_cantare.html` (an earlier
single-file HTML viewer attempt with transpose + PDF export, Romanian UI).

This is ground truth. It overrides anything inferred from the binaries, and it is far
more useful than the legacy feature list, because it shows **which features are actually
used and which are being worked around**.

## The real file format

```xml
<?xml version="1.0"?>
<song xmlns="swifttec/song">
<uuid>06dcc480-8fb7-4876-82fb-b645466707ce</uuid>
<updated>20241119205837</updated>            <!-- YYYYMMDDhhmmss -->
<info>
  <sequence>auto</sequence>
  <author></author>
  <title>Bunatatea Ta</title>
  <cclinumber></cclinumber>
  <timesignature></timesignature>
  <defaulttranspose>0</defaulttranspose>
  <key>Bb</key>
  <copyright></copyright>
  <tempo></tempo>
</info>

<block type="Misc" id="M1">
  <line>TRANSPOSE: G+3=>Bb</line>
  <line>INTRO chitara: G C G x2</line>
</block>

<block type="Verse" id="V1">
  <line>Eu Te iu<chord>G</chord>besc, mila <chord>C</chord>Ta e nesfâr<chord>G</chord>șită</line>
</block>
</song>
```

Notes on the real format vs. what the binaries suggested:

- The element is **`<block>`**, not `<verse>`/`<verses>`. Those parser methods exist in
  `SongBase.dll` for older format versions; nothing in this library uses them.
- `<chord>X</chord>` is inline and **anchored immediately before the syllable** it lands on.
- `id` follows `<TypeInitial><n>`: `V1`, `C2`, `M1`, `B1`, `E1`, `P1`, `I1`, `T1`.
- The file is UTF-8 **with BOM**, `\r\n` line endings, no XML declaration encoding attribute.

### Frequency counts (153 files)

| Element / attribute | Count |
|---|---|
| `<chord>` | 3504 |
| `<line>` | 3320 |
| `<block>` | 1045 |
| `line@singers` | 179 |
| `block@repeat` | 37 |
| `line@indent` | 27 |
| `block@singers` | 6 |
| `block@indent` | 1 |
| `line@repeat` | 1 |
| **`block@target`** | **0** |

| Block type | Count |
|---|---|
| Verse | 386 |
| **Misc** | **303** |
| Chorus | 214 |
| Bridge | 79 |
| Ending | 39 |
| PreChorus | 19 |
| Intro | 4 |
| Tag | 1 |

| `<info>` field | Non-empty (of 153) |
|---|---|
| `sequence` | 153 (**always the literal `auto`**) |
| `title` | 152 |
| `key` | 152 |
| `defaulttranspose` | 148 (**always `0`**) |
| `tempo` | 28 |
| `timesignature` | 25 |
| `author` | 6 |
| `index`, `category` | 2 |
| `copyright` | 1 |
| `cclinumber` | 0 |

---

## The five findings that should drive the rewrite

### 1. The sequence feature is dead. Arrangement lives in free text.

`<sequence>` is `auto` in **all 153 files**. Nobody has ever used the sequence editor.
Instead, the arrangement is typed as prose into `Misc` blocks:

```
STRUCTURA: Strofa -> Refren x1 -> Strofa -> Refren x2 -> Final
Refren x2
Bridge x1
2 X REF
```

**Implication:** the legacy sequence editor (*"Click on each section in the order that
they should be played"*) was too clumsy to use. The new app needs arrangement to be
either (a) genuinely effortless — drag chips into a row — or (b) parsed from the text
people already write. Do not simply reimplement the old modal editor.

### 2. `Misc` blocks are the second-most-common block type — they are unmet requirements.

303 Misc blocks. Their first words, counted:

| Prefix | Count | What it really is |
|---|---|---|
| `INTRO:` | 83 | An intro cue — chords, or "prima jumatate de Refren" |
| `REFREN` / `REF` / `2 X REF` / `2XREF` | ~95 | Arrangement/repeat directive |
| `INSTRUMENTAL` / `INSTR` | 46 | An instrumental break |
| `SOLO` (often `SOLO Dennis:`) | 23 | **A named person's solo** |
| `TRANSPOSE:` / `GAMA:` | 22 | Key change instruction |
| `TOTI` ("everyone") | 15 | Who sings |
| `STROFA` | 9 | Verse pointer |
| `BRIDGE`, `INTRARE`, `FINAL`, `STRUCTURA`, `REPETAM` | ~20 | Structure |

Real examples:

```
INTRO: C F (de cate ori e nevoie)
INTRO: (A Bm G) x2
INTRO: primele 2 versuri din strofa
INSTRUMENTAL: D A Bm G - forte
SOLO Dennis:
TOTI:
GAMA: D+1 => Eb
STRUCTURA: Strofa -> Refren x1 -> Strofa -> Refren x2 -> Final
```

**Implication:** the new app wants first-class **cue blocks** — Intro, Instrumental,
Solo (with an assignable person), Tag, plus a free note. And an arrangement strip.
These are being hand-typed 300 times because the model has no slot for them.

### 3. Transposition is being done by hand, in comments.

`defaulttranspose` is `0` in all 148 files that have it. Yet 22 files carry a
`TRANSPOSE: G+3 => Bb` note, and **filenames are prefixed with the performance key**
(`Bb - Bunatatea Ta.song`, `G# - Domn al trezirii.song`).

So the workflow is: chords are written in a **comfortable guitar key**, the song is
**performed in a different key**, and the gap is recorded as a text note and in the
filename.

**Implication:** the new app needs an explicit, first-class distinction between
**written key** and **performance key**, with automatic transposition and a per-musician
capo view. This is probably the single biggest quality-of-life win available. Get it
right and 22 comment blocks and 153 filename prefixes disappear.

### 4. `singers` is genuinely used — 179 times. Keep it.

| Value | Count |
|---|---|
| `Leader` | 126 |
| `Women` | 29 |
| `Men` | 18 |
| `All` | 12 |

Mostly on `<line>`, occasionally on `<block>`. Plus the untyped `TOTI:` Misc lines,
which are the same idea escaping into free text.

`target` (All/Leader/Band/Audience) is used **zero** times — that concept can be dropped
or redesigned.

### 5. Chord data is dirty and must be parsed leniently.

73 distinct chord strings across 3504 chord tags. Problems found:

| Written | Count | Issue |
|---|---|---|
| `Cm#` | 35 | Should be `C#m` — modifier order reversed |
| `Fm#` | 30 | Should be `F#m` |
| `Gm#` | 2 | Should be `G#m` |
| `C#min` | 4 | Non-standard suffix |
| `b`, `c#` | 15, 12 | Lowercase root |
| `G(A)`, `C(D)`, `D(E)`, `Am(Bm)`, `Em(C,D)` | ~25 | Alternate/optional chord in parentheses |
| `G A` | 1 | Two chords in one tag |
| `C#/A`, `G/A`, `D/A`, `G/B`, `Em/D`, `F#/D`, `B/E` | ~20 | Slash chords (valid, must transpose **both** parts) |

`<key>` is also dirty: `b`, `c#`, `G - A` alongside valid values.

**Implication:** the chord parser must accept all of this without throwing, transpose
slash chords on both sides, and preserve parenthesised alternates. A one-time
**normalisation pass with a review UI** would clean the library — but it must be
opt-in and reversible, never silent.

### Other conventions in use

- **`/: … :/`** repeat brackets appear **233 times** as literal text inside lines — the
  German/Romanian repeat convention. The structured `repeat` attribute is used only 38
  times. The renderer must display `/: :/` properly, and ideally offer to convert.
- Everything is **Romanian**, including the `.docx` exports
  (*"Cantari - versuri si acorduri"*, *"Cantari - doar versuri"*) — so **words-only** and
  **words+chords** printed output are both real, established needs.
- The 70-file `Song files L&I` subfolder suggests folders are used for grouping.
  Some filenames carry a trailing ` - D` (e.g. `C - O inima curata - D.song`), likely a
  second key or a variant marker.

---

## ⚠️ Two corrections found on closer inspection

### UUIDs are NOT unique — do not use them as the primary key

5 uuids are shared across **11 different songs**:

```
02884a58-f4c1-4622-9e17-ae17c5af05f5   ← 4 different songs
  A - Cand stam in rugaciune (Cheama-i azi Numele).song
  D - Toata inima.song
  D - Doamne vreau sa Te slujesc.song
  E - Cuiele nu Te-au tinut pe cruce.song

02348e6e-…  D - Un cantec de lauda        / G# - Cine e vrednic
0e6dec6a-…  A - Nu-i nimeni ca Tine Isus  / B - Laud Numele Tau Isus - ending
148b49d7-…  Eb - O inima curata Doamne    / Eb - Traiesc pentru Tine
16bfeee2-…  A- Doamne esti un Tata bun    / E - Ogoarele sunt gata
```

The cause is obvious: **a new song is made by copying an existing `.song` file and
editing it**, and the legacy editor never reissued the uuid.

**Consequence for the importer:** keying on `uuid` alone would silently collapse 11 songs
into 5 and lose 6 of them. Instead:

- match on `(uuid, normalised title)`
- on a uuid collision with a *different* title, mint a fresh uuid and keep the original
  in `legacyUuid` for traceability
- report every collision in the migration report for review

Also note the folders are disjoint — 76 songs in the root, 70 in `Song files L&I`,
**zero uuid overlap between them**. They are two separate collections, not a backup copy.

### The filename suffix is the performance key — D3 confirmed

Five files carry a second key as a suffix, and the `<key>` field sometimes holds *both*:

| Filename | `<key>` | Chords written in |
|---|---|---|
| `C - Dumnezeu e dragostea mea - D.song` | `C` | C |
| `C - O inima curata - D.song` | **`C-D`** | C |
| `G - Pentru cruce-Ti multumesc - A.song` | **`G - A`** | G |
| `G - Traim vremi de har ca Ilie - A.song` | `G` | G |
| `D - Intr-o zi cand viata va-nceta - E.song` | `D` | D |

So the convention is `<written key> - <title> - <performance key>`, and when the field
couldn't express it, both keys were crammed into `<key>` as `C-D` / `G - A`.

This is the same workaround as the `TRANSPOSE: G+3=>Bb` notes, in a third form. Three
separate hand-made conventions for one missing field is about as strong a signal as
requirements analysis ever gives you. **D3 is confirmed as the top priority.**

---

## Migration verdict

The library is small (153 songs), clean XML, well-formed, and fully parseable. The one
real hazard is the **duplicate uuids** above — handle those and there is no migration
risk. Keep the legacy uuid where it is unique so re-imports merge rather than duplicate,
but never trust it blindly.
