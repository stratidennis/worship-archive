/** Build one universal Android APK using the installed SDK; no Gradle/npm downloads. */
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolve(root, '../..');
const role = process.argv[2] ?? 'band';
if (role !== 'band' && role !== 'leader') throw new Error(`Unknown Android role: ${role}`);
const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), 'Library/Android/sdk');
const tools = join(sdk, 'build-tools/36.1.0');
const platform = join(sdk, 'platforms/android-36/android.jar');
const jdk =
  process.env.JAVA_HOME ??
  (process.platform === 'darwin'
    ? execFileSync('/usr/libexec/java_home', [], { encoding: 'utf8' }).trim()
    : null);
const javaTool = (name) => (jdk ? join(jdk, 'bin', name) : name);
const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: 'inherit', ...options });
for (const tool of ['aapt2', 'd8', 'zipalign', 'apksigner']) {
  if (!existsSync(join(tools, tool)))
    throw new Error(`Missing installed Android build tool: ${tool}. Nothing was downloaded.`);
}
if (!existsSync(platform))
  throw new Error('Android SDK platform 36 is required. Nothing was downloaded.');
const ui = join(workspace, 'packages/ui/dist');
if (!existsSync(join(ui, 'index.html')))
  throw new Error('Build the shared UI first: pnpm --filter @worship/ui build');
mkdirSync(join(root, 'build'), { recursive: true });
mkdirSync(join(root, 'release'), { recursive: true });
const work = mkdtempSync(join(root, 'build/apk-'));
const res = join(work, 'res');
const assets = join(work, 'assets/ui');
const generated = join(work, 'generated');
const classes = join(work, 'classes');
const dex = join(work, 'dex');
for (const directory of [generated, classes, dex, join(res, 'drawable')])
  mkdirSync(directory, { recursive: true });
cpSync(join(root, 'res'), res, { recursive: true });
cpSync(ui, assets, { recursive: true });
copyFileSync(
  join(workspace, 'packages/desktop/build/icon.png'),
  join(res, 'drawable/app_icon.png'),
);

const versionName =
  process.env.ANDROID_VERSION_NAME ??
  JSON.parse(readFileSync(join(workspace, 'package.json'), 'utf8')).version;
const versionCode = Number(process.env.ANDROID_VERSION_CODE ?? 1);
if (!Number.isInteger(versionCode) || versionCode < 1 || versionCode > 2100000000)
  throw new Error('Invalid Android version code');
const unsigned = join(work, 'unsigned.apk');
const resourceZip = join(work, 'resources.zip');
console.log(`Compiling Android resources and packaging the shared ${role} app…`);
run(join(tools, 'aapt2'), ['compile', '--dir', res, '-o', resourceZip]);
run(join(tools, 'aapt2'), [
  'link',
  '-o',
  unsigned,
  '-I',
  platform,
  '--manifest',
  join(root, role === 'leader' ? 'AndroidManifest-leader.xml' : 'AndroidManifest.xml'),
  '--java',
  generated,
  '-A',
  join(work, 'assets'),
  '--version-code',
  String(versionCode),
  '--version-name',
  versionName,
  '--min-sdk-version',
  '26',
  '--target-sdk-version',
  '36',
  resourceZip,
]);

// The Android native client shares the desktop discovery contract, not a separately
// maintained protocol/port constant that can silently drift on a future release.
const session = readFileSync(join(workspace, 'packages/core/src/session.ts'), 'utf8');
const protocol = session.match(/export const SESSION_PROTOCOL_VERSION = (\d+);/)?.[1];
const port = session.match(/export const LAN_DISCOVERY_PORT = (\d+);/)?.[1];
if (!protocol || !port) throw new Error('Could not read the shared LAN discovery contract');
const protocolDir = join(generated, 'com/worshiparchive/band');
mkdirSync(protocolDir, { recursive: true });
writeFileSync(
  join(protocolDir, 'Protocol.java'),
  `package com.worshiparchive.band;\nfinal class Protocol { static final int VERSION = ${protocol}; static final int DISCOVERY_PORT = ${port}; }\n`,
);
const javaFiles = (directory) =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? javaFiles(join(directory, entry.name))
      : entry.name.endsWith('.java')
        ? [join(directory, entry.name)]
        : [],
  );
