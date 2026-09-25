import { emptyBlock, emptyLine, type Song } from '@worship/core';

/** A new song stays only in the editor until its required title is saved. */
export function newSongDraft(now = new Date().toISOString()): Song {
  const verse = emptyBlock('V1', 'Verse');
  verse.lines = [emptyLine('')];
  return {
    id: 'new',
    legacyUuid: null,
    title: '',
    writtenKey: null,
    performanceKey: null,
    tempo: null,
    timeSignature: null,
    authors: [],
    copyright: null,
    ccli: null,
    tags: [],
    collectionIds: [],
    blocks: [verse],
    arrangement: null,
    lang: null,
    createdAt: now,
    updatedAt: now,
    rev: 0,
  };
}
