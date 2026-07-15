# Android runtime and release integrity

## Goal

Make the Android edition usable for opening and safely saving PDF documents, and make every published Android artifact reproducible, update-compatible, and signed with one persistent certificate. The release workflow produces a sideloadable ARM64 APK and an AAB for store testing. Store upload remains a manual operator action.

## Scope

This design contains two coordinated tranches:

1. Runtime correctness for mobile file handling and rendering.
2. Release integrity for signing, artifacts, versioning, and publication gates.

The tranches share one verification gate because an Android artifact must not be published unless both runtime and release checks pass. Automatic store publication, support for additional Android ABIs, and unrelated desktop renderer work are out of scope.

## Runtime architecture

### Mobile save actions

`MobileApp.jsx` will call the established PDF save functions through a small mobile action module instead of dispatching custom DOM events that have no listeners. The module exposes explicit asynchronous `save` and `saveAs` operations, reports failures through the existing status and dialog facilities, and prevents overlapping saves.

`Save` writes to the active document URI when one exists. `Save As` asks the Android Storage Access Framework for a destination and updates the document path only after the write has been verified.

### Android document URIs

Android `content://` URIs are handled exclusively by `@tauri-apps/plugin-fs`. The plugin already resolves those URIs through Android's content resolver. They must never be passed to Rust commands that use `std::fs`, desktop file locks, or desktop cache invalidation.

The mobile write transaction is:

1. Serialize the active document into a `Uint8Array`.
2. Write the bytes through the Tauri filesystem plugin.
3. Read the destination back through the same plugin.
4. Verify byte length and SHA-256 digest.
5. Only then update the active path, original-byte cache, recent-file state, and dirty flag.

If any step fails or verification differs, the document remains dirty and retains its previous path. The UI reports that the save was not confirmed and offers Save As when appropriate.

### Mobile renderer boundary

A single predicate will define whether the desktop-native PDF backend is available. It returns false on Android/iOS and for `content://` paths. Loader prewarming, page analysis, native rendering, file locking, cache invalidation, and prefetch calls must use this predicate rather than checking only for Tauri.

Mobile rendering therefore stays on PDF.js, which consumes the already loaded document bytes and does not require a filesystem path understood by Rust.

## Release architecture

### Persistent signing

The workflow must never generate an ephemeral keystore. It expects these GitHub Actions secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

After `tauri android init`, CI decodes the keystore into the runner's temporary directory and writes an ignored `src-tauri/gen/android/keystore.properties`. A repository-owned, idempotent Node script configures the generated app Gradle build to use those properties for `release`. The script fails if the expected Gradle structure is absent and is covered by a fixture-based unit test. Neither the keystore nor the properties file is committed or uploaded as an artifact.

Missing or empty secrets cause an immediate, actionable failure before compilation. The workflow prints only whether each secret exists and may print the public SHA-256 certificate fingerprint; it never prints key material or passwords.

An existing production certificate must be reused. If no production keystore exists, key creation and secure backup are an explicit operator ceremony outside the repository before Android publication can succeed.

### APK and AAB outputs

CI runs Tauri in non-interactive mode for ARM64 and produces both formats:

- `Open.PDF.Studio_<version>_arm64.apk` for GitHub sideloading.
- `Open.PDF.Studio_<version>_arm64.aab` for store/internal testing.

Both files are signed by Gradle with the same configured certificate. CI verifies the APK signature and verifies the AAB JAR signature before upload. Artifact discovery must require exactly one matching output per format; missing or ambiguous output is a failure.

### Version codes

Official CI builds receive a monotonically increasing Android `versionCode` through a temporary Tauri configuration override. The code is the number of elapsed UTC seconds since `2020-01-01T00:00:00Z`. This starts above the previously derived `1.77.0` code, remains below Android's `2,100,000,000` limit until well beyond the expected support lifetime, and gives stable and rolling-nightly workflows one shared ordering. Their Android jobs use the same repository-wide concurrency group without cancellation so two official builds cannot claim the same second. A later stable build can therefore replace an earlier nightly build. The human-facing `versionName` continues to come from the application version.

The derived value is checked against Android's maximum and printed in the build summary. It is not written back to source files during CI.

### Publication gates

The Android job is no longer `continue-on-error`. Stable publication depends on successful Android runtime tests, Android compilation, signing verification, and artifact upload. The rolling nightly also exposes signed APK and AAB assets and uses the same certificate.

The first store upload remains manual so the store can establish the application identifier and certificate relationship. No service-account credentials or automatic track promotion are introduced.

## Tests

Implementation follows red-green-refactor and adds these regression checks before production changes:

1. Mobile save actions call the real save entry points and surface rejected operations.
2. A verified `content://` write clears dirty state; a read-back mismatch leaves path and dirty state unchanged.
3. Desktop locking and Rust cache commands are not called for mobile or `content://` documents.
4. The desktop-native backend predicate is false on mobile and for Android document URIs, and true for a normal desktop path.
5. Workflow policy tests reject ephemeral `keytool` generation, hard-coded passwords, optional Android jobs, missing APK/AAB builds, and publication that does not depend on Android success.
6. Build verification runs the existing frontend build, typecheck, focused Node tests, Rust tests affected by the change, and an Android CI build when signing secrets are available.

An emulator or physical-device smoke test opens a PDF through the Android document picker, edits it, saves it, reopens it, and confirms the edit remains. This is the final runtime acceptance test; a successful compiler run alone is insufficient.

## Error handling and observability

- Save failures include the operation phase (`serialize`, `write`, `read-back`, or `verify`) without exposing document contents.
- CI errors identify the missing signing input or missing artifact by name without echoing secret values.
- Build summaries record application version, Android version code, target ABI, artifact hashes, signature fingerprint, and verification results.
- A failed Android job leaves the release draft unpublished.

## Security and repository hygiene

- Keystores, passwords, generated signing properties, and decoded secrets stay outside git.
- The repository contains only secret names and setup documentation.
- Temporary signing files are removed by the ephemeral runner lifecycle and are never uploaded.
- The committed workflow validates that no fallback signing identity can be created silently.

## Acceptance criteria

The work is complete when:

1. Save and Save As work from the Android mobile UI.
2. Local and cloud-provider document URIs either verify successfully or fail without clearing unsaved state.
3. Mobile PDFs render without invoking path-based desktop Rust commands.
4. Stable and nightly workflows produce one signed ARM64 APK and one signed ARM64 AAB with a persistent certificate.
5. Android failure prevents publication.
6. Focused tests, frontend verification, and signature checks pass.
7. A device/emulator save-and-reopen smoke test passes, or the only remaining blocker is explicitly identified as unavailable signing/device infrastructure.
