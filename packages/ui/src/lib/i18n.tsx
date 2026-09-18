import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import type { BlockType, Singers } from '@worship/core';
import { usePrefs } from './settings.js';

/**
 * Two languages, one dictionary.
 *
 * Romanian is the default because that is what the band speaks; English exists because
 * the song library is not only Romanian, and because a visiting musician holding a
 * borrowed tablet should not be locked out of the controls.
 *
 * The English dictionary is typed as `Record<Key, Entry>` over the Romanian one, so a
 * missing translation is a **compile error**. That is the whole point: a half-translated
 * interface discovered during a service is worse than one that was never translated,
 * because it looks like something broke.
 *
 * Plurals go through `Intl.PluralRules`, which ships with the browser and needs no
 * network. Romanian has three forms and the third is not optional — 153 songs is
 * "153 de cântări", and "153 cântări" reads as a typo to anyone who speaks it.
 */

export type Lang = 'ro' | 'en';

interface Plural {
  one: string;
  few: string;
  other: string;
}
type Entry = string | Plural;

const ro = {
  // --- shared ---------------------------------------------------------------
  'app.name': 'Worship Archive',
  'app.library': 'Biblioteca',
  'app.sets': 'Programe',
  'app.lead': 'Condu',
  'app.band': 'Trupă',
  'app.stage': 'Ecran',
  'app.join': 'Conectare',
  'app.settings': 'Setări',
  'app.import': 'Importă',
  'app.back': 'Înapoi',
  'app.loading': 'Se încarcă…',
  'app.cancel': 'Anulează',
  'app.close': 'Închide',
  'app.save': 'Salvează',
  'app.delete': 'Șterge',
  'app.print': 'Print / PDF',
  'app.untitled': '(fără titlu)',
  'app.skipToContent': 'Sari la conținut',

  'save.dirty': 'nesalvat',
  'save.saving': 'se salvează…',
  'save.saved': 'salvat',
  'save.error': 'eroare la salvare',

  'status.live': 'conectat',
  'status.connecting': 'se conectează',
  'status.offline': 'deconectat',
  'status.reconnecting': 'se reconectează…',

  // --- library --------------------------------------------------------------
  'library.search': 'Caută titlu sau versuri…',
  'library.new': '+ Cântare nouă',
  'library.all': 'Toate',
  'library.count': {
    one: '{count} cântare',
    few: '{count} cântări',
    other: '{count} de cântări',
  },
  'library.found': 'găsite',
  'library.offlineBadge': 'offline · {count} salvate local',
  'library.empty': 'Biblioteca este goală.',
  'library.emptyHint': 'Importă cântările existente, sau scrie prima.',
  'library.nothingFor': 'Nimic pentru „{query}”',
  'library.loadError': 'Nu pot încărca biblioteca: {error}',
  'library.writtenPlayed': 'scrisă în {written}, cântată în {performance}',

  // --- song view ------------------------------------------------------------
  'song.notLocal': 'Cântarea nu e în biblioteca salvată local.',
  'song.loadError': 'Nu pot încărca cântarea: {error}',
  'song.key': 'tonalitate {key}',
  'song.writtenPlayed': 'scrisă în {written} · cântată în {performance}',
  'song.transposed': 'transpusă {amount}',
  'song.capo': 'capo {fret}',
  'song.pitch': 'Ton',
  'song.capoLabel': 'Capo',
  'song.chords': 'Acorduri',
  'song.bass': 'Bas',
  'song.edit': 'Editează',
  'song.doesNotFit': 'Nu încape pe un ecran — derulează, sau ascunde acordurile.',
  'song.transposeDown': 'Coboară cu un semiton',
  'song.transposeUp': 'Urcă cu un semiton',
  'song.transposeReset': 'Înapoi la tonalitatea cântării',
  'song.capoDown': 'Capo mai jos',
  'song.capoUp': 'Capo mai sus',

  // --- editor ---------------------------------------------------------------
  'edit.title': 'Titlul cântării',
  'edit.undo': 'Anulează (Cmd+Z)',
  'edit.redo': 'Refă (Cmd+Shift+Z)',
  'edit.preview': 'Previzualizare',
  'edit.sectionType': 'Tipul secțiunii',
  'edit.label': 'etichetă (ex. Dennis)',
  'edit.whoSings': 'cine cântă…',
  'edit.whoSingsLabel': 'Cine cântă',
  'edit.repeats': 'Repetări',
  'edit.linked': 'lipit',
  'edit.linkedHint': 'Ține lipit de secțiunea anterioară',
  'edit.bandOnly': 'trupă',
  'edit.bandOnlyHint': 'Doar pentru trupă — nu ajunge pe ecranul mare',
  'edit.moveUp': 'Sus',
  'edit.moveDown': 'Jos',
  'edit.mergeUp': 'Unește cu cea de sus',
  'edit.removeSection': 'Șterge secțiunea',
  'edit.addLine': '+ linie',
  'edit.split': 'desparte',
  'edit.addSectionBelow': '+ secțiune dedesubt',
  'edit.deleteSong': 'Șterge cântarea',
  'edit.deleteConfirm': 'Ștergi definitiv „{title}”?',
  'edit.writtenKey': 'Tonalitate scrisă',
  'edit.performanceKey': 'Tonalitate cântată',
  'edit.tempo': 'Tempo',
  'edit.timeSignature': 'Măsură',
  'edit.author': 'Autor',
  'edit.tags': 'Categorie / temă',
  'edit.copyright': 'Copyright',
  'edit.ccli': 'CCLI',
  'edit.editChord': 'Editează acordul',
  'edit.addChord': 'Adaugă acord la cursor (F9)',

  // --- sets -----------------------------------------------------------------
  'sets.new': '+ Program nou',
  'sets.newTitle': 'Program nou',
  'sets.noDate': 'fără dată',
  'sets.duplicate': 'Duplică',
  'sets.duplicateHint': 'Pornește de la acest program',
  'sets.empty': 'Niciun program încă. Creează unul pentru duminica viitoare.',
  'sets.notLocal': 'Programul nu e salvat local.',
  'sets.name': 'Numele programului',
  'sets.deleteConfirm': 'Ștergi programul „{title}”?',
  'sets.addFirst': 'Adaugă prima cântare din listă →',
  'sets.addNote': '+ notă',
  'sets.addGap': '+ pauză',
  'sets.note': 'notă',
  'sets.gap': 'pauză',
  'sets.notePlaceholder': 'ex. rugăciune, anunțuri…',
  'sets.gapPlaceholder': 'ex. predică',
  'sets.minutes': 'min',
  'sets.searchSong': 'Caută cântare…',
  'sets.plannedGaps': 'Pauze planificate: {minutes} min',
  'sets.missingSong': '(cântare lipsă)',
  'sets.key': 'ton',
  'sets.capo': 'capo',
  'sets.removeFromSet': 'Scoate din program',
  'sets.keyShifted':
    'în bibliotecă {native}, în acest program {override} ({semitones} semitonuri)',

  // --- lead -----------------------------------------------------------------
  'lead.choose': '— alege programul —',
  'lead.auto': 'Auto',
  'lead.manual': 'Manual',
  'lead.byBlock': 'Pe blocuri',
  'lead.bySong': 'Pe cântare',
  'lead.clear': 'Gol',
  'lead.black': 'Negru',
  'lead.tap': 'Tap',
  'lead.stopTempo': 'Oprește metronomul',
  'lead.sendToScreens': 'Trimite pe ecrane (Space) — te uiți înainte, nimeni nu vede încă',
  'lead.pickSet': 'Alege un program din lista de sus.',
  'lead.notASong': 'Acest element nu e o cântare.',
  'lead.noSet': 'Niciun program selectat.',
  'lead.wholeSong': 'toată cântarea',
  'lead.connected': 'Conectați ({count})',
  'lead.qr': 'Cod QR pentru conectare',
  'lead.roleStage': 'ecran',
  'lead.roleLeader': 'lider',
  'lead.unnamedDevice': 'dispozitiv',

  // --- band -----------------------------------------------------------------
  'band.noLiveSet': 'Niciun program live',
  'band.backToLeader': '↩ Înapoi la lider',
  'band.leaderNotOnSong': 'Liderul nu e pe o cântare.',
  'band.waiting': 'Așteptăm liderul…',
  'band.yourName': 'Numele tău (ex. Dennis — chitară)',
  'band.defaultName': 'muzician',

  // --- join -----------------------------------------------------------------
  'join.title': 'Conectează un dispozitiv',
  'join.subtitle': 'Toate dispozitivele trebuie să fie pe același WiFi. Nu e nevoie de internet.',
  'join.orType': 'Sau scrie adresa',
  'join.usuallyWorks': 'merge de obicei',
  'join.alwaysWorks': 'merge întotdeauna',
  'join.multipleNetworks':
    'Sunt mai multe adrese pentru că acest calculator e pe mai multe rețele. Încearcă-le pe rând.',
  'join.noNetwork': 'Acest calculator nu pare conectat la o rețea — nimeni nu îl poate găsi.',
  'join.qrAlt': 'Cod QR pentru {url}',
  'join.readError': 'Nu pot citi adresa: {error}',

  // --- import ---------------------------------------------------------------
  'import.title': 'Importă cântări',
  'import.subtitle':
    'ChordPro, OpenSong, fișiere .song din programul vechi, sau text cu acorduri copiat de oriunde. Formatul e recunoscut automat.',
  'import.pickFiles': 'Alege fișiere…',
  'import.dropHere': 'Trage fișierele aici',
  'import.pasteLabel': 'Sau lipește textul aici',
  'import.pastePlaceholder': 'Lipește o cântare cu acorduri…',
  'import.pasteButton': 'Citește textul lipit',
  'import.readyCount': {
    one: '{count} cântare gata de import',
    few: '{count} cântări gata de import',
    other: '{count} de cântări gata de import',
  },
  'import.importAll': 'Importă tot',
  'import.importing': 'Se importă…',
  'import.done': '{count} importate.',
  'import.failed': '{count} au eșuat.',
  'import.format': 'format',
  'import.formatChordpro': 'ChordPro',
  'import.formatOpensong': 'OpenSong',
  'import.formatLegacy': 'Program vechi (.song)',
  'import.formatPlain': 'Text cu acorduri',
  'import.blocks': {
    one: '{count} secțiune',
    few: '{count} secțiuni',
    other: '{count} de secțiuni',
  },
  'import.chords': {
    one: '{count} acord',
    few: '{count} acorduri',
    other: '{count} de acorduri',
  },
  'import.noChords': 'fără acorduri — verifică înainte de import',
  'import.remove': 'Scoate din listă',
  'import.nothing': 'Nimic de importat încă.',
  'import.openAfter': 'Deschide',

  // --- settings -------------------------------------------------------------
  'settings.title': 'Setări',
  'settings.language': 'Limbă',
  'settings.theme': 'Temă',
  'settings.themeAuto': 'Ca sistemul',
  'settings.themeLight': 'Luminos',
  'settings.themeDark': 'Întunecat',
  'settings.themeStage': 'Scenă',
  'settings.themeStageHint':
    'Negru aproape complet, cu text mare și cald. Pentru ecranul de pe scenă într-o sală întunecată.',
  'settings.display': 'Afișare',
  'settings.maxFont': 'Mărimea maximă a textului',
  'settings.maxFontHint':
    'O limită, nu o comandă — textul se micșorează singur până când cântarea încape pe un ecran.',
  'settings.showChords': 'Arată acordurile',
  'settings.showBass': 'Arată linia de bas',
  'settings.library': 'Bibliotecă',
  'settings.dataDir': 'Dosarul cu cântări',
  'settings.chooseDataDir': 'Schimbă dosarul…',
  'settings.revealDataDir': 'Deschide dosarul',
  'settings.chooseDataDirHint': 'Aplicația repornește după ce alegi alt dosar.',
  'settings.backup': 'Copie de siguranță',
  'settings.backupHint':
    'Un singur fișier cu textul tuturor cântărilor și programelor. Se poate deschide în orice editor de text.',
  'settings.download': 'Descarcă o copie',
  'settings.restore': 'Restaurează dintr-o copie…',
  'settings.restoreMerge': 'Adaugă la ce există',
  'settings.restoreReplace': 'Înlocuiește tot',
  'settings.restoreConfirm':
    'Se înlocuiește întreaga bibliotecă cu ce e în fișier. Cântările care nu sunt în copie se șterg.',
  'settings.restored': '{songs} cântări și {sets} programe restaurate.',
  'settings.restoreFailed': 'Nu am putut restaura: {error}',
  'settings.cleanup': 'Îndreptarea acordurilor',
  'settings.cleanupHint':
    'Caută acorduri scrise neobișnuit (Cm# în loc de C#m) și îți arată fiecare propunere înainte să schimbe ceva.',
  'settings.openCleanup': 'Vezi propunerile',
  'settings.desktop': 'Aplicație desktop',
  'settings.preventSleep': 'Ține ecranul aprins',
  'settings.preventSleepHint': 'Împiedică adormirea calculatorului în timpul serviciului.',
  'settings.autoStart': 'Pornește odată cu calculatorul',
  'settings.version': 'Versiunea {version}',
  'settings.mirror': 'Pe acest dispozitiv: {songs} salvate local',
  'settings.lastSync': 'ultima sincronizare {when}',
  'settings.neverSynced': 'nesincronizat încă',
  'settings.resync': 'Sincronizează acum',
  'settings.shortcuts': 'Scurtături de tastatură',

  // --- chord cleanup --------------------------------------------------------
  'cleanup.title': 'Îndreptarea acordurilor',
  'cleanup.intro':
    'Nimic nu se schimbă până nu bifezi și apeși „Aplică”. Acordurile pe care nu le bifezi rămân exact cum sunt.',
  'cleanup.scanning': 'Se caută…',
  'cleanup.summary': '{chords} de îndreptat în {songs}, din {scanned} verificate.',
  'cleanup.songsAffected': {
    one: '{count} cântare',
    few: '{count} cântări',
    other: '{count} de cântări',
  },
  'cleanup.nothing': 'Toate acordurile sunt scrise standard. Nimic de făcut.',
  'cleanup.selectAll': 'Bifează tot',
  'cleanup.selectNone': 'Debifează tot',
  'cleanup.apply': 'Aplică {count} îndreptări',
  'cleanup.applying': 'Se aplică…',
  'cleanup.applied': '{chords} acorduri schimbate în {songs}.',
  'cleanup.stale': '{count} au fost sărite — cântarea s-a schimbat între timp.',
  'cleanup.becomes': 'devine',
  'cleanup.reason': 'motiv',
  'cleanup.occurrences': {
    one: 'o dată',
    few: 'de {count} ori',
    other: 'de {count} de ori',
  },
  'cleanup.undoHint':
    'Fiecare cântare schimbată păstrează versiunea anterioară în istoric, deci se poate reveni.',

  // --- shortcuts ------------------------------------------------------------
  'keys.title': 'Scurtături de tastatură',
  'keys.hint': 'Apasă ? oricând pentru a vedea lista.',
  'keys.nextSong': 'Cântarea următoare',
  'keys.prevSong': 'Cântarea anterioară',
  'keys.nextBlock': 'Secțiunea următoare',
  'keys.prevBlock': 'Secțiunea anterioară',
  'keys.sendLive': 'Trimite pe ecrane',
  'keys.black': 'Ecran negru',
  'keys.clear': 'Ecran gol',
  'keys.autoManual': 'Auto / Manual',
  'keys.backToLeader': 'Înapoi la lider',
  'keys.chords': 'Arată / ascunde acordurile',
  'keys.transposeUp': 'Urcă cu un semiton',
  'keys.transposeDown': 'Coboară cu un semiton',
  'keys.search': 'Caută',
  'keys.help': 'Această listă',
  'keys.undo': 'Anulează',
  'keys.redo': 'Refă',
  'keys.print': 'Printează',

  // --- block types ----------------------------------------------------------
  'block.Verse': 'Strofă',
  'block.Chorus': 'Refren',
  'block.PreChorus': 'Pre-refren',
  'block.Bridge': 'Pod',
  'block.Ending': 'Final',
  'block.Tag': 'Tag',
  'block.Intro': 'Intro',
  'block.Instrumental': 'Instrumental',
  'block.Solo': 'Solo',
  'block.Note': 'Notă',

  // --- who sings ------------------------------------------------------------
  'singers.Leader': 'Lider',
  'singers.All': 'Toți',
  'singers.Women': 'Femei',
  'singers.Men': 'Bărbați',
  'singers.Choir': 'Cor',
  'singers.Children': 'Copii',
  'singers.Adults': 'Adulți',
  'singers.Congregation': 'Adunarea',
} as const satisfies Record<string, Entry>;

