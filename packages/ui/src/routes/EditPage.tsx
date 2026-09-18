import { useCallback, useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
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
import { confirmAction } from '../lib/desktop.js';
import { LineEditor } from '../components/LineEditor.js';
import { SongBody } from '../components/SongBody.js';
import { AppHeader } from '../components/AppHeader.js';
import {
  IconClose,
  IconDown,
  IconMergeUp,
  IconRedo,
  IconSave,
  IconUndo,
  IconUp,
} from '../components/icons.js';

/** Keyboard shortcuts carried over from the old SongEditor, so muscle memory survives. */
const TYPE_KEYS: Record<string, BlockType> = {
  F6: 'Verse',
  F7: 'Chorus',
  F8: 'Bridge',
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

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
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const song = useUndoable<Song | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [preview, setPreview] = useState(false);
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
    return (
      <>
        <AppHeader back />
        <p className="p-6 text-sm text-(--color-muted)">{t('song.loadError', { error })}</p>
      </>
    );
  }
  if (!current)
    return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  return (
    <div className="flex h-dvh flex-col">
      <AppHeader
        back
        title={
          <input
            value={current.title}
            onChange={(e) => edit((s) => ({ ...s, title: e.target.value }), 'title')}
            placeholder={t('edit.title')}
            aria-label={t('edit.title')}
            className="w-full min-w-40 bg-transparent text-base font-bold outline-none focus:bg-(--color-chord)/5 sm:w-64"
          />
        }
      >
        <SaveBadge state={saveState} />
        <div className="flex items-center gap-1 text-sm">
          <Btn onClick={song.undo} disabled={!song.canUndo} title={t('edit.undo')}>
            <IconUndo size={16} />
          </Btn>
          <Btn onClick={song.redo} disabled={!song.canRedo} title={t('edit.redo')}>
            <IconRedo size={16} />
          </Btn>
          <Btn onClick={() => setPreview(!preview)} active={preview}>
            {t('edit.preview')}
          </Btn>
          <button
            type="button"
            onClick={() => void save()}
            disabled={!dirty || saveState === 'saving'}
            title={t('edit.saveShortcut')}
            className="flex h-9 items-center gap-1.5 rounded-md border border-(--color-chord) bg-(--color-chord) px-3 text-sm font-semibold text-white disabled:border-(--color-line) disabled:bg-transparent disabled:text-(--color-muted)"
          >
            <IconSave size={16} />
            {t('edit.save')}
          </button>
        </div>
      </AppHeader>

      <div className="flex min-h-0 flex-1">
        <div id="main" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div className="mx-auto max-w-3xl">
            <Metadata song={current} edit={edit} t={t} />

            {current.blocks.map((block, blockIndex) => (
              <section
                key={block.id}
                className="mb-4 rounded-lg border border-(--color-line) p-3"
                onKeyDown={(event) => {
                  const type = TYPE_KEYS[event.key];
                  if (type) {
                    event.preventDefault();
                    edit((s) => updateBlock(s, block.id, { type }));
                  }
                }}
              >
                <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
                  <select
                    value={block.type}
                    onChange={(e) =>
                      edit((s) =>
                        updateBlock(s, block.id, { type: e.target.value as BlockType }),
                      )
                    }
                    className="rounded border border-(--color-line) bg-transparent px-1.5 py-1 font-semibold uppercase tracking-wide"
                    aria-label={t('edit.sectionType')}
                  >
                    {BLOCK_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {blockName(type)}
                      </option>
                    ))}
                  </select>
                  <span className="font-mono text-(--color-muted)">{block.id}</span>

                  <input
                    value={block.label ?? ''}
                    onChange={(e) =>
                      edit(
                        (s) => updateBlock(s, block.id, { label: e.target.value || null }),
                        `label-${block.id}`,
                      )
                    }
                    placeholder={t('edit.label')}
                    aria-label={t('edit.label')}
                    className="w-32 rounded border border-transparent bg-transparent px-1 py-1 outline-none focus:border-(--color-line)"
                  />

                  <select
                    value={block.singers ?? ''}
                    onChange={(e) =>
                      edit((s) =>
                        updateBlock(s, block.id, {
                          singers: (e.target.value || null) as Singers | null,
                        }),
                      )
                    }
                    className="rounded border border-(--color-line) bg-transparent px-1.5 py-1"
                    aria-label={t('edit.whoSingsLabel')}
                  >
                    <option value="">{t('edit.whoSings')}</option>
                    {SINGERS.map((who) => (
                      <option key={who} value={who}>
                        {singerName(who)}
                      </option>
                    ))}
                  </select>

                  <label className="flex items-center gap-1 text-(--color-muted)">
                    ×
                    <input
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
                      className="w-12 rounded border border-(--color-line) bg-transparent px-1 py-1"
                      aria-label={t('edit.repeats')}
                    />
                  </label>

                  <label
                    className="flex items-center gap-1 text-(--color-muted)"
                    title={t('edit.linkedHint')}
                  >
                    <input
                      type="checkbox"
                      checked={block.linkToPrevious}
                      onChange={(e) =>
                        edit((s) =>
                          updateBlock(s, block.id, { linkToPrevious: e.target.checked }),
                        )
                      }
                    />
                    {t('edit.linked')}
                  </label>
                  <label
                    className="flex items-center gap-1 text-(--color-muted)"
                    title={t('edit.bandOnlyHint')}
                  >
                    <input
                      type="checkbox"
                      checked={block.bandOnly}
                      onChange={(e) =>
                        edit((s) => updateBlock(s, block.id, { bandOnly: e.target.checked }))
                      }
                    />
                    {t('edit.bandOnly')}
                  </label>

                  <span className="ml-auto flex gap-0.5">
                    <Btn
                      small
                      onClick={() => edit((s) => moveBlock(s, block.id, -1))}
                      title={t('edit.moveUp')}
                    >
                      <IconUp size={13} />
                    </Btn>
                    <Btn
                      small
                      onClick={() => edit((s) => moveBlock(s, block.id, 1))}
                      title={t('edit.moveDown')}
                    >
                      <IconDown size={13} />
                    </Btn>
                    <Btn
                      small
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
              <button
                type="button"
                onClick={() => {
                  void confirmAction({
                    message: t('edit.deleteConfirm', { title: current.title }),
                    confirmLabel: t('app.delete'),
                  }).then((ok) => {
                    if (ok) void adminApi.deleteSong(id).then(() => navigate('/'));
                  });
                }}
                className="text-xs text-(--color-muted) underline hover:text-red-500"
              >
                {t('edit.deleteSong')}
              </button>
            </div>
          </div>
        </div>

        {blocker.state === 'blocked' && (
          <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
            <div
              role="alertdialog"
              aria-modal="true"
              aria-label={t('edit.unsavedTitle')}
              className="w-full max-w-sm rounded-xl border border-(--color-line) bg-(--color-stage-bg) p-5 shadow-xl"
            >
              <h2 className="text-lg font-bold">{t('edit.unsavedTitle')}</h2>
              <p className="mt-1 text-sm text-(--color-muted)">{t('edit.unsavedBody')}</p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => blocker.reset?.()}
                  className="rounded-md border border-(--color-line) px-3 py-1.5 text-sm hover:bg-(--color-line)"
                >
                  {t('edit.stay')}
                </button>
                <button
                  type="button"
                  onClick={() => blocker.proceed?.()}
                  className="rounded-md border border-(--color-line) px-3 py-1.5 text-sm text-red-500 hover:bg-red-500/10"
                >
                  {t('edit.discard')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void save().then((ok) => (ok ? blocker.proceed?.() : blocker.reset?.()));
                  }}
                  className="rounded-md border border-(--color-chord) bg-(--color-chord) px-3 py-1.5 text-sm font-semibold text-white"
                >
                  {t('edit.save')}
                </button>
              </div>
            </div>
          </div>
        )}

        {preview && (
          <aside className="scroll-slim hidden min-h-0 w-[42%] shrink-0 overflow-y-auto border-l border-(--color-line) px-4 py-4 lg:block">
            <p className="mb-2 text-xs uppercase tracking-wider text-(--color-muted)">
              {t('edit.preview')}
            </p>
            <div style={{ fontSize: '16px' }}>
              <SongBody
                song={current}
                options={{ showChords: true, showBass: false, capo: 0, transpose: 0 }}
              />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

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
      <Field
        label={t('edit.copyright')}
        value={song.copyright ?? ''}
        onChange={(v) => edit((s) => ({ ...s, copyright: v || null }), 'copyright')}
        placeholder="—"
      />
      <Field
        label={t('edit.ccli')}
        value={song.ccli ?? ''}
        onChange={(v) => edit((s) => ({ ...s, ccli: v || null }), 'ccli')}
        placeholder="—"
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
    <label className="block">
      <span className="block text-[0.65rem] uppercase tracking-wide text-(--color-muted)">
        {label}
      </span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded border border-(--color-line) bg-transparent px-2 py-1 text-sm outline-none focus:border-(--color-chord)"
      />
    </label>
  );
}

function SaveBadge({ state }: { state: SaveState }) {
  const { t } = useT();
  const text: Record<SaveState, string> = {
    idle: '',
    dirty: t('save.dirty'),
    saving: t('save.saving'),
    saved: t('save.saved'),
    error: t('save.error'),
  };
  if (!text[state]) return null;
  return (
    <span
      className={`text-xs ${state === 'error' ? 'text-red-500' : 'text-(--color-muted)'}`}
      role="status"
    >
      {text[state]}
    </span>
  );
}

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
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded-md border font-medium transition-colors disabled:opacity-30 ${
        small ? 'px-1.5 py-0.5 text-xs' : 'px-2.5 py-1.5 text-sm'
      } ${
        active
          ? 'border-(--color-chord) bg-(--color-chord) text-white'
          : 'border-(--color-line) hover:bg-(--color-line)'
      }`}
    >
      {children}
    </button>
  );
}
