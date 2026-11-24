import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { parseChordPro } from '@worship/core';
import { resolvePerformedOrder } from '../src/performed-order.js';
import { generatePowerPoint } from '../src/powerpoints.js';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { strict: { type: 'boolean' } },
});
if (positionals.length !== 1) {
  console.error('Usage: pnpm audit:presentations <songs-directory> [--strict]');
  process.exit(1);
}

const folder = positionals[0]!;
const files = (await readdir(folder, { recursive: true, withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.chopro$/i.test(entry.name))
  .map((entry) => join(entry.parentPath, entry.name))
  .sort();
if (files.length === 0) {
  console.error('No ChordPro songs found in the selected directory.');
  process.exit(1);
}

let ready = 0;
let drafts = 0;
let failed = 0;
for (const file of files) {
  try {
    const song = parseChordPro(await readFile(file, 'utf8'));
    const { issues } = resolvePerformedOrder(song);
    const allowDraft = issues.length > 0;
    for (const repeatMode of ['compact', 'expanded'] as const) {
      await generatePowerPoint(song, { repeatMode, allowDraft });
    }
    if (allowDraft) {
      drafts++;
      console.log(`Review “${song.title}”`);
      for (const issue of issues) console.log(`  ${issue}`);
    } else ready++;
  } catch (error) {
    failed++;
    console.error(file, error instanceof Error ? error.message : error);
  }
}
console.log(
  `${files.length} songs checked in both repeat modes. ${ready} ready, ${drafts} drafts, ${failed} failed.`,
);
if (failed || (values.strict && drafts)) process.exitCode = 1;