const roleExcludedSources =
  role === 'leader'
    ? new Set([
        'BandActivity.java',
        'LeaderDiscovery.java',
        'LeaderEndpoint.java',
        'LocalBandServer.java',
      ])
    : new Set([
        'AndroidCloudSync.java',
        'ChordPro.java',
        'LeaderActivity.java',
        'LeaderAdvertisement.java',
        'LeaderKeepAliveService.java',
        'LeaderRepository.java',
        'LeaderSessionHub.java',
        'LocalLeaderServer.java',
      ]);
const roleSources = javaFiles(join(root, 'src')).filter(
  (path) => !roleExcludedSources.has(path.slice(path.lastIndexOf('/') + 1)),
);
console.log(`Compiling the native ${role} shell…`);
run(javaTool('javac'), [
  '--release',
  '8',
  '-encoding',
  'UTF-8',
  '-cp',
  platform,
  '-d',
  classes,
  ...roleSources,
  ...javaFiles(generated),
]);
const jar = join(work, 'classes.jar');
run(javaTool('jar'), ['cf', jar, '-C', classes, '.']);
run(join(tools, 'd8'), [
  '--release',
  '--min-api',
  '26',
  '--lib',
  platform,
  '--output',
  dex,
  jar,
]);
run(javaTool('jar'), ['uf', unsigned, '-C', dex, 'classes.dex']);
const aligned = join(work, 'aligned.apk');
run(join(tools, 'zipalign'), ['-P', '16', '-f', '4', unsigned, aligned]);

let keystore;
let password;
let alias = process.env.ANDROID_SIGNING_ALIAS ?? 'worship-band';
if (process.env.ANDROID_SIGNING_KEYSTORE) {
  keystore = join(work, 'release.keystore');
  writeFileSync(keystore, Buffer.from(process.env.ANDROID_SIGNING_KEYSTORE, 'base64'), {
    mode: 0o600,
  });
  password = process.env.ANDROID_SIGNING_PASSWORD;
} else if (process.env.GITHUB_ACTIONS === 'true') {
  throw new Error(
    'Configure permanent Android signing secrets before enabling APK builds. An ephemeral key must not be used.',
  );
} else {
  const profile = JSON.parse(readFileSync(join(root, '.signing/profile.json'), 'utf8'));
  keystore = join(root, '.signing/release.keystore');
  password = profile.password;
  alias = profile.alias;
}
if (!password || !existsSync(keystore))
  throw new Error('Missing permanent Android signing key or password');
const output = join(root, `release/worship-archive-${role}-Android.apk`);
console.log(`Signing the installable Android ${role} APK with the permanent key…`);
try {
  run(
    join(tools, 'apksigner'),
    [
      'sign',
      '--ks',
      keystore,
      '--ks-key-alias',
      alias,
      '--ks-pass',
      'env:WORSHIP_APK_PASSWORD',
      '--key-pass',
      'env:WORSHIP_APK_PASSWORD',
      '--out',
      output,
      aligned,
    ],
    { env: { ...process.env, WORSHIP_APK_PASSWORD: password } },
  );
} finally {
  // Do not leave the decoded CI signing key on disk for later workflow steps.
  if (process.env.ANDROID_SIGNING_KEYSTORE) unlinkSync(keystore);
}
run(join(tools, 'apksigner'), ['verify', '--verbose', output]);
run(join(tools, 'zipalign'), ['-c', '-P', '16', '4', output]);
console.log(`Android ${role} APK ready: ${output}`);