export type TranslationKey = keyof typeof ro;

const en: Record<TranslationKey, Entry> = {
  'app.name': 'Worship Archive',
  'app.library': 'Library',
  'app.sets': 'Sets',
  'app.lead': 'Lead',
  'app.band': 'Band',
  'app.stage': 'Stage',
  'app.join': 'Join',
  'app.settings': 'Settings',
  'app.import': 'Import',
  'app.back': 'Back',
  'app.loading': 'Loading…',
  'app.cancel': 'Cancel',
  'app.close': 'Close',
  'app.save': 'Save',
  'app.delete': 'Delete',
  'app.print': 'Print / PDF',
  'app.untitled': '(untitled)',
  'app.skipToContent': 'Skip to content',

  'save.dirty': 'unsaved',
  'save.saving': 'saving…',
  'save.saved': 'saved',
  'save.error': 'could not save',

  'status.live': 'connected',
  'status.connecting': 'connecting',
  'status.offline': 'disconnected',
  'status.reconnecting': 'reconnecting…',

  'library.search': 'Search titles or lyrics…',
  'library.new': '+ New song',
  'library.all': 'All',
  'library.count': { one: '{count} song', few: '{count} songs', other: '{count} songs' },
  'library.found': 'found',
  'library.offlineBadge': 'offline · {count} stored on this device',
  'library.empty': 'The library is empty.',
  'library.emptyHint': 'Import the songs you already have, or write the first one.',
  'library.nothingFor': 'Nothing for “{query}”',
  'library.loadError': 'Could not load the library: {error}',
  'library.writtenPlayed': 'written in {written}, played in {performance}',

  'song.notLocal': 'This song is not in the copy stored on this device.',
  'song.loadError': 'Could not load the song: {error}',
  'song.key': 'key of {key}',
  'song.writtenPlayed': 'written in {written} · played in {performance}',
  'song.transposed': 'transposed {amount}',
  'song.capo': 'capo {fret}',
  'song.pitch': 'Key',
  'song.capoLabel': 'Capo',
  'song.chords': 'Chords',
  'song.bass': 'Bass',
  'song.edit': 'Edit',
  'song.doesNotFit': 'Will not fit one screen — scroll, or hide the chords.',
  'song.transposeDown': 'Down a semitone',
  'song.transposeUp': 'Up a semitone',
  'song.transposeReset': "Back to the song's own key",
  'song.capoDown': 'Capo down',
  'song.capoUp': 'Capo up',

  'edit.title': 'Song title',
  'edit.undo': 'Undo (Cmd+Z)',
  'edit.redo': 'Redo (Cmd+Shift+Z)',
  'edit.preview': 'Preview',
  'edit.sectionType': 'Section type',
  'edit.label': 'label (e.g. Dennis)',
  'edit.whoSings': 'who sings…',
  'edit.whoSingsLabel': 'Who sings',
  'edit.repeats': 'Repeats',
  'edit.linked': 'keep together',
  'edit.linkedHint': 'Keep on the same screen as the section above',
  'edit.bandOnly': 'band only',
  'edit.bandOnlyHint': 'Band only — never reaches the stage display',
  'edit.moveUp': 'Up',
  'edit.moveDown': 'Down',
  'edit.mergeUp': 'Merge into the section above',
  'edit.removeSection': 'Delete section',
  'edit.addLine': '+ line',
  'edit.split': 'split',
  'edit.addSectionBelow': '+ section below',
  'edit.deleteSong': 'Delete this song',
  'edit.deleteConfirm': 'Permanently delete “{title}”?',
  'edit.writtenKey': 'Written key',
  'edit.performanceKey': 'Performance key',
  'edit.tempo': 'Tempo',
  'edit.timeSignature': 'Time signature',
  'edit.author': 'Author',
  'edit.tags': 'Category / theme',
  'edit.copyright': 'Copyright',
  'edit.ccli': 'CCLI',
  'edit.editChord': 'Edit this chord',
  'edit.addChord': 'Add a chord at the cursor (F9)',

  'sets.new': '+ New set',
  'sets.newTitle': 'New set',
  'sets.noDate': 'no date',
  'sets.duplicate': 'Duplicate',
  'sets.duplicateHint': 'Start from this set',
  'sets.empty': 'No sets yet. Make one for next Sunday.',
  'sets.notLocal': 'This set is not stored on this device.',
  'sets.name': 'Set name',
  'sets.deleteConfirm': 'Delete the set “{title}”?',
  'sets.addFirst': 'Add the first song from the list →',
  'sets.addNote': '+ note',
  'sets.addGap': '+ gap',
  'sets.note': 'note',
  'sets.gap': 'gap',
  'sets.notePlaceholder': 'e.g. prayer, announcements…',
  'sets.gapPlaceholder': 'e.g. sermon',
  'sets.minutes': 'min',
  'sets.searchSong': 'Search for a song…',
  'sets.plannedGaps': 'Planned gaps: {minutes} min',
  'sets.missingSong': '(missing song)',
  'sets.key': 'key',
  'sets.capo': 'capo',
  'sets.removeFromSet': 'Remove from the set',
  'sets.keyShifted': '{native} in the library, {override} in this set ({semitones} semitones)',

  'lead.choose': '— choose a set —',
  'lead.auto': 'Auto',
  'lead.manual': 'Manual',
  'lead.byBlock': 'By section',
  'lead.bySong': 'By song',
  'lead.clear': 'Clear',
  'lead.black': 'Black',
  'lead.tap': 'Tap',
  'lead.stopTempo': 'Stop the metronome',
  'lead.sendToScreens': 'Send to the screens (Space) — you are looking ahead, nobody sees it yet',
  'lead.pickSet': 'Choose a set from the list above.',
  'lead.notASong': 'This item is not a song.',
  'lead.noSet': 'No set selected.',
  'lead.wholeSong': 'whole song',
  'lead.connected': 'Connected ({count})',
  'lead.qr': 'QR code to join',
  'lead.roleStage': 'stage',
  'lead.roleLeader': 'leader',
  'lead.unnamedDevice': 'device',

  'band.noLiveSet': 'No set is live',
  'band.backToLeader': '↩ Back to the leader',
  'band.leaderNotOnSong': 'The leader is not on a song.',
  'band.waiting': 'Waiting for the leader…',
  'band.yourName': 'Your name (e.g. Dennis — guitar)',
  'band.defaultName': 'musician',

  'join.title': 'Connect a device',
  'join.subtitle': 'Every device has to be on the same WiFi. No internet needed.',
  'join.orType': 'Or type the address',
  'join.usuallyWorks': 'usually works',
  'join.alwaysWorks': 'always works',
  'join.multipleNetworks':
    'There are several addresses because this computer is on more than one network. Try them in turn.',
  'join.noNetwork': 'This computer does not seem to be on a network — nobody can find it.',
  'join.qrAlt': 'QR code for {url}',
  'join.readError': 'Could not read the address: {error}',

  'import.title': 'Import songs',
  'import.subtitle':
    'ChordPro, OpenSong, .song files from the old program, or chords-over-lyrics text copied from anywhere. The format is detected for you.',
  'import.pickFiles': 'Choose files…',
  'import.dropHere': 'Drop files here',
  'import.pasteLabel': 'Or paste the text here',
  'import.pastePlaceholder': 'Paste a song with chords…',
  'import.pasteButton': 'Read the pasted text',
  'import.readyCount': {
    one: '{count} song ready to import',
    few: '{count} songs ready to import',
    other: '{count} songs ready to import',
  },
  'import.importAll': 'Import all',
  'import.importing': 'Importing…',
  'import.done': '{count} imported.',
  'import.failed': '{count} failed.',
  'import.format': 'format',
  'import.formatChordpro': 'ChordPro',
  'import.formatOpensong': 'OpenSong',
  'import.formatLegacy': 'Old program (.song)',
  'import.formatPlain': 'Chords over lyrics',
  'import.blocks': { one: '{count} section', few: '{count} sections', other: '{count} sections' },
  'import.chords': { one: '{count} chord', few: '{count} chords', other: '{count} chords' },
  'import.noChords': 'no chords found — check before importing',
  'import.remove': 'Remove from the list',
  'import.nothing': 'Nothing to import yet.',
  'import.openAfter': 'Open',

  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.theme': 'Theme',
  'settings.themeAuto': 'Match the system',
  'settings.themeLight': 'Light',
  'settings.themeDark': 'Dark',
  'settings.themeStage': 'Stage',
  'settings.themeStageHint':
    'Near-black with large warm text. For the display on stage in a dark room.',
  'settings.display': 'Display',
  'settings.maxFont': 'Largest text size',
  'settings.maxFontHint':
    'A ceiling, not a command — the text shrinks by itself until the song fits one screen.',
  'settings.showChords': 'Show chords',
  'settings.showBass': 'Show the bass line',
  'settings.library': 'Library',
  'settings.dataDir': 'Song folder',
  'settings.chooseDataDir': 'Change folder…',
  'settings.revealDataDir': 'Open the folder',
  'settings.chooseDataDirHint': 'The app restarts after you choose a different folder.',
  'settings.backup': 'Backup',
  'settings.backupHint':
    'One file holding the text of every song and set. It opens in any text editor.',
  'settings.download': 'Download a copy',
  'settings.restore': 'Restore from a copy…',
  'settings.restoreMerge': 'Add to what is here',
  'settings.restoreReplace': 'Replace everything',
  'settings.restoreConfirm':
    'This replaces the whole library with what is in the file. Songs not in the backup are deleted.',
  'settings.restored': '{songs} songs and {sets} sets restored.',
  'settings.restoreFailed': 'Could not restore: {error}',
  'settings.cleanup': 'Tidy up the chords',
  'settings.cleanupHint':
    'Finds chords written unusually (Cm# instead of C#m) and shows you every proposal before changing anything.',
  'settings.openCleanup': 'See the proposals',
  'settings.desktop': 'Desktop app',
  'settings.preventSleep': 'Keep the screen awake',
  'settings.preventSleepHint': 'Stops the computer sleeping during a service.',
  'settings.autoStart': 'Start with the computer',
  'settings.version': 'Version {version}',
  'settings.mirror': 'On this device: {songs} stored locally',
  'settings.lastSync': 'last synced {when}',
  'settings.neverSynced': 'never synced',
  'settings.resync': 'Sync now',
  'settings.shortcuts': 'Keyboard shortcuts',

  'cleanup.title': 'Tidy up the chords',
  'cleanup.intro':
    'Nothing changes until you tick something and press Apply. Chords you do not tick stay exactly as they are.',
  'cleanup.scanning': 'Scanning…',
  'cleanup.summary': '{chords} to tidy across {songs}, out of {scanned} checked.',
  'cleanup.songsAffected': { one: '{count} song', few: '{count} songs', other: '{count} songs' },
  'cleanup.nothing': 'Every chord is spelled the standard way. Nothing to do.',
  'cleanup.selectAll': 'Tick all',
  'cleanup.selectNone': 'Untick all',
  'cleanup.apply': 'Apply {count} fixes',
  'cleanup.applying': 'Applying…',
  'cleanup.applied': '{chords} chords changed across {songs}.',
  'cleanup.stale': '{count} were skipped — the song changed in the meantime.',
  'cleanup.becomes': 'becomes',
  'cleanup.reason': 'reason',
  'cleanup.occurrences': { one: 'once', few: '{count} times', other: '{count} times' },
  'cleanup.undoHint':
    'Every changed song keeps its previous version in the history, so this can be undone.',

  'keys.title': 'Keyboard shortcuts',
  'keys.hint': 'Press ? at any time to see this list.',
  'keys.nextSong': 'Next song',
  'keys.prevSong': 'Previous song',
  'keys.nextBlock': 'Next section',
  'keys.prevBlock': 'Previous section',
  'keys.sendLive': 'Send to the screens',
  'keys.black': 'Black the screens',
  'keys.clear': 'Clear the screens',
  'keys.autoManual': 'Auto / Manual',
  'keys.backToLeader': 'Back to the leader',
  'keys.chords': 'Show / hide chords',
  'keys.transposeUp': 'Up a semitone',
  'keys.transposeDown': 'Down a semitone',
  'keys.search': 'Search',
  'keys.help': 'This list',
  'keys.undo': 'Undo',
  'keys.redo': 'Redo',
  'keys.print': 'Print',

  'block.Verse': 'Verse',
  'block.Chorus': 'Chorus',
  'block.PreChorus': 'Pre-chorus',
  'block.Bridge': 'Bridge',
  'block.Ending': 'Ending',
  'block.Tag': 'Tag',
  'block.Intro': 'Intro',
  'block.Instrumental': 'Instrumental',
  'block.Solo': 'Solo',
  'block.Note': 'Note',

  'singers.Leader': 'Leader',
  'singers.All': 'All',
  'singers.Women': 'Women',
  'singers.Men': 'Men',
  'singers.Choir': 'Choir',
  'singers.Children': 'Children',
  'singers.Adults': 'Adults',
  'singers.Congregation': 'Congregation',
};

