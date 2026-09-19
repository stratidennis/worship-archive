import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  BLOCK_TYPES,
  SINGERS,
  insertBlock,
  insertLine,
  mergeBlockUp,
  pasteIntoLine,
  moveBlock,
  removeBlock,
  removeLine,
  replaceLine,
  setChord,
  setLineText,
  splitBlock,
  updateBlock,
  updateLine,
  type BlockType,
  type Singers,
  type Song,
} from '@worship/core';
import { adminApi } from '../lib/api.js';
import { repo } from '../lib/repo.js';
import { useUndoable } from '../lib/useUndoable.js';
import { useT, type Translator } from '../lib/i18n.js';
import { confirmAction } from '../lib/confirm.js';
import { usePrefs } from '../lib/settings.js';
import { LineEditor } from '../components/LineEditor.js';
import { SongBody } from '../components/SongBody.js';
import { HeaderActions, HeaderTitle, useHeader } from '../components/header-slots.js';
import { Modal } from '../components/Modal.js';
import { SaveBadge, type SaveState } from '../components/SaveBadge.js';
import { Button, Checkbox, Field as UiField, Input, Select } from '../components/ui.js';
import {
  IconClose,
  IconDown,
  IconMergeUp,
  IconRedo,
  IconSave,
  IconTrash,
  IconUndo,
  IconUp,
} from '../components/icons.js';

/** Keyboard shortcuts carried over from the old SongEditor, so muscle memory survives. */
const TYPE_KEYS: Record<string, BlockType> = {
  F6: 'Verse',
  F7: 'Chorus',
  F8: 'Bridge',
};

/** The same four the reading view tints — a cue is not a verse, in either place. */
const CUE_TYPES = new Set<BlockType>(['Intro', 'Instrumental', 'Solo', 'Note']);

/**
 * What is compared to decide whether there is anything to save.
 *
 * Deliberately not the whole document. `rev`, `createdAt` and `updatedAt` belong to the
 * server and change on every write, so comparing them meant the editor was still
 * "unsaved" the instant after a successful save — the Save button never went quiet, and
 * leaving would have asked about changes that had already been written.
 */
function contentOf(song: Song): string {
  const { rev: _rev, createdAt: _createdAt, updatedAt: _updatedAt, ...content } = song;
  return JSON.stringify(content);
}

