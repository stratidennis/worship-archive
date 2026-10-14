# Android Band and Leader APKs

Two universal APKs share the existing interface. Band hosts that interface on a
loopback-only origin and forwards API/live-session traffic to the selected Leader.
Leader owns its ChordPro library, set files, LAN session server, discovery advertising,
archive, editor and set controls directly on the tablet. No Node runtime, native
architecture-specific library, Google Play service, Capacitor dependency, or Gradle
download is needed.

## Local prerequisites

- Java 17 (`JAVA_HOME` or the system Java installation).
- Android SDK platform `android-36` and build-tools `36.1.0` already installed.
- `ANDROID_HOME`/`ANDROID_SDK_ROOT`, or the standard macOS SDK location.
- Existing workspace dependencies, built shared UI, and the permanent signing key.

The build script checks these and fails explicitly if anything is missing. It does
not install or download tools.

## Signing — preserve this key

Android updates must use the same application ID and signing certificate. Never
generate a fresh key per build. Never commit a private key or password to Git.

Explicit one-time setup, **only with the owner's approval**:

```bash
node packages/android/scripts/signing.mjs init
node packages/android/scripts/signing.mjs github
```

The first command creates `packages/android/.signing/release.keystore` and its
password profile, protected and ignored by Git. **Back up this folder securely.**
The second stores `ANDROID_SIGNING_KEYSTORE`, `ANDROID_SIGNING_PASSWORD`, and
`ANDROID_SIGNING_ALIAS` as GitHub repository secrets without printing their values.
CI refuses to create a temporary signing identity or use an unsigned APK.

Build locally:

```bash
pnpm dist:android:band
pnpm dist:android:leader
pnpm dist:android
pnpm --filter @worship/android test:native
```

Outputs are `packages/android/release/worship-archive-band-Android.apk` and
`packages/android/release/worship-archive-leader-Android.apk`.
Every APK is checked for its signature and ZIP alignment. The GitHub build uses
the workflow run number as `versionCode`, so subsequent downloaded APKs upgrade an
existing installation. Local builds default to version code 1; set
`ANDROID_VERSION_CODE` explicitly if testing an update over a newer CI installation.

## Device behaviour

- Android 8+ with a WebView supporting the shared renderer (Chromium 111+ features).
- No dependency on Google services, which matters for Huawei tablets.
- Leader cloud sync uses Android's system folder picker. It can therefore use any
  installed provider that exposes a writable folder (for example Drive, Dropbox,
  OneDrive, Nextcloud or local storage) without handling an account password or
  requesting access to the whole account. Only `Songs` and `Sets` are synchronized.
- Leader keeps a private working library and continues offline. It synchronizes once
  at startup, immediately after a song or set is saved or deleted, and when Android
  reports that network connectivity has returned; a manual sync remains available.
  Safe edits/deletions propagate, while conflicting changes are preserved as both
  copies under `Cloud Conflicts`.
- Backup export uses Android's system save dialog. Song import and backup restore use
  the system document picker, and song revisions can be listed, previewed and restored.
- PowerPoint and chord-spelling cleanup remain desktop-only.
- Stable device ID and name; automatic mDNS + broadcast discovery and manual HTTP
  address entry. Multiple Leaders require explicit selection.
- Portrait, landscape and split-window support. The WebView uses the device viewport,
  not a desktop-width overview or browser zoom. Existing phone scrolling is retained.
- The UI controls font-size floors, including proportionally smaller section titles;
  Android's default 8px WebView floor must not interrupt song fitting.
- Fullscreen and keep-awake settings. Discovery stops while the activity is in the
  background and resumes without reloading the song UI.
- The JavaScript bridge opens connection settings and reports the actual native
  window bounds. Its stable device-size report keeps tablets in tablet mode during
  rotation; real phones retain scrolling. It exposes no native files or commands.
- The proxy binds to `127.0.0.1`, checks Host/Origin, and denies deletion requests.
  Wi-Fi is a trusted network, as in the existing app; the Leader's HTTP service does
  not provide transport encryption. Do not use an untrusted public network.

## GitHub

The existing `desktop.yml` workflow is named **App builds**. Its nine desktop jobs
remain intact, and the Android job publishes separate Band and Leader artifacts.
Manual runs create downloads; `v*` tags additionally gather both APKs into the draft
release. The Android job installs the signed APKs into a disposable GitHub emulator,
completes native setup, connects to an isolated test Leader, and checks that the last
lyric remains inside the tablet screen after portrait/landscape/return rotations and
a landscape cold start. It also verifies that Android Leader can create/read songs
and sets, host a session, and survive rotations without restarting. Screenshots are a
separate short-lived diagnostic artifact; `worship-archive-band-Android` and
`worship-archive-leader-Android` remain the installable APK downloads.
