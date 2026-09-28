# Desktop distribution channel and release builds

Taken 2026-09-28 by the maintainer, before the first signed release.

## Decision

- **First public version: `0.1.0`.** The Microsoft Store accepts only numeric versions, so beta
  status is not carried in the version string.
- **Update feed: `https://updates.liatir.com/desktop/latest.json`**, a static Tauri updater
  manifest served from Cloudflare R2 under Liatir's own domain, next to the AI Model storage. The
  address is compiled into every installed copy, so it must be a domain the project owns: the
  files behind it can move later without stranding anyone. GitHub Releases on `liatir-stack` is
  not an option — the repository is private, so its assets are not publicly downloadable.
- **macOS and Linux update themselves from that feed.** On Linux only the AppImage replaces
  itself; `.deb` and `.rpm` update through their package manager.
- **Windows ships only through the Microsoft Store**, and the Store owns updates there. The Store
  build is compiled without `tauri-plugin-updater` (`--no-default-features` with every other
  default feature), `prod-conf.sh` runs with `DISTRIBUTION=msix` so no updater configuration is
  generated, and the release script refuses an executable that still contains the updater crate.
  The bridge commands stay registered and answer that the Store owns updates, so the contract is
  the same on every build.
- **macOS is built, signed and notarized on the maintainer's Mac** with
  `scripts/build-desktop-release.mjs`, using the Developer ID identity already in its keychain.
  **Linux and the Store MSIX are built on GitHub-hosted runners** by
  `.github/workflows/desktop-release-build.yml`, dispatched by hand. Both build and verify only;
  publishing is a separate, explicitly authorized step.
- **The MSIX is assembled by `scripts/desktop-msix.mjs`**, because Tauri does not emit one: the
  release executable, every resource declared in the generated `tauri.conf.json`, Store tile
  images from `tauri icon`, and a manifest that also registers the `liatir` deep-link scheme
  (a packaged app's own registry writes are virtualized). It is left unsigned; the Store signs
  what it certifies.

## macOS entitlements (measured 2026-09-28)

A tiny probe that writes code to memory and runs it — what Wasmtime does for every in-process WASM
plugin — was signed with the Developer ID identity and the hardened runtime that notarization
requires:

| Entitlements | Result |
| --- | --- |
| none | killed at the first generated instruction |
| `cs.allow-jit` | killed the same way: Wasmtime does not use `MAP_JIT` |
| `cs.allow-unsigned-executable-memory` | runs |
| `developer.usernotifications.time-sensitive` | killed at launch, before `main` |

So `src-tauri/Entitlements.plist` grants `allow-unsigned-executable-memory` and no longer claims
the time-sensitive notification entitlement, which needs an embedded provisioning profile the app
does not have. Ordinary notifications do not need it. Every earlier macOS package was ad-hoc
signed, which cannot show either failure.

## Rejected

- **Desktopr (`suffro/desktopr`) for building.** It builds its own Rust runtime around a web app;
  Liatir's native bridge would be lost. Only its MSIX layout approach was reused, as a reference.
- **Desktopr's standalone sign action for macOS.** Tauri already signs and notarizes during the
  build, and signing afterwards would leave the updater archive holding the unsigned app, forcing
  it to be rebuilt and re-signed by hand.
- **A Windows code-signing certificate and a directly downloaded NSIS installer**, per the
  2026-08-20 Store decision in the [release gate](../state/roadmap/release-signed-distribution.md).
