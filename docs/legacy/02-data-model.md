# Legacy Data Model

Reconstructed from the exported XML parser methods in `SongBase.dll`, the `SongEditor`
menu tree (which exposes every field as a command), and the string tables.

## Evidence base

`SongBase.dll` exports one parse method per XML node type. This is effectively the
schema, written out by the compiler:

```
Song::processInfoNode()         Song::processLyricsNode()     Song::processVersesNode()
Song::processVerseNode()        Song::processBlockNode()      Song::processLineNode()
Song::processSongSmartNode()
SongSet::processSongNode()      SongSet::processSongEntryNode()
SongSet::processLineNode()      SongSet::processGapNode()
SongDisplayProfile::loadFromXml()   SongTextStyle::loadFromXml()
Song::getFileXmlNamespace(int)      SongSet::getFileXmlNamespace(int)
```

Literal XML fragments found in the binary:

```xml
<song xmlns="%s">            <songset xmlns=…>        <profile xmlns="swifttec/songdisplayprofile">
<verses>  <line …>  <chord>  <gap></gap>  <songentry …>
<uuid>  <updated>  <database>  <filename>  <br>
```

Namespaces are versioned — `getFileXmlNamespace(int version)` takes a format version.

---

## Song

### Identity & metadata (`<info>`)

Field names recovered from `SongBase.dll`:

| Field                               | Notes                                        |
| ----------------------------------- | -------------------------------------------- |
| `title`                             |                                              |
| `author`                            | Writer                                       |
| `artist`                            | Performer                                    |
| `publisher`                         |                                              |
| `copyright`                         |                                              |
| `cclinumber`                        | CCLI licence number (UK/US church reporting) |
| `key` / `key_line`                  | Song key                                     |
| `transpose`                         | Stored transposition offset                  |
| `tempo`                             | BPM — drives the beat indicator (see below)  |
| `time_sig` / `timesignature`        |                                              |
| `category`                          |                                              |
| `theme`                             |                                              |
| `description`                       |                                              |
| `translation`                       | Alternate-language lyric layer               |
| `music`                             | Composer credit                              |
| `bible`                             | Scripture reference                          |
| `uuid`                              | Stable identity across copies                |
| `updated` / `modifieddate`          |                                              |
| `database` / `filename` / `songsid` | Provenance back to the library               |
| `user1`, `user2`, `user3`           | Free user-defined fields                     |
| `annotations`                       | Notes / performance remarks                  |
| `reference` (repeating)             | See below                                    |
| `sequence`                          | Play order (see below)                       |

### References (`SongEditor.ini`)

A song carries a list of external references, each typed:

```
cd = Audio CD          dvd = DVD              book = Book
songbook = Song Book   website = Website      youtube = YouTube Link
other = Other
```

with fields: Title, Song No, Code, Track No, URL, Value.

### Structure — sections, then lines

```
Song
 └─ Section  (verse | chorus | bridge | prechorus | intro | ending | tag | misc)
     ├─ target        All | Leader | Band | Audience
     ├─ singers       Default | All | Women | Men | Leader | Choir |
     │                Children | Adults | Congregation | Audience
     ├─ repeat        n
     ├─ indent        n
     ├─ linked        "link to previous" / "unlink from previous"
     └─ Line
         ├─ singers   (same vocabulary, overrides section)
         ├─ repeat    n
         ├─ indent    n
         ├─ Chord     guitar chord, positioned within the lyric text
         └─ Bass note separate annotation layer from chords
```

Section types come straight from the `&Section → &Type` menu, with their shortcuts:

| Type       | Key        |
| ---------- | ---------- |
| Intro      | `Shift+F6` |
| Ending     | `Ctrl+F6`  |
| Verse      | `F6`       |
| Pre-Chorus | `Shift+F7` |
| Chorus     | `F7`       |
| Bridge     | `F8`       |
| Tag        | `Shift+F8` |
| Misc       | `Ctrl+F8`  |

### Two orthogonal "who" axes — this is the clever part

The legacy model separates **target** (which _screen_ shows this) from **singers**
(who _sings_ it, shown as a label). A section targeted `Band` appears on the band's
instrument view but never reaches the congregation projection. A section marked
`Women` is shown to everyone but labelled.

`SongBase.dll` string table 20001–20008 confirms the singer labels are localisable
display strings: `Choir, All, Ladies, Men, Leader, Congregation, Children, Adults`
(note: "Ladies" in the string table, "Women" in the menu — they drifted).

**Keep this model. It is the single best idea in the legacy app.**

### Sequence

Sections are authored once and then _ordered_ separately:

- `Sequence → Auto` — derive order from the sections as written
- `Sequence → Edit` — _"Click on each section in the order that they should be played"_
  (from `SongEditor.ini`)
