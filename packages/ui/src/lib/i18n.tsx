import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { BlockType, Singers } from '@worship/core';
import { usePrefs } from './settings.js';

/**
 * Two languages, one dictionary.
 *
 * English is the predictable default on every fresh installation. Romanian remains an
 * explicit choice, including when the Leader sends it to the Stage screens.
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
  'app.library': 'Arhiva',
  'app.sets': 'Programe',
  'app.lead': 'Condu',
  'app.band': 'Trupă',
  'app.stage': 'Ecran',
  'app.join': 'Conectare',
  'app.settings': 'Setări',
  'app.import': 'Importă',
  'app.back': 'Înapoi',
  'app.loading': 'Se încarcă…',
  'app.apply': 'Aplică',
  'app.copy': 'Copiază',
  'app.cancel': 'Anulează',
  'app.close': 'Închide',
  'app.save': 'Salvează',
  'app.delete': 'Șterge',
  'app.print': 'Print / PDF',
  'app.untitled': '(fără titlu)',
  'app.skipToContent': 'Sari la conținut',
  'nav.home': 'Acasă',
  'nav.homeHint': 'Pagina principală',
  'nav.where': 'Navigare',
  'nav.themeToLight': 'Comută pe luminos',
  'nav.themeToDark': 'Comută pe întunecat',

  'save.dirty': 'nesalvat',
  'save.saving': 'se salvează…',
  'save.saved': 'salvat',
  'save.error': 'eroare la salvare',

  'status.live': 'conectat',
  'status.connecting': 'se conectează',
  'status.offline': 'deconectat',
  'status.incompatible': 'necesită actualizare',
  'status.reconnecting': 'se reconectează…',

  // --- library --------------------------------------------------------------
  'library.search': 'Caută titlu sau versuri…',
  'library.new': 'Cântare nouă',
  'library.all': 'Toate',
  'library.count': {
    one: '{count} cântare',
    few: '{count} cântări',
    other: '{count} de cântări',
  },
  'library.found': 'găsite',
  'library.offlineBadge': 'offline · {count} salvate local',
  'library.empty': 'Arhiva este goală.',
  'library.emptyHint': 'Importă cântările existente, sau scrie prima.',
  'library.nothingFor': 'Nimic pentru „{query}”',
  'library.loadError': 'Nu pot încărca arhiva: {error}',
  'library.writtenPlayed': 'scrisă în {written}, cântată în {performance}',

  // --- song view ------------------------------------------------------------
  'song.notLocal': 'Cântarea nu e în arhiva salvată local.',
  'song.loadError': 'Nu pot încărca cântarea: {error}',
  'song.key': 'tonalitate {key}',
  'song.writtenPlayed': 'scrisă în {written} · cântată în {performance}',
  'song.transposed': 'transpusă {amount}',
  'song.capo': 'capo {fret}',
  'song.pitch': 'ton',
  'song.capoLabel': 'capo',
  'song.chords': 'Acorduri',
  'song.edit': 'Editează',
  'song.doesNotFit': 'Nu încape pe un ecran — derulează, sau ascunde acordurile.',
  'song.transposeDown': 'Coboară cu un semiton',
  'song.transposeUp': 'Urcă cu un semiton',
  'song.transposeReset': 'Înapoi la tonalitatea cântării',
  'song.capoDown': 'Capo mai jos',
  'song.capoReset': 'Fără capo',
  'song.capoUp': 'Capo mai sus',

  // --- editor ---------------------------------------------------------------
  'edit.title': 'Titlul cântării',
  'edit.undo': 'Anulează (Cmd+Z)',
  'edit.redo': 'Refă (Cmd+Shift+Z)',
  'edit.preview': 'Previzualizare',
  'edit.sectionType': 'Tipul secțiunii',
  'edit.label': 'etichetă (ex. Pavel)',
  'edit.whoSings': 'Voce',
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
  'edit.save': 'Salvează',
  'edit.saveShortcut': 'Salvează (Cmd+S)',
  'edit.unsavedTitle': 'Ai modificări nesalvate',
  'edit.unsavedBody': 'Dacă pleci acum, modificările se pierd.',
  'edit.discard': 'Renunță la modificări',
  'edit.stay': 'Rămâi aici',
  'edit.editChord': 'Editează acordul',
  'edit.addChord': 'Adaugă acord la cursor (F9)',

  // --- sets -----------------------------------------------------------------
  'sets.new': 'Program nou',
  'sets.noDate': 'fără dată',
  'sets.duplicate': 'Duplică',
  'sets.duplicateHint': 'Pornește de la acest program',
  'sets.empty': 'Niciun program încă. Creează unul pentru duminica viitoare.',
  'sets.notLocal': 'Programul nu e salvat local.',
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
  'sets.transpose': 'transpose',
  'sets.capo': 'capo',
  'sets.removeFromSet': 'Scoate din program',
  'sets.keyShifted': 'în arhivă {native}, în acest program {override} ({semitones} semitonuri)',

  // --- the set workspace ----------------------------------------------------
  'set.tabProgram': 'Program',
  'set.tabLibrary': 'Arhiva',
  'set.addToSet': 'Adaugă în program',
  'set.removeFromSet': 'Scoate din program',
  'set.filters': 'Filtre',
  'set.filterCollection': 'Colecție',
  'set.filterKey': 'Tonalitate',
  'set.filtersClear': 'Șterge filtrele',
  'set.noMatches': 'Nicio cântare nu trece de filtre.',
  'set.alreadyInSet': 'Deja în program',
  'set.pickSomething': 'Alege o cântare din stânga.',
  'set.searchToAdd': 'Caută o cântare ca să o vezi înainte de a o adăuga.',
  'set.dragHandle': 'Trage ca să muți',
  'set.resize': 'Trage ca să schimbi lățimea',
  'set.removeItem': 'Scoate din program',
  'set.expandHeader': 'Arată uneltele',
  'set.collapseHeader': 'Ascunde uneltele',
  'set.backToProgram': '← Program',
  'set.opening': 'Se deschide programul…',
  'set.creatingFirst': 'Se creează primul program…',
  'set.cannotOpen': 'Nu pot deschide un program: {error}',
  'set.cannotCreate':
    'Nu există niciun program și nu pot crea unul fără legătură la calculatorul gazdă.',
  'set.noteBody': 'Text',
  'set.gapLabel': 'Ce se întâmplă',
  'set.gapMinutes': 'Minute',
  'set.itemCount': {
    one: '{count} element',
    few: '{count} elemente',
    other: '{count} de elemente',
  },

  // --- lead -----------------------------------------------------------------
  'lead.start': 'Pornește modul de conducere',
  'lead.stop': 'Oprește modul de conducere (ecranele rămân unde sunt)',
  'lead.follow': 'Urmărire',
  'lead.stillLeading': 'Conduci în continuare — înapoi la program',
  'lead.auto': 'Auto',
  'lead.manual': 'Manual',
  'lead.clear': 'Gol',
  'lead.tap': 'Tap',
  'lead.stopTempo': 'Oprește metronomul',
  'lead.sendToScreens': 'Trimite pe ecrane (Space) — te uiți înainte, nimeni nu vede încă',
  'lead.connected': 'Conectați ({count})',
  'lead.qr': 'Cod QR pentru conectare',
  'lead.roleBand': 'Trupă',
  'lead.roleStage': 'Ecran',
  'lead.roleLeader': 'Lider',
  'lead.thisDevice': 'Acest dispozitiv',

  // --- band -----------------------------------------------------------------
  'band.noLiveSet': 'Niciun program live',
  'band.backToLeader': '↩ Înapoi la lider',
  'band.songList': 'Lista cântărilor',
  'band.following': 'Urmăresc',
  'band.onYourOwn': 'Independent',
  'band.hereNow': 'acum',
  'band.asLeader': 'Ca liderul',
  'band.leaderNotOnSong': 'Liderul nu e pe o cântare.',
  'band.waiting': 'Așteptăm liderul',
  'band.yourName': 'Numele tău (ex. Pavel — chitară)',
  'band.defaultName': 'Muzician',
  'performance.title': 'Configurația cântării',
  'performance.intendedKey': 'Ton final {key}',
  'performance.transpose': 'Transpose {amount}',
  'performance.capo': 'Capo {fret}',
  'performance.yourKey': 'Acordurile mele',
  'performance.yourChords': 'Acordurile tale: {key}',
  'performance.pianoTranspose': 'Pian {amount}',
  'performance.capoOption': 'sau capo {fret}',
  'performance.shortSetup': 'pian {transpose} · capo {capo}',

  // --- join -----------------------------------------------------------------
  'join.title': 'Conectează un dispozitiv',
  'join.subtitle':
    'Toate dispozitivele trebuie să fie pe aceeași rețea locală. Nu e nevoie de internet.',
  'join.stageWithChords': 'Cu acorduri',
  'join.stageWordsOnly': 'Doar versuri',
  'join.screenName': 'Numele ecranului',
  'join.screenNameHint':
    'Opțional. Un ecran cu nume apare așa în lista de dispozitive și poate fi reglat separat în setări.',
  'join.copy': 'Copiază adresa',
  'join.copied': 'Copiat',
  'join.qrTag': 'codul QR',
  'join.orType': 'Sau scrie adresa',
  'join.usuallyWorks': 'merge de obicei',
  'join.alwaysWorks': 'merge întotdeauna',
  'join.friendly': 'adresă simplă',
  'join.friendlyHint': 'adresă simplă; depinde de rețeaua locală',
  'join.qrReliable':
    'Codul QR folosește adresa numerică, cea mai sigură alegere pe orice rețea locală.',
  'join.diagnostics': 'Diagnostic de rețea',
  'join.testConnections': 'Testează adresele',
  'join.server': 'Server',
  'join.serverRunning': 'rulează pe portul {port}',
  'join.discovery': 'Descoperire',
  'join.discoveryReady': '{hostname} este publicat în rețeaua locală',
  'join.discoveryStarting': 'se pornește…',
  'join.discoveryUnavailable': 'adresa simplă nu a putut fi publicată; folosește codul QR',
  'join.networks': 'Conexiuni',
  'join.testHint':
    'Acest test verifică adresele de pe laptop. Verificarea finală este să scanezi codul QR cu un alt dispozitiv conectat la aceeași rețea.',
  'join.permissionTitle': 'Dacă alt dispozitiv nu se poate conecta',
  'join.permissionWindows':
    'Permite Worship Archive Leader în Windows Firewall pentru rețele private. Verifică și că rețeaua este marcată Private, nu Public.',
  'join.permissionMac':
    'Permite Worship Archive Leader la Confidențialitate și securitate → Rețea locală. Apoi redeschide aplicația dacă macOS o cere.',
  'join.permissionGeneric':
    'Permite aplicației accesul la rețeaua locală și verifică dacă toate dispozitivele sunt pe aceeași rețea Wi-Fi sau Ethernet.',
  'join.openNetworkSettings': 'Deschide setările de rețea',
  'join.testing': 'se testează',
  'join.reachable': 'funcționează',
  'join.unreachable': 'nu răspunde',
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
  'settings.chordsShown': 'Cu acorduri',
  'settings.chordsHidden': 'Doar versuri',
  'settings.accidentals': 'Scrierea diezurilor și bemolilor',
  'settings.accidentalsHint':
    'Alege cum se afișează fiecare sunet echivalent. Fișierele originale nu sunt modificate.',
  'settings.followLeaderNotation': 'Ca liderul',
  'settings.customNotation': 'Alegerea mea',
  'settings.library': 'Arhiva',
  'settings.close': 'Închide setările',
  'settings.quitApp': 'Închide aplicația',
  'settings.screensUseLeaderColours':
    'Culorile și tema ecranelor urmează întotdeauna dispozitivul liderului.',
  'settings.displayTarget': 'Pentru ce ecran',
  'settings.thisDevice': 'Acest dispozitiv',
  'settings.theScreens': 'Ecranele scenei',
  'settings.asThisDevice': 'Ca aici',
  'settings.stageHint':
    'Se aplică pe toate ecranele conectate, imediat. „Ca aici” le ține la fel ca ecranul de pe care conduci.',
  'settings.stageOffline': 'Fără gazdă — setările ecranelor nu pot fi citite acum.',
  'settings.whichScreen': 'Care ecran',
  'settings.allScreens': 'Toate ecranele',
  'settings.asAllScreens': 'Ca toate ecranele',
  'settings.screenHint':
    'Doar acest ecran. Ce lași pe „ca toate ecranele” urmează setările comune.',
  'settings.screenOff': 'stins',
  'settings.unnamedScreens':
    'Ecranele fără nume urmează setările comune. Dă-i un nume unui ecran în pagina de conectare ca să-l poți regla separat.',
  'settings.chordColor': 'Culoarea acordurilor',
  'settings.chordColorDefault': 'Implicită',
  'settings.chordColorCustom': 'Alege altă culoare',
  'settings.chordColorSampleChords': 'G           Am          F',
  'settings.chordColorSample': 'Mare ești Tu, Doamne al meu',
  'settings.dataDir': 'Dosarul arhivei',
  'settings.songsDir': 'Cântări',
  'settings.setsDir': 'Programe',
  'settings.chooseDataDir': 'Schimbă dosarul…',
  'settings.revealDataDir': 'Deschide dosarul',
  'settings.chooseDataDirHint':
    'Conține subdosarele Songs și Sets. Dacă alegi un dosar gol, poți copia arhiva actuală în el. Aplicația repornește după schimbare.',
  'settings.backup': 'Copie de siguranță',
  'settings.backupHint':
    'Un singur fișier cu textul tuturor cântărilor și programelor. Se poate deschide în orice editor de text.',
  'settings.download': 'Descarcă o copie',
  'settings.restore': 'Restaurează dintr-o copie…',
  'settings.restoreMerge': 'Adaugă la ce există',
  'settings.restoreReplace': 'Înlocuiește tot',
  'settings.restoreConfirm':
    'Se înlocuiește întreaga arhivă cu ce e în fișier. Cântările care nu sunt în copie se șterg.',
  'settings.restored': '{songs} cântări și {sets} programe restaurate.',
  'settings.restoreFailed': 'Nu am putut restaura: {error}',
  'settings.cleanup': 'Îndreptarea acordurilor',
  'settings.cleanupHint':
    'Caută acorduri scrise neobișnuit (Cm# în loc de C#m) și îți arată fiecare propunere înainte să schimbe ceva.',
  'settings.openCleanup': 'Vezi propunerile',
  'settings.connections': 'Conectarea dispozitivelor',
  'settings.connectionsHint':
    'Deschide pagina cu codul QR și adresele de conectare chiar dacă modul Condu nu este pornit.',
  'settings.openJoin': 'Deschide pagina de conectare',
  'settings.desktop': 'Aplicație desktop',
  'settings.preventSleep': 'Ține ecranul aprins',
  'settings.preventSleepHint': 'Împiedică adormirea calculatorului în timpul serviciului.',
  'settings.autoStart': 'Pornește odată cu calculatorul',
  'settings.fullscreen': 'Deschide pe tot ecranul',
  'setup.title': 'Configurează acest dispozitiv',
  'setup.hint':
    'Este necesar o singură dată. Poți schimba aceste opțiuni mai târziu din Setări.',
  'setup.continue': 'Continuă',
  'setup.nameRequired': 'Introdu un nume pentru acest dispozitiv.',
  'setup.failed': 'Setările nu au putut fi salvate. Încearcă din nou.',
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
  'keys.sendLive': 'Trimite pe ecrane',
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
  'app.library': 'Archive',
  'app.sets': 'Sets',
  'app.lead': 'Lead',
  'app.band': 'Band',
  'app.stage': 'Stage',
  'app.join': 'Join',
  'app.settings': 'Settings',
  'app.import': 'Import',
  'app.back': 'Back',
  'app.loading': 'Loading…',
  'app.apply': 'Apply',
  'app.copy': 'Copy',
  'app.cancel': 'Cancel',
  'app.close': 'Close',
  'app.save': 'Save',
  'app.delete': 'Delete',
  'app.print': 'Print / PDF',
  'app.untitled': '(untitled)',
  'app.skipToContent': 'Skip to content',
  'nav.home': 'Home',
  'nav.homeHint': 'The main page',
  'nav.where': 'Navigation',
  'nav.themeToLight': 'Switch to light',
  'nav.themeToDark': 'Switch to dark',

  'save.dirty': 'unsaved',
  'save.saving': 'saving…',
  'save.saved': 'saved',
  'save.error': 'could not save',

  'status.live': 'connected',
  'status.connecting': 'connecting',
  'status.offline': 'disconnected',
  'status.incompatible': 'update required',
  'status.reconnecting': 'reconnecting…',

  'library.search': 'Search titles or lyrics…',
  'library.new': 'New song',
  'library.all': 'All',
  'library.count': { one: '{count} song', few: '{count} songs', other: '{count} songs' },
  'library.found': 'found',
  'library.offlineBadge': 'offline · {count} stored on this device',
  'library.empty': 'The archive is empty.',
  'library.emptyHint': 'Import the songs you already have, or write the first one.',
  'library.nothingFor': 'Nothing for “{query}”',
  'library.loadError': 'Could not load the archive: {error}',
  'library.writtenPlayed': 'written in {written}, played in {performance}',

  'song.notLocal': 'This song is not in the copy stored on this device.',
  'song.loadError': 'Could not load the song: {error}',
  'song.key': 'key of {key}',
  'song.writtenPlayed': 'written in {written} · played in {performance}',
  'song.transposed': 'transposed {amount}',
  'song.capo': 'capo {fret}',
  'song.pitch': 'key',
  'song.capoLabel': 'capo',
  'song.chords': 'Chords',
  'song.edit': 'Edit',
  'song.doesNotFit': 'Will not fit one screen — scroll, or hide the chords.',
  'song.transposeDown': 'Down a semitone',
  'song.transposeUp': 'Up a semitone',
  'song.transposeReset': "Back to the song's own key",
  'song.capoDown': 'Capo down',
  'song.capoReset': 'No capo',
  'song.capoUp': 'Capo up',

  'edit.title': 'Song title',
  'edit.undo': 'Undo (Cmd+Z)',
  'edit.redo': 'Redo (Cmd+Shift+Z)',
  'edit.preview': 'Preview',
  'edit.sectionType': 'Section type',
  'edit.label': 'label (e.g. Paul)',
  'edit.whoSings': 'Singer',
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
  'edit.save': 'Save',
  'edit.saveShortcut': 'Save (Cmd+S)',
  'edit.unsavedTitle': 'You have unsaved changes',
  'edit.unsavedBody': 'Leaving now loses them.',
  'edit.discard': 'Discard changes',
  'edit.stay': 'Stay here',
  'edit.editChord': 'Edit this chord',
  'edit.addChord': 'Add a chord at the cursor (F9)',

  'sets.new': 'New set',
  'sets.noDate': 'no date',
  'sets.duplicate': 'Duplicate',
  'sets.duplicateHint': 'Start from this set',
  'sets.empty': 'No sets yet. Make one for next Sunday.',
  'sets.notLocal': 'This set is not stored on this device.',
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
  'sets.transpose': 'transpose',
  'sets.capo': 'capo',
  'sets.removeFromSet': 'Remove from the set',
  'sets.keyShifted': '{native} in the archive, {override} in this set ({semitones} semitones)',

  'set.tabProgram': 'Set',
  'set.tabLibrary': 'Archive',
  'set.addToSet': 'Add to the set',
  'set.removeFromSet': 'Remove from the set',
  'set.filters': 'Filters',
  'set.filterCollection': 'Collection',
  'set.filterKey': 'Key',
  'set.filtersClear': 'Clear filters',
  'set.noMatches': 'No song gets past the filters.',
  'set.alreadyInSet': 'Already in the set',
  'set.pickSomething': 'Choose a song on the left.',
  'set.searchToAdd': 'Search for a song to see it before adding it.',
  'set.dragHandle': 'Drag to move',
  'set.resize': 'Drag to resize',
  'set.removeItem': 'Remove from the set',
  'set.expandHeader': 'Show the tools',
  'set.collapseHeader': 'Hide the tools',
  'set.backToProgram': '← Set',
  'set.opening': 'Opening the set…',
  'set.creatingFirst': 'Creating the first set…',
  'set.cannotOpen': 'Could not open a set: {error}',
  'set.cannotCreate': 'There is no set, and one cannot be created without reaching the host.',
  'set.noteBody': 'Text',
  'set.gapLabel': 'What happens',
  'set.gapMinutes': 'Minutes',
  'set.itemCount': { one: '{count} item', few: '{count} items', other: '{count} items' },

  'lead.start': 'Start leading',
  'lead.stop': 'Stop leading (the screens stay where they are)',
  'lead.follow': 'Follow',
  'lead.stillLeading': 'Still leading — back to the set',
  'lead.auto': 'Auto',
  'lead.manual': 'Manual',
  'lead.clear': 'Clear',
  'lead.tap': 'Tap',
  'lead.stopTempo': 'Stop the metronome',
  'lead.sendToScreens':
    'Send to the screens (Space) — you are looking ahead, nobody sees it yet',
  'lead.connected': 'Connected ({count})',
  'lead.qr': 'QR code to join',
  'lead.roleBand': 'Band',
  'lead.roleStage': 'Screen',
  'lead.roleLeader': 'Leader',
  'lead.thisDevice': 'This device',

  'band.noLiveSet': 'No set is live',
  'band.backToLeader': '↩ Back to the leader',
  'band.songList': 'Song list',
  'band.following': 'Following',
  'band.onYourOwn': 'Independent',
  'band.hereNow': 'now',
  'band.asLeader': 'As the leader has it',
  'band.leaderNotOnSong': 'The leader is not on a song.',
  'band.waiting': 'Waiting for the leader',
  'band.yourName': 'Your name (e.g. Paul — guitar)',
  'band.defaultName': 'Musician',
  'performance.title': 'Song setup',
  'performance.intendedKey': 'Intended key {key}',
  'performance.transpose': 'Transpose {amount}',
  'performance.capo': 'Capo {fret}',
  'performance.yourKey': 'My chords',
  'performance.yourChords': 'Your chords: {key}',
  'performance.pianoTranspose': 'Piano {amount}',
  'performance.capoOption': 'or capo {fret}',
  'performance.shortSetup': 'piano {transpose} · capo {capo}',

  'join.title': 'Connect a device',
  'join.subtitle': 'Every device has to be on the same local network. No internet needed.',
  'join.stageWithChords': 'With chords',
  'join.stageWordsOnly': 'Words only',
  'join.screenName': 'Screen name',
  'join.screenNameHint':
    'Optional. A named screen shows up by that name in the device list, and can be set up on its own in Settings.',
  'join.copy': 'Copy the address',
  'join.copied': 'Copied',
  'join.qrTag': 'the QR code',
  'join.orType': 'Or type the address',
  'join.usuallyWorks': 'usually works',
  'join.alwaysWorks': 'always works',
  'join.friendly': 'simple address',
  'join.friendlyHint': 'simple address; depends on the local network',
  'join.qrReliable':
    'The QR code uses the numeric address, which is the most reliable choice on any local network.',
  'join.diagnostics': 'Network diagnostics',
  'join.testConnections': 'Test addresses',
  'join.server': 'Server',
  'join.serverRunning': 'running on port {port}',
  'join.discovery': 'Discovery',
  'join.discoveryReady': '{hostname} is published on the local network',
  'join.discoveryStarting': 'starting…',
  'join.discoveryUnavailable': 'the simple address could not be published; use the QR code',
  'join.networks': 'Connections',
  'join.testHint':
    'This test checks the addresses from the laptop. The final test is scanning the QR code with another device on the same network.',
  'join.permissionTitle': 'If another device cannot connect',
  'join.permissionWindows':
    'Allow Worship Archive Leader through Windows Firewall on private networks. Also check that this network is marked Private rather than Public.',
  'join.permissionMac':
    'Allow Worship Archive Leader under Privacy & Security → Local Network. Reopen the application afterwards if macOS asks you to.',
  'join.permissionGeneric':
    'Allow the application to access the local network and check that every device is on the same Wi-Fi or Ethernet network.',
  'join.openNetworkSettings': 'Open network settings',
  'join.testing': 'testing',
  'join.reachable': 'works',
  'join.unreachable': 'not responding',
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
  'import.blocks': {
    one: '{count} section',
    few: '{count} sections',
    other: '{count} sections',
  },
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
  'settings.chordsShown': 'With chords',
  'settings.chordsHidden': 'Words only',
  'settings.accidentals': 'Sharp and flat notation',
  'settings.accidentalsHint':
    'Choose how each equivalent pitch is displayed. The original song files are not changed.',
  'settings.followLeaderNotation': 'As the Leader',
  'settings.customNotation': 'My choice',
  'settings.library': 'Archive',
  'settings.close': 'Close settings',
  'settings.quitApp': 'Quit app',
  'settings.screensUseLeaderColours':
    'Screen colours and theme always follow the Leader device.',
  'settings.displayTarget': 'Which screen',
  'settings.thisDevice': 'This device',
  'settings.theScreens': 'Stage screens',
  'settings.asThisDevice': 'As here',
  'settings.stageHint':
    'Applies to every connected screen, at once. \u201cAs here\u201d keeps them looking like the screen you lead from.',
  'settings.stageOffline': 'No host — the screens\u2019 settings cannot be read right now.',
  'settings.whichScreen': 'Which screen',
  'settings.allScreens': 'All screens',
  'settings.asAllScreens': 'As all screens',
  'settings.screenHint':
    'This screen only. Anything left as \u201cas all screens\u201d follows the shared settings.',
  'settings.screenOff': 'off',
  'settings.unnamedScreens':
    'Screens without a name follow the shared settings. Give a screen a name on the join page to set it up on its own.',
  'settings.chordColor': 'Chord colour',
  'settings.chordColorDefault': 'Default',
  'settings.chordColorCustom': 'Pick another colour',
  'settings.chordColorSampleChords': 'G           Am          F',
  'settings.chordColorSample': 'How great You are, my Lord',
  'settings.dataDir': 'Library folder',
  'settings.songsDir': 'Songs',
  'settings.setsDir': 'Sets',
  'settings.chooseDataDir': 'Change folder…',
  'settings.revealDataDir': 'Open the folder',
  'settings.chooseDataDirHint':
    'Contains the Songs and Sets subfolders. When you choose an empty folder, you can copy the current library into it. The app restarts after changing it.',
  'settings.backup': 'Backup',
  'settings.backupHint':
    'One file holding the text of every song and set. It opens in any text editor.',
  'settings.download': 'Download a copy',
  'settings.restore': 'Restore from a copy…',
  'settings.restoreMerge': 'Add to what is here',
  'settings.restoreReplace': 'Replace everything',
  'settings.restoreConfirm':
    'This replaces the whole archive with what is in the file. Songs not in the backup are deleted.',
  'settings.restored': '{songs} songs and {sets} sets restored.',
  'settings.restoreFailed': 'Could not restore: {error}',
  'settings.cleanup': 'Tidy up the chords',
  'settings.cleanupHint':
    'Finds chords written unusually (Cm# instead of C#m) and shows you every proposal before changing anything.',
  'settings.openCleanup': 'See the proposals',
  'settings.connections': 'Connect devices',
  'settings.connectionsHint':
    'Open the QR code and connection addresses even when Lead mode has not been started.',
  'settings.openJoin': 'Open the connection page',
  'settings.desktop': 'Desktop app',
  'settings.preventSleep': 'Keep the screen awake',
  'settings.preventSleepHint': 'Stops the computer sleeping during a service.',
  'settings.autoStart': 'Start with the computer',
  'settings.fullscreen': 'Open in fullscreen',
  'setup.title': 'Set up this device',
  'setup.hint': 'This is needed only once. You can change these options later in Settings.',
  'setup.continue': 'Continue',
  'setup.nameRequired': 'Enter a name for this device.',
  'setup.failed': 'The settings could not be saved. Please try again.',
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
  'cleanup.songsAffected': {
    one: '{count} song',
    few: '{count} songs',
    other: '{count} songs',
  },
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
  'keys.sendLive': 'Send to the screens',
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
  const form = new Intl.PluralRules(lang).select(count) as
    keyof Plural | 'two' | 'many' | 'zero';
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

/*
  A language imposed from outside, for one screen.

  The stage displays are configured centrally — see `StageDisplay` — and a television on
  a bracket has no one standing at it to change its own preference. So it can be told
  which language to speak without that being written into the device's own settings,
  which would then be wrong the next time somebody used that laptop for something else.
*/
let override: Lang | null = null;
const overrideListeners = new Set<() => void>();

export function setLanguageOverride(next: Lang | null): void {
  if (override === next) return;
  override = next;
  for (const listener of overrideListeners) listener();
}

function useLanguageOverride(): Lang | null {
  return useSyncExternalStore(
    (listener) => {
      overrideListeners.add(listener);
      return () => overrideListeners.delete(listener);
    },
    () => override,
    () => null,
  );
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = usePrefs();
  const lang = useLanguageOverride() ?? prefs.language;

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
