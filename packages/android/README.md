# Android Band APK

One universal APK, Band only. The native Java shell packages the existing UI and
hosts it on a loopback-only origin, forwarding API and live-session traffic to the
selected Leader. Changing the Leader IP does not change the origin or discard
local display preferences/cached songs. No Node runtime, native architecture-specific
library, Google Play service, Capacitor dependency, or Gradle download is needed.

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
pnpm --filter @worship/android test:native
```

Output: `packages/android/release/worship-archive-band-Android.apk`.
Every APK is checked for its signature and ZIP alignment. The GitHub build uses
the workflow run number as `versionCode`, so subsequent downloaded APKs upgrade an
existing installation. Local builds default to version code 1; set
`ANDROID_VERSION_CODE` explicitly if testing an update over a newer CI installation.

## Device behaviour

- Android 8+ with a WebView supporting the shared renderer (Chromium 111+ features).
- No dependency on Google services, which matters for Huawei tablets.
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

The existing `desktop.yml` workflow is now named **App builds**. Its nine desktop
jobs remain intact and one Android Band job is added. Manual runs create download
artifacts; `v*` tags additionally gather the APK into the draft release.
The Android job also installs the signed APK into a disposable GitHub emulator,
completes native setup, connects to an isolated test Leader, and checks that the last
lyric remains inside the tablet screen after portrait/landscape/return rotations and
a landscape cold start. It also opens the phone layout and captures screenshots.
The screenshots are a separate short-lived diagnostic artifact;
`worship-archive-band-Android` remains the installable APK download.