const DICTIONARIES: Record<Lang, Record<TranslationKey, Entry>> = { ro, en };

export type Values = Record<string, string | number>;

/** `{count}` and friends. Missing values are left visible rather than blanked. */
function interpolate(template: string, values: Values | undefined): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  );
}

export function translate(lang: Lang, key: TranslationKey, values?: Values): string {
  const entry = DICTIONARIES[lang][key];
  if (typeof entry === 'string') return interpolate(entry, values);

  const count = Number(values?.['count'] ?? 0);
  const form = new Intl.PluralRules(lang).select(count) as keyof Plural | 'two' | 'many' | 'zero';
  const chosen = form === 'one' ? entry.one : form === 'few' ? entry.few : entry.other;
  return interpolate(chosen, values);
}

export interface Translator {
  t: (key: TranslationKey, values?: Values) => string;
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** Block type names, which are stored in English and shown translated. */
  blockName: (type: BlockType) => string;
  /** Singer names, stored in English for the same reason. */
  singerName: (who: Singers) => string;
  /** Dates in the reader's own language, with no library and no network. */
  date: (iso: string | null, options?: Intl.DateTimeFormatOptions) => string;
}

const LANG_TAG: Record<Lang, string> = { ro: 'ro-RO', en: 'en-GB' };

const I18nContext = createContext<Translator | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePrefs();
  const lang = prefs.language;

  const setLang = useCallback((next: Lang) => setPrefs({ language: next }), [setPrefs]);

  const value = useMemo<Translator>(
    () => ({
      lang,
      setLang,
      t: (key, values) => translate(lang, key, values),
      blockName: (type) => translate(lang, `block.${type}` as TranslationKey),
      singerName: (who) => translate(lang, `singers.${who}` as TranslationKey),
      date: (iso, options) => {
        if (!iso) return translate(lang, 'sets.noDate');
        const parsed = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
        if (Number.isNaN(parsed.getTime())) return iso;
        return parsed.toLocaleDateString(
          LANG_TAG[lang],
          options ?? { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' },
        );
      },
    }),
    [lang, setLang],
  );

  // The document's own language matters for screen readers and for hyphenation.
  if (typeof document !== 'undefined') document.documentElement.lang = lang;

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): Translator {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useT must be used inside <I18nProvider>');
  return value;
}
