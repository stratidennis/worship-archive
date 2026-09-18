import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  BLOCK_TYPES,
  SINGERS,
  insertBlock,
  insertLine,
  mergeBlockUp,
  moveBlock,
  removeBlock,
  removeLine,
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

/** Keyboard shortcuts carried over from the old SongEditor, so muscle memory survives. */
const TYPE_KEYS: Record<string, BlockType> = {
  F6: 'Verse',
  F7: 'Chorus',
  F8: 'Bridge',
};

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function EditPage() {
  const { t, blockName, singerName } = useT();
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const song = useUndoable<Song | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [preview, setPreview] = useState(false);
  const [layer, setLayer] = useState<'chords' | 'bass'>('chords');
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
        savedRef.current = JSON.stringify(loaded);
        reset(loaded);
      })
      .catch((e: unknown) => setError(String(e)));
  }, [id, reset, t]);

  const current = song.value;

  // Autosave. Debounced, and it compares against what was last persisted so an undo
  // back to the saved state does not write an identical revision.
  useEffect(() => {
    if (!current) return;
    const serialised = JSON.stringify(current);
    if (serialised === savedRef.current) {
      setSaveState('idle');
      return;
    }
    setSaveState('dirty');
    const timer = setTimeout(() => {
      setSaveState('saving');
      repo
        .saveSong(id, current)
        .then((stored) => {
          savedRef.current = JSON.stringify({
            ...current,
            rev: stored.rev,
            updatedAt: stored.updatedAt,
          });
          setSaveState('saved');
        })
        .catch((e: unknown) => {
          setError(String(e));
          setSaveState('error');
        });
    }, 800);
    return () => clearTimeout(timer);
  }, [current, id]);

  const edit = useCallback(
    (fn: (s: Song) => Song, mergeKey?: string) => {
      song.set((s) => (s ? fn(s) : s), mergeKey);
    },
    [song],
  );

  // Undo/redo at the document level. The browser's own undo still works inside a field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) song.redo();
        else song.undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [song]);

  if (error && !current) {
    return (
      <div className="p-6">
        <Link to="/" className="text-sm underline">
          ← {t('app.library')}
        </Link>
        <p className="mt-4 text-sm text-(--color-muted)">{t('song.loadError', { error })}</p>
      </div>
    );
  }
  if (!current)
    return <div className="p-6 text-sm text-(--color-muted)">{t('app.loading')}</div>;

  return (
    <div className="flex h-dvh flex-col">
      <header className="shrink-0 border-b border-(--color-line) px-4 py-2">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2">
          <Link
            to={`/song/${encodeURIComponent(id)}`}
            className="text-sm text-(--color-muted)"
            aria-label={t('app.back')}
          >
            ←
          </Link>
          <input
            value={current.title}
            onChange={(e) => edit((s) => ({ ...s, title: e.target.value }), 'title')}
            placeholder={t('edit.title')}
            aria-label={t('edit.title')}
            className="min-w-40 flex-1 bg-transparent text-lg font-bold outline-none focus:bg-(--color-chord)/5"
          />
          <SaveBadge state={saveState} />
          <div className="flex items-center gap-1 text-sm">
            <Btn onClick={song.undo} disabled={!song.canUndo} title={t('edit.undo')}>
              ↶
            </Btn>
            <Btn onClick={song.redo} disabled={!song.canRedo} title={t('edit.redo')}>
              ↷
            </Btn>
            <Btn
              onClick={() => setLayer(layer === 'chords' ? 'bass' : 'chords')}
              active={layer === 'bass'}
            >
              {layer === 'bass' ? t('song.bass') : t('song.chords')}
            </Btn>
            <Btn onClick={() => setPreview(!preview)} active={preview}>
              {t('edit.preview')}
            </Btn>
          </div>
        </div>
      </header>

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
                      ↑
                    </Btn>
                    <Btn
                      small
                      onClick={() => edit((s) => moveBlock(s, block.id, 1))}
                      title={t('edit.moveDown')}
                    >
                      ↓
                    </Btn>
                    <Btn
                      small
                      onClick={() => edit((s) => mergeBlockUp(s, block.id))}
                      title={t('edit.mergeUp')}
                    >
                      ⇧⇧
                    </Btn>
                    <Btn
                      small
                      onClick={() => edit((s) => removeBlock(s, block.id))}
                      title={t('edit.removeSection')}
                    >
                      ✕
                    </Btn>
                  </span>
                </div>

                {block.lines.map((line, lineIndex) => (
                  <LineEditor
                    key={lineIndex}
                    line={line}
                    layer={layer}
                    showChords
                    onTextChange={(text) =>
                      edit(
                        (s) => updateLine(s, block.id, lineIndex, (l) => setLineText(l, text)),
                        `text-${block.id}-${lineIndex}`,
                      )
                    }
                    onChordChange={(at, raw) =>
                      edit((s) =>
                        updateLine(s, block.id, lineIndex, (l) => setChord(l, at, raw, layer)),
                      )
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

        {preview && (
          <aside className="hidden min-h-0 w-[42%] shrink-0 overflow-y-auto border-l border-(--color-line) px-4 py-4 lg:block">
            <p className="mb-2 text-xs uppercase tracking-wider text-(--color-muted)">
              {t('edit.preview')}
            </p>
            <div style={{ fontSize: '16px' }}>
              <SongBody
                song={current}
                options={{
                  showChords: true,
                  showBass: layer === 'bass',
                  capo: 0,
                  transpose: 0,
                }}
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
