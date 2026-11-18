import { open, link, rename, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import JSZip from 'jszip';

/** Publish only a complete, validated package. Never remove a destination to replace it. */
export async function writePresentation(
  destination: string,
  data: Buffer,
  replace: boolean,
): Promise<void> {
  const zip = await JSZip.loadAsync(data, { checkCRC32: true });
  if (!zip.file('ppt/presentation.xml') || !zip.file('[Content_Types].xml'))
    throw new Error('Invalid presentation package.');
  const temporary = join(dirname(destination), `.worship-${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, 'wx');
    try {
      await file.writeFile(data);
      await file.sync();
    } finally {
      await file.close();
    }
    // Node uses the OS atomic replacement operation (MoveFileExW on Windows).
    // A locked target fails safely; never unlink the original as a workaround.
    if (replace) await rename(temporary, destination);
    else await link(temporary, destination); // Atomic no-clobber publication.
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOTSUP' || code === 'EOPNOTSUPP')
      throw new Error(
        'This folder does not support safe no-overwrite exports. Choose a local NTFS, APFS, or other folder that supports hard links.',
        { cause: error },
      );
    if (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')
      throw new Error(
        'Cannot save presentation. Close it in PowerPoint or another app, check folder permissions, and try again.',
        { cause: error },
      );
    throw error;
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}
