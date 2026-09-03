# Android package manager

`dsh-mobile-apk` now includes a Kotlin-native package service that borrows the
Termux package flow without shipping a Go helper:

- `TermuxPackageManager.kt` downloads the Termux `Packages.gz` index and
  architecture-specific `.deb` files, verifies SHA-256, resolves basic
  dependency groups, extracts `data.tar.xz`, rewrites the archive prefix
  structurally, and keeps its own state under `usr/var/lib/dsh-mobile-pkg`.
- `TermuxPackageService.kt` exposes the manager only on IPv4 loopback with a
  random token, a bounded request body, a bounded worker pool, and a private
  endpoint file for diagnostics.
- `pkg-android.js` is a thin Node client. `usr/bin/pkg` is deployed as a shell
  wrapper which preserves argv and forwards to the local service.
- `setup_ppt_env.sh` installs native extensions through Termux packages first
  (`python-lxml`, `python-pillow`), then installs Python-layer packages with
  pip and runs import probes.

The service is started/reused from `EngineManager.shellEnv()`, so the engine,
console, and child processes receive the same `DSH_PKG_URL`, `DSH_PKG_TOKEN`,
`DSH_PKG_ENDPOINT`, and `DPKG_ADMINDIR` environment values.

## Interrupted command behavior

On Android, mutating package commands (`pkg update/install/reinstall/remove/uninstall/clean`)
are routed by the bundled runtime patch into the existing DSH background-job controller.
The tool call returns a job id immediately; the job controller then delivers the terminal
status and output through its completion wakeup and `job_output`. This avoids keeping a
foreground shell call open across downloads and archive extraction. Read-only package
queries remain foreground calls.

If a foreground command is interrupted before this routing is available, its external
side effects remain outcome-unknown: do not blindly repeat it. Start a new turn, inspect
`pkg list-installed` or the package status file, and retry only when the state proves the
operation did not complete.

## Verified on arm64 device

- APK builds with `:app:assembleDebug`.
- `pkg update` downloaded and parsed 2,949 `aarch64` packages.
- `pkg install -y libandroid-spawn` downloaded and extracted a Termux `.deb`.
- `pkg install -y python-lxml` resolved dependencies and installed the Android
  `aarch64` lxml package without a manylinux wheel.
- `pkg install -y python-pillow` resolved and installed the Android Pillow
  package plus its native image-library dependencies.
- `pkg show python-lxml` and `pkg show python-pillow` return Android `aarch64`
  package metadata.
- The deployed `usr/bin/pkg list-installed` wrapper returned the installed
  packages when run with the engine environment.

## Deliberate scope

This is an Android package bridge for mobile runtime additions, not a full
replacement for dpkg. It currently does not run maintainer scripts, verify
signed Release/InRelease metadata, implement Debian version constraints,
handle all control/data compression formats, or provide full file ownership
conflict and rollback semantics. Native packages should be tested on the
specific device ABI before being used for PPT runtime setup.
