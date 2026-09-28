# Release gate — signed public distribution

Status: **Open, in progress since 2026-09-28.** The distribution channel is
decided ([decision](../../decisions/desktop-distribution-channel.md)) and the
build paths for all three platforms are implemented; no signed release has been
built yet.

This gate is deliberately unnumbered. The workbench plan numbers its gates 1 to
8, but "Gate 8" and "Gate 9" already name Runtime Box CI gates elsewhere in this
knowledge base, so a ninth workbench number would be ambiguous in exactly the
documents that reference both.

## Why this gate exists

Gate 7 originally carried both the local desktop matrix and the signed public
release. Those two halves have different blockers: the first is engineering, the
second is credentials, money and a distribution decision. Keeping them in one
gate meant a finished, fully executed body of work stayed open indefinitely
behind a purchase.

Gate 7 was therefore closed on 2026-08-20 at the local layer — implemented,
executed and cross-verified on macOS arm64, Windows x86_64 and Linux x86_64 —
and everything below moved here. See
[Gate 7 Beta 1 — macOS evidence](../../history/gate-7-beta1-macos.md) and
[Gate 7 Beta 1 — Windows and Linux evidence](../../history/gate-7-beta1-windows-linux.md)
for what is already proven.

Nothing here changes what "released" means. Local packaging is still not
evidence of a publishable release, and no signature requirement may be weakened
to make it look like one.

## What is already implemented

- `scripts/build-desktop-release.mjs` refuses to build without an exact semantic
  version and Git revision, an HTTPS updater endpoint, updater signing keys and
  platform signing inputs. It verifies artifacts but never publishes them.
- The macOS contract requires Developer ID inputs and Apple notarization
  credentials, and verifies signature and stapling.
- The Windows contract requires a 40-character certificate thumbprint or a PFX
  plus password, an HTTPS RFC 3161 timestamp URL, an NSIS installer and a
  `.nsis.zip` updater artifact, and runs `Get-AuthenticodeSignature` over both
  the installer and the executable it packages, demanding `Valid` plus a real
  countersignature.
- Both platforms have a local, unsigned package gate that is visibly separate
  from a release and produces no updater signature.
- Since 2026-09-28 the script also covers **Linux** (updater-signed AppImage plus
  `.deb` and `.rpm`, no code signature) and, with `--msix`, the **Microsoft
  Store package**: built without the updater crate and assembled by
  `scripts/desktop-msix.mjs`. `.github/workflows/desktop-release-build.yml`
  runs both on GitHub-hosted runners, dispatched by hand, and never publishes.

## What is missing

| Item | Blocker |
| --- | --- |
| Apple notarization credentials | The Developer ID Application identity is in the maintainer's keychain; three copies are installed, all valid to 2031, so builds name the newest by its SHA-1, `CF1EC4A38CD20857E8C2A15DA87D06307EE4DCF2`, since the common name is ambiguous. An App Store Connect API key for notarization is not yet issued. |
| Updater key pair in GitHub | Generated 2026-09-28 on the maintainer's Mac: private key `~/.tauri/liatir-updater.key`, its password in the login Keychain item `liatir-updater-key`, public key in `~/.tauri/liatir-updater.key.pub`. Not yet backed up outside that Mac, and not yet in GitHub (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, variable `TAURI_SIGNING_PUBLIC_KEY`). Losing the private key means installed copies can never be updated again. |
| The `updates.liatir.com` feed on R2 and a manifest generator | Not started; only needed to publish, not to build. |
| Microsoft Store identity in GitHub | Reserved 2026-09-28 (Store ID `9NDBJVZJVV1Z`, Package Family Name `Desktopr.Liatir_2a6896ac5t66t`): `MSIX_IDENTITY_NAME=Desktopr.Liatir`, `MSIX_IDENTITY_PUBLISHER=CN=B27DF8BD-5700-47C4-9719-CA85B3F0938A`, `MSIX_PUBLISHER_DISPLAY_NAME=Desktopr` — the Partner Center account's name, shown to users as the publisher. Not secret; not yet set as repository variables. |
| A clean macOS arm64 machine or user for the install proof | Access, not code. |
| MSIX containment of Runtime Boxes, Python environments and WSL2 | See consequence 3 below; unproven until the package runs on a real Windows machine. |
| A real signed Beta A to Beta B update through the configured HTTPS feed, on macOS and Linux | Depends on all of the above. |

## The Windows decision: Microsoft Store (2026-08-20)

The maintainer decided that Windows will be distributed through the Microsoft
Store rather than by buying a code-signing certificate. That is a reasonable
call on cost, but it is a change of distribution model, not the same work minus
the certificate, and it invalidates part of what Gate 7 proved on Windows.

Three consequences have to be settled before this route is committed to:

1. **The NSIS installer is not what a Store submission takes.** Settled
   2026-09-28: an MSIX, assembled by `scripts/desktop-msix.mjs` and left
   unsigned for the Store to sign.
2. **A Store app must not update itself.** Settled 2026-09-28: the Store build
   is compiled without `tauri-plugin-updater`, and the release script refuses an
   executable that still contains it.
3. **MSIX runs the app in a container with a virtualized filesystem.** Liatir
   downloads and executes managed binaries, creates Python virtual environments
   and installs Runtime Boxes. That is precisely the behaviour that has to be
   validated inside an MSIX container, and reviewed against Store certification
   policy, before this route is chosen. This is the real risk of the decision —
   larger than the certificate it saves.

Until those are settled, the Windows evidence in Gate 7 stands for what it is:
a locally built, unsigned NSIS installer with a proven silent install and
uninstall. It is not evidence for a Store submission.

## Close condition

This gate closes only when every platform claimed by the beta has, on a clean
machine, a signed and distributable package, a proven install, and a real signed
A-to-B update after which pre-existing scientific data reopens intact.

## Stop rules

Do not create a release, publish artifacts, submit to any store, dispatch GPU
workflows or run heavy AI tests without a new explicit authorization. Do not
weaken a signature, notarization or countersignature requirement to turn local
packaging into a release claim.
