/** Explicit, one-time key setup. Never print credentials or commit them to Git. */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const directory = join(root, '.signing');
const keystore = join(directory, 'release.keystore');
const profilePath = join(directory, 'profile.json');
const command = process.argv[2];
if (command === 'init') {
  if (existsSync(keystore) || existsSync(profilePath))
    throw new Error('A signing key already exists. It must not be overwritten.');
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const password = randomBytes(32).toString('hex');
  const alias = 'worship-band';
  execFileSync(
    'keytool',
    [
      '-genkeypair',
      '-keystore',
      keystore,
      '-storetype',
      'PKCS12',
      '-alias',
      alias,
      '-keyalg',
      'RSA',
      '-keysize',
      '3072',
      '-sigalg',
      'SHA256withRSA',
      '-validity',
      '10000',
      '-dname',
      'CN=Worship Band, OU=Android, O=Worship Archive',
      '-storepass:env',
      'WORSHIP_KEY_PASSWORD',
      '-keypass:env',
      'WORSHIP_KEY_PASSWORD',
    ],
    { env: { ...process.env, WORSHIP_KEY_PASSWORD: password }, stdio: 'pipe' },
  );
  chmodSync(keystore, 0o600);
  writeFileSync(profilePath, JSON.stringify({ password, alias }), { mode: 0o600 });
  console.log(
    'Permanent Android signing key created in the Git-ignored .signing folder. Back up this folder securely.',
  );
} else if (command === 'github') {
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'));
  const values = {
    ANDROID_SIGNING_KEYSTORE: readFileSync(keystore).toString('base64'),
    ANDROID_SIGNING_PASSWORD: profile.password,
    ANDROID_SIGNING_ALIAS: profile.alias,
  };
  for (const [name, value] of Object.entries(values)) {
    execFileSync('gh', ['secret', 'set', name, '--repo', 'stratidennis/worship-archive'], {
      input: value,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    console.log(`${name} stored in GitHub Actions (value not displayed).`);
  }
} else
  throw new Error(
    'Use signing.mjs init to create a key, or signing.mjs github to upload approved secrets.',
  );