- `Sequence → Clear`

So V1 C V2 C B C C is stored as a reference list, not duplicated text. The leader can
re-sequence live (`EditSequence` / `EndEditSequence` → _"Save Sequence"_ in
`SongBase.ini`).

### Chords

- Chords are anchored inside lyric lines (`<chord>` nested in `<line>`).
- **Bass notes are a separate layer** (`View → Bass Notes`, `F10`) — displayed
  independently of guitar chords.
- Two capo/transposition philosophies are compiled in as named modes:
  - `GuitarWithCapo` — show shapes for a capoed guitar
  - `PianoWithLocalTranspose` — show real sounding pitches
- `capochordsinbrackets` — show the capo chord in brackets beside the concert chord.
- Transpose and capo are **independent**: `Transpose Up/Down` (`Shift+F4`/`Shift+F3`)
  vs `Capo Up/Down` (`F4`/`F3`).

---

## Song Set (`.songset` / `.sst`)

```
SongSet
 ├─ SongEntry     reference to a song (by uuid + database + filename)
 │                 with per-set overrides (transpose, capo, sequence)
 ├─ Line          a free-text note in the running order
 └─ Gap           a spacer / non-song slot
```

`SongSet::processSongNode` **and** `processSongEntryNode` both exist — a set can
_embed_ a full song or _reference_ one. That matters: a set is portable even if the
receiving machine lacks the song.

---

## Display Profiles (`.sdp`)

`<profile xmlns="swifttec/songdisplayprofile">`, edited by `ProfileEditor.exe`.
Its wizard pages are named in the binary:

```
EditProfileWizardGeneral   EditProfileWizardDisplay    EditProfileWizardTextStyles
EditProfileWizardChords    EditProfileWizardLineColors
```

UI labels: _General, Layout, Keys and Chords, Text Styles, Notes / Annotations,
Text Color, Sample Text_.

### Contexts a profile can target

```
screen   print   projection   viewer   editor   presenterfollower   display
```

Shipped profiles: `SongViewerChords`, `SongViewerWords`, `SongViewerLargePrint (Screen)`,
`SongViewerLargePrint (Print)`, `SongEditor`, `PresenterFollower`.
Named print variants also compiled in: `LargePrint`, `LargePrintInverted`,
`ExtraLargePrint`, `ExtraLargePrintInverted`.

### Per-element text styles

A profile holds a `textstyles` map keyed by element, and a `linecolors` map.
Styleable elements (from the string table and ProfileEditor labels):

```
Title    Author    Copyright   Number    PageNo    Reference
Verse    Chorus    Bridge      Chord     Instruction
Book index entry   Book title entry
Header   Footer    Translation  Tempo    Time Signature  Sequence
```

Each style: `FontName`, `FontPtSize`, `FontMinPtSize`, `FontMaxPtSize`, `FontStyle`,
`FontColor`, `Italic`, `Outline`/`Outlined`, `Indent`, `BgColor`/`FgColor`.

Rendering/layout keys: `pagebackgroundcolor`, `highlightBgColor`, `highlightFadeTime`,
`wraplines`, `spacebefore`, `keepwithprevious`, `capochordsinbrackets`, `multi-column`.

Projection-specific (`ProjectorBase.dll`): `<colorText>`, `<colorBackground>`,
`<colorOutline>`, `<colorShadow>`, `<displayfont>`.

> **`FontMinPtSize` / `FontMaxPtSize` is the auto-fit mechanism** — text scales between
> bounds to fill the display. Essential for projection; reproduce it.

---

## Beat / tempo indicator

`SongWndBase.dll` references four images and two font settings:

```
beat-led-green-on.png   beat-led-green-off.png
beat-led-red-on.png     beat-led-red-off.png
BeatButtonFontName      BeatButtonFontSize
```

Combined with `tempo` + `timesignature` on the song and the `SetTempo` / `ResetTempo`
buttons: **a visual metronome**, red LED on the downbeat, green on other beats. The
leader sets tempo and everyone's display blinks in time.

---

## Bible

`SongBase.dll` contains the full 66-book name list (Genesis…Revelation) plus
`BookIndexEntry`, `BookTitleEntry`, `nbooks`, `.book` files, and
`Bible::importBblFile` / `importBblFolder` / `importFromFile`. Bible passages can be
presented alongside songs via `Presenter.exe`.

---

## Import formats supported

From `SongBase.ini [SongFileType]`:

```
standard  = SwiftTec Song File (.song)
text      = Plain Text File (.txt)
sng       = Presentation Manager Pro File (.sng)
opensong  = OpenSong File
```

Plus `.songbundle` (multi-song archive) and `Song/Bible/Image/Media` database folders.