export function EditPage() {
  const { t, blockName, singerName } = useT();
  const [prefs] = usePrefs();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = (location.state as { returnTo?: string } | null)?.returnTo ?? '/archive';
  const song = useUndoable<Song | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [preview, setPreview] = useState(false);

  useHeader({ back: true });
  const [error, setError] = useState<string | null>(null);
  const savedRef = useRef<string>('');

  const { reset } = song;
  useEffect(() => {
    repo
      .song(id)
      .then((loaded) => {
        if (!loaded) {
          setError(t('song.notLocal'));
          return;
        }
        savedRef.current = contentOf(loaded);
        reset(loaded);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [id, reset, t]);

  const current = song.value;

  /*
    Saving is explicit.

    It used to autosave 800ms after you stopped typing, which is fine for notes and
    wrong for a song: a half-finished edit to Sunday's chords would reach every other
    device before the musician had decided it was right. Nothing leaves this page until
    Save — and nothing leaves this page *silently*, either: navigating away with unsaved
    work is blocked below.
  */
  const dirty = current !== null && contentOf(current) !== savedRef.current;

  useEffect(() => {
    setSaveState((previous) => {
      if (previous === 'saving' || previous === 'error') return previous;
      return dirty ? 'dirty' : previous === 'saved' ? 'saved' : 'idle';
    });
  }, [dirty]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!current) return true;
    setSaveState('saving');
    try {
      await repo.saveSong(id, current);
      // What was sent is now what is stored; the server's own `rev` and `updatedAt`
      // are deliberately not part of the comparison — see `contentOf`.
      savedRef.current = contentOf(current);
      setSaveState('saved');
      return true;
    } catch (e: unknown) {
      setError(String(e));
      setSaveState('error');
      return false;
    }
  }, [current, id]);

  // Closing the tab or reloading is the browser's to warn about, not ours.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent): void => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // Navigating inside the app is ours. The blocker holds the navigation open while the
  // question is asked, then either lets it through or cancels it.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && currentLocation.pathname !== nextLocation.pathname,
  );

  const edit = useCallback(
    (fn: (s: Song) => Song, mergeKey?: string) => {
      song.set((s) => (s ? fn(s) : s), mergeKey);
    },
    [song],
  );

  // Undo/redo and save at the document level. The browser's own undo still works inside
  // a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) song.redo();
        else song.undo();
      } else if (key === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [song, save]);

  if (error && !current) {
    return <p className="p-6 text-sm text-(--color-muted)">{t('song.loadError', { error })}</p>;
  }
  if (!current)
    return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  return (
    <>
      <HeaderTitle>
        <input
          value={current.title}
          onChange={(e) => edit((s) => ({ ...s, title: e.target.value }), 'title')}
          placeholder={t('edit.title')}
          aria-label={t('edit.title')}
          /* Not the boxed `Input`: this is the document's title, and a form field in
               the header would read as one control among many rather than as the name
               of the thing. It still takes the same height and focus colour, so it
               lines up with everything beside it. */
          className="h-9 w-full min-w-40 rounded-lg border border-transparent bg-transparent px-2 text-base font-bold outline-none transition-colors placeholder:font-normal placeholder:text-(--color-muted) hover:border-(--color-line) focus:border-(--color-chord) sm:w-64"
        />
      </HeaderTitle>

      <HeaderActions>
        <div className="flex items-center gap-1.5 text-sm">
          <SaveBadge state={saveState} />
          <Btn onClick={song.undo} disabled={!song.canUndo} title={t('edit.undo')}>
            <IconUndo size={16} />
          </Btn>
          <Btn onClick={song.redo} disabled={!song.canRedo} title={t('edit.redo')}>
            <IconRedo size={16} />
          </Btn>
          <Btn onClick={() => setPreview(!preview)} active={preview}>
            {t('edit.preview')}
          </Btn>
          <Button
            variant="primary"
            onClick={() => void save()}
            disabled={!dirty || saveState === 'saving'}
            title={t('edit.saveShortcut')}
          >
            <IconSave size={16} />
            {t('edit.save')}
          </Button>
        </div>
      </HeaderActions>

      <div className="flex min-h-0 flex-1">
        <div id="main" className="scroll-slim min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
          {/*
            No narrow measure and no centring.
            
            This is the same song a musician reads on the same screen; editing it in a
            768px column in the middle of a 1600px window made it a different document,
            and every line wrapped in a different place from where it will actually
            wrap. The text size matches the reading view for the same reason.
          */}
          <div className="mx-auto w-full max-w-[min(100%,90rem)] text-[20px] leading-snug">
            <div className="text-base">
              <Metadata song={current} edit={edit} t={t} />
            </div>

            {current.blocks.map((block, blockIndex) => (
              <section
                key={block.id}
                className={`group/block mb-4 rounded-lg border border-transparent px-3 py-2 transition-colors hover:border-(--color-line) ${
                  CUE_TYPES.has(block.type)
                    ? 'border-l-2 border-l-(--color-cue) bg-(--color-cue-bg)'
                    : ''
                }`}
                onKeyDown={(event) => {
                  const type = TYPE_KEYS[event.key];
                  if (type) {
                    event.preventDefault();
                    edit((s) => updateBlock(s, block.id, { type }));
                  }
                }}
              >
                {/*
                  The controls fade back until the section is touched. A song being read
                  is words and chords; a song being edited was words, chords and nine
                  form fields per section competing with them.
                */}
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs opacity-45 transition-opacity focus-within:opacity-100 group-hover/block:opacity-100">
                  <Select
                    tight
                    value={block.type}
                    onChange={(e) =>
                      edit((s) =>
                        updateBlock(s, block.id, { type: e.target.value as BlockType }),
                      )
                    }
                    className="w-32 font-semibold uppercase tracking-wider"
                    aria-label={t('edit.sectionType')}
                  >
                    {BLOCK_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {blockName(type)}
                      </option>
                    ))}
                  </Select>
                  <span className="font-mono text-(--color-muted)">{block.id}</span>

                  <Input
                    tight
                    value={block.label ?? ''}
                    onChange={(e) =>
                      edit(
                        (s) => updateBlock(s, block.id, { label: e.target.value || null }),
                        `label-${block.id}`,
                      )
                    }
                    placeholder={t('edit.label')}
                    aria-label={t('edit.label')}
                    className="w-32"
                  />

                  <Select
                    tight
                    value={block.singers ?? ''}
                    onChange={(e) =>
                      edit((s) =>
                        updateBlock(s, block.id, {
                          singers: (e.target.value || null) as Singers | null,
                        }),
                      )
                    }
                    className="w-28"
                    aria-label={t('edit.whoSingsLabel')}
                  >
                    <option value="">{t('edit.whoSings')}</option>
                    {SINGERS.map((who) => (
                      <option key={who} value={who}>
                        {singerName(who)}
                      </option>
                    ))}
                  </Select>

                  <label className="flex items-center gap-1 text-(--color-muted)">
                    ×
                    <Input
                      tight
                      type="number"
                      min={1}
                      value={block.repeat ?? ''}
                      onChange={(e) =>
                        edit((s) =>
                          updateBlock(s, block.id, {
                            repeat: e.target.value ? Number(e.target.value) : null,
                          }),
                        )
                      }
                      className="w-14"
                      aria-label={t('edit.repeats')}
                    />
                  </label>

                  <label
                    className="flex items-center gap-1 text-(--color-muted)"
                    title={t('edit.linkedHint')}
                  >
                    <Checkbox
                      checked={block.linkToPrevious}
                      onChange={(e) =>
                        edit((s) =>
                          updateBlock(s, block.id, { linkToPrevious: e.target.checked }),
                        )
                      }
                    />
                    {t('edit.linked')}
                  </label>

                  <span className="ml-auto flex gap-0.5">
                    {/* The ends of the list have nowhere to go, and the first section
                        has nothing above it to merge into. These used to be pressable
                        and silently do nothing, which reads as the button being broken
                        rather than as the move being impossible. */}
                    <Btn
                      small
                      disabled={blockIndex === 0}
                      onClick={() => edit((s) => moveBlock(s, block.id, -1))}
                      title={t('edit.moveUp')}
                    >
                      <IconUp size={13} />
                    </Btn>
                    <Btn
                      small
                      disabled={blockIndex === current.blocks.length - 1}
                      onClick={() => edit((s) => moveBlock(s, block.id, 1))}
                      title={t('edit.moveDown')}
                    >
                      <IconDown size={13} />
                    </Btn>
                    <Btn
                      small
                      disabled={blockIndex === 0}
                      onClick={() => edit((s) => mergeBlockUp(s, block.id))}
                      title={t('edit.mergeUp')}
                    >
                      <IconMergeUp size={13} />
                    </Btn>
                    <Btn
                      small
                      onClick={() => edit((s) => removeBlock(s, block.id))}
                      title={t('edit.removeSection')}
                    >
                      <IconClose size={13} />
                    </Btn>
                  </span>
                </div>

                {block.lines.map((line, lineIndex) => (
                  <LineEditor
                    key={lineIndex}
                    line={line}
                    layer="chords"
                    showChords
                    onTextChange={(text) =>
                      edit(
                        (s) => updateLine(s, block.id, lineIndex, (l) => setLineText(l, text)),
                        `text-${block.id}-${lineIndex}`,
                      )
                    }
                    onChordChange={(at, raw) =>
                      edit((s) =>
                        updateLine(s, block.id, lineIndex, (l) => setChord(l, at, raw)),
                      )
                    }
                    onPasteLines={(at, text) =>
                      edit((s) => {
                        const target = s.blocks.find((b) => b.id === block.id)?.lines[
                          lineIndex
                        ];
                        if (!target) return s;
                        return replaceLine(
                          s,
                          block.id,
                          lineIndex,
                          pasteIntoLine(target, at, text),
                        );
                      })
                    }
                    onEnter={() => edit((s) => insertLine(s, block.id, lineIndex))}
                    onBackspaceEmpty={() =>
                      edit((s) =>
                        block.lines.length > 1
                          ? removeLine(s, block.id, lineIndex)
                          : removeBlock(s, block.id),
                      )
                    }
                  />
                ))}

                <div className="mt-1 flex gap-1 text-xs">
                  <Btn
                    small
                    onClick={() => edit((s) => insertLine(s, block.id, block.lines.length - 1))}
                  >
                    {t('edit.addLine')}
                  </Btn>
                  {block.lines.length > 1 && (
                    <Btn small onClick={() => edit((s) => splitBlock(s, block.id, 1))}>
                      {t('edit.split')}
                    </Btn>
                  )}
                  <Btn small onClick={() => edit((s) => insertBlock(s, 'Verse', blockIndex))}>
                    {t('edit.addSectionBelow')}
                  </Btn>
                </div>
              </section>
            ))}

            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  'Verse',
                  'Chorus',
                  'PreChorus',
                  'Bridge',
                  'Intro',
                  'Instrumental',
                  'Solo',
                  'Ending',
                  'Note',
                ] as BlockType[]
              ).map((type) => (
                <Btn key={type} onClick={() => edit((s) => insertBlock(s, type))}>
                  + {blockName(type)}
                </Btn>
              ))}
            </div>

            <div className="mt-8 border-t border-(--color-line) pt-4">
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  void confirmAction({
                    message: t('edit.deleteConfirm', { title: current.title }),
                    confirmLabel: t('app.delete'),
                    danger: true,
                  }).then((ok) => {
                    if (ok)
                      void adminApi
                        .deleteSong(id)
                        .then(() => navigate(returnTo, { replace: true }));
                  });
                }}
              >
                <IconTrash size={14} />
                {t('edit.deleteSong')}
              </Button>
            </div>
          </div>
        </div>

        {blocker.state === 'blocked' && (
          <Modal
            title={t('edit.unsavedTitle')}
            detail={t('edit.unsavedBody')}
            onDismiss={() => blocker.reset?.()}
          >
            {/* Staying is first, so it holds the focus: Escape and Enter both keep the
                work rather than losing it. */}
            <Button onClick={() => blocker.reset?.()}>{t('edit.stay')}</Button>
            <Button variant="danger" onClick={() => blocker.proceed?.()}>
              {t('edit.discard')}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void save().then((ok) => (ok ? blocker.proceed?.() : blocker.reset?.()));
              }}
            >
              {t('edit.save')}
            </Button>
          </Modal>
        )}

        {preview && (
          <aside className="scroll-slim hidden min-h-0 w-[42%] shrink-0 overflow-y-auto border-l border-(--color-line) px-4 py-4 lg:block">
            <p className="mb-2 text-xs uppercase tracking-wider text-(--color-muted)">
              {t('edit.preview')}
            </p>
            <div style={{ fontSize: '16px' }}>
              <SongBody
                song={current}
                options={{
                  showChords: true,
                  showBass: false,
                  capo: 0,
                  transpose: 0,
                  accidentalPreferences: prefs.accidentalPreferences,
                }}
              />
            </div>
          </aside>
        )}
      </div>
    </>
  );
}

