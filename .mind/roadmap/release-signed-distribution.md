# Release gate — signed public distribution

Status: **Open, and deliberately not started (2026-08-20).** Every prerequisite
that does not require a credential, a paid account or a distribution decision is
already complete and executed.

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
[Gate 7 Beta 1 — macOS evidence](./gate-7-beta1-macos.md) and
[Gate 7 Beta 1 — Windows and Linux evidence](./gate-7-beta1-windows-linux.md)
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

## What is missing

| Item | Blocker |
| --- | --- |
| Apple Developer ID identity and notarization credentials | Apple Developer Program, currently 99 USD/year. There is no free path to distributing outside the App Store without a Gatekeeper warning. |
| A clean macOS arm64 machine or user for the install proof | Access, not code. |
| The Windows distribution decision and its build path | See below. |
| Linux package signing keys and a distributable package per format | `build-desktop-release.mjs` still deliberately rejects `linux`; that contract is unwritten. |
| A real signed Beta A to Beta B update through the configured HTTPS feed, on every platform | Depends on all of the above. |

## The Windows decision: Microsoft Store (2026-08-20)

The maintainer decided that Windows will be distributed through the Microsoft
Store rather than by buying a code-signing certificate. That is a reasonable
call on cost, but it is a change of distribution model, not the same work minus
the certificate, and it invalidates part of what Gate 7 proved on Windows.

Three consequences have to be settled before this route is committed to:

1. **The NSIS installer is not what a Store submission takes.** A packaged
   submission wants an MSIX, and Tauri does not emit one — the production
   `targets` are `["nsis", "app", "dmg", "deb", "rpm", "appimage"]` — so it
   would have to be packaged separately. Microsoft also accepts unpackaged
   EXE/MSI apps, but that route has historically still required the installer to
   be signed by a trusted CA, which would defeat the purpose. **Which of the two
   routes actually avoids buying a certificate must be verified against current
   Microsoft documentation**; the rules have changed more than once and are not
   safe to assume.
2. **A Store app must not update itself.** The in-app updater, together with the
   Job-safety guard that refuses install or restart while a scientific Job is
   running, is a Gate 7 deliverable and would have to be disabled in a Store
   build. That is a separate build variant, not a configuration flag, and the
   Store build then needs its own evidence that the update path is absent rather
   than merely unused.
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
