import type { Dialog } from 'electron';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import type { Song } from '@worship/core';
import {
  generatePowerPoint,
  generatedPowerPointName,
  resolvePowerPointFile,
  type PresentationOptions,
} from '@worship/server/powerpoints';
import { writePresentation } from '@worship/server/presentation-write';

export type PresentationExportResult =
  | { status: 'cancelled' }
  | { status: 'saved'; name: string; relativePath: string }
  | { status: 'external'; name: string; path: string };

export function insidePresentationFolder(root: string, file: string): boolean {
  // Resolve the parent physically so symlinked folders cannot disguise external exports.
  if (!existsSync(root)) return false;
  const rel = relative(realpathSync(root), join(realpathSync(dirname(file)), basename(file)));
  return (
    rel !== '..' &&
    !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) &&
    !isAbsolute(rel)
  );
}

export async function exportPresentation(
  dialog: Pick<Dialog, 'showSaveDialog' | 'showMessageBox'>,
  root: string,
  song: Song,
  options: PresentationOptions,
  action: 'saveAs' | 'regenerate',
  candidate: string | undefined,
  memoryFile: string,
): Promise<PresentationExportResult> {
  let destination: string | undefined;
  let replace = false;
  if (action === 'regenerate') {
    const existing = candidate && resolvePowerPointFile(root, candidate);
    if (!existing) throw new Error('Presentation no longer exists. Refresh and try again.');
    if (extname(existing).toLowerCase() === '.pptx') {
      const answer = await dialog.showMessageBox({
        type: 'warning',
        title: 'Regenerate presentation?',
        message: 'Manual edits in this presentation will be replaced.',
        detail: basename(existing),
        buttons: ['Cancel', 'Regenerate'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return { status: 'cancelled' };
      destination = existing;
      replace = true;
    } else {
      const answer = await dialog.showMessageBox({
        type: 'info',
        title: 'Save a new PowerPoint presentation',
        message: 'The original presentation will be preserved.',
        detail: 'Use Save As to create a new .pptx from the current song.',
        buttons: ['Cancel', 'Save As…'],
        defaultId: 1,
        cancelId: 0,
      });
      if (answer.response !== 1) return { status: 'cancelled' };
    }
  }
  let start = resolve(root);
  try {
    const remembered = await readFile(memoryFile, 'utf8');
    if (statSync(remembered).isDirectory()) start = remembered;
  } catch {
    /* No valid remembered export folder yet. */
  }
  while (!destination) {
    const selected = await dialog.showSaveDialog({
      title: 'Save presentation as…',
      defaultPath: join(start, generatedPowerPointName(song)),
      filters: [{ name: 'PowerPoint presentation', extensions: ['pptx'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory'],
    });
    if (selected.canceled || !selected.filePath) return { status: 'cancelled' };
    let chosen = selected.filePath;
    if (extname(chosen).toLowerCase() !== '.pptx') chosen += '.pptx';
    // Confirm the actual target, including collisions that appeared while the picker was open.
    const approvedReplacement = existsSync(chosen);
    if (approvedReplacement) {
      const answer = await dialog.showMessageBox({
        type: 'warning',
        message: 'Replace existing presentation?',
        detail: basename(chosen),
        buttons: ['Cancel', 'Replace'],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return { status: 'cancelled' };
    }
    if (!insidePresentationFolder(root, chosen)) {
      const answer = await dialog.showMessageBox({
        type: 'info',
        title: 'Export outside presentations folder?',
        message: 'This file will not be found automatically by the presentation-folder scan.',
        detail: chosen,
        buttons: ['Continue', 'Choose another location', 'Cancel'],
        defaultId: 1,
        cancelId: 2,
      });
      if (answer.response === 2) return { status: 'cancelled' };
      if (answer.response === 1) {
        start = dirname(chosen);
        continue;
      }
    }
    destination = chosen;
    replace = approvedReplacement;
  }
  const data = await generatePowerPoint(song, options);
  await writePresentation(destination, data, replace);
  await writeFile(memoryFile, dirname(destination), 'utf8').catch(() => {});
  return insidePresentationFolder(root, destination)
    ? {
        status: 'saved',
        name: basename(destination),
        relativePath: relative(realpathSync(root), realpathSync(destination)),
      }
    : { status: 'external', name: basename(destination), path: destination };
}