/**
 * The song's own facts.
 *
 * Copyright and CCLI are not here. They are still parsed, stored and written back out,
 * so a song that arrived with them keeps them — but this band does not licence-report,
 * and two fields nobody fills in are two more things to read past every time.
 */
function Metadata({
  song,
  edit,
  t,
}: {
  song: Song;
  edit: (fn: (s: Song) => Song, k?: string) => void;
  t: Translator['t'];
}) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Field
        label={t('edit.writtenKey')}
        value={song.writtenKey ?? ''}
        onChange={(v) => edit((s) => ({ ...s, writtenKey: v || null }), 'writtenKey')}
        placeholder="G"
      />
      <Field
        label={t('edit.performanceKey')}
        value={song.performanceKey ?? ''}
        onChange={(v) => edit((s) => ({ ...s, performanceKey: v || null }), 'performanceKey')}
        placeholder="Bb"
      />
      <Field
        label={t('edit.tempo')}
        value={song.tempo?.toString() ?? ''}
        onChange={(v) => edit((s) => ({ ...s, tempo: v ? Number(v) : null }), 'tempo')}
        placeholder="72"
      />
      <Field
        label={t('edit.timeSignature')}
        value={song.timeSignature ?? ''}
        onChange={(v) => edit((s) => ({ ...s, timeSignature: v || null }), 'timeSignature')}
        placeholder="4/4"
      />
      <Field
        label={t('edit.author')}
        value={song.authors.join(', ')}
        onChange={(v) =>
          edit(
            (s) => ({
              ...s,
              authors: v
                ? v
                    .split(',')
                    .map((a) => a.trim())
                    .filter(Boolean)
                : [],
            }),
            'authors',
          )
        }
        placeholder="—"
      />
      <Field
        label={t('edit.tags')}
        value={song.tags.join(', ')}
        onChange={(v) =>
          edit(
            (s) => ({
              ...s,
              tags: v
                ? v
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                : [],
            }),
            'tags',
          )
        }
        placeholder={t('block.Chorus').toLowerCase()}
      />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <UiField label={label}>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </UiField>
  );
}

/** The editor's buttons, which are the shared control with a shorter name. */
function Btn({
  onClick,
  children,
  active,
  small,
  disabled,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  small?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <Button
      size={small ? 'sm' : 'md'}
      onClick={onClick}
      disabled={disabled}
      {...(title ? { title, 'aria-label': title } : {})}
      {...(active === undefined ? {} : { active })}
    >
      {children}
    </Button>
  );
}
