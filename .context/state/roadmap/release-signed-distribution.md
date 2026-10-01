# Release gate — signed public distribution

Status: **Open — 0.1.1 published for macOS and Linux on 2026-10-01 (0.1.0 on 2026-09-29); Store submission pending.** The distribution channel is
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
- Since 2026-10-01 the same workflow also builds **macOS** on an Apple-silicon runner
  (`macos-15`): the Developer ID certificate is imported into a keychain of that job only,
  the Native Tools box and the app are signed with it, and the app and the disk image are
  notarized. The credentials are repository secrets (`APPLE_CERTIFICATE`,
  `APPLE_CERTIFICATE_PASSWORD`, `APPLE_ID`, `APPLE_PASSWORD`) and variables
  (`APPLE_SIGNING_IDENTITY`, `APPLE_TEAM_ID`), set from the maintainer's signing folder.
  `targets: all` builds every platform from one revision.

## What is missing

| Item | Blocker |
| --- | --- |
| Apple notarization credentials | The Developer ID Application identity is in the maintainer's keychain; three copies are installed, all valid to 2031, so builds name the newest by its SHA-1, `CF1EC4A38CD20857E8C2A15DA87D06307EE4DCF2`, since the common name is ambiguous. An App Store Connect API key for notarization is not yet issued. |
| Developer ID signatures inside the Native Tools box | **Resolved 2026-09-28:** Scrollcase 1.3.0 added `--codesign` and 1.4.0 `--codesign-entitlements`; the signed box (562 Mach-O files) passed its self-test and Apple accepted it on its own (submission `6123de1c-5b9d-484e-bdcd-1c34851fc502`, 0 issues). Original finding: the first notarization of `0.1.0` (submission `3779c3f5-7d35-40bd-b419-b6af768154db`, 2026-09-28, from `c60c7fd`) was rejected: the app itself passed, but Apple unpacks the embedded `native-tools-macos-aarch64-cpu.zip` and found 562 Mach-O files (`venv/lib`, `bin`, `libexec`, `sbin`) without a Developer ID signature, a secure timestamp or, for 104 executables, the hardened runtime. Scrollcase never runs `conda-unpack` and never rewrites a binary on extraction, so signatures applied before archiving stay valid; Scrollcase has no signing step yet. |
| Updater key pair | Generated 2026-09-28 on the maintainer's Mac: private key `~/.tauri/liatir-updater.key`, its password in the login Keychain item `liatir-updater-key`, public key in `~/.tauri/liatir-updater.key.pub`. In GitHub since 2026-09-28 (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`, variable `TAURI_SIGNING_PUBLIC_KEY`); backing it up outside that Mac is the maintainer's. Losing the private key means installed copies can never be updated again. |
| The `updates.liatir.com` feed | R2 bucket `liatir-updates` with custom domain `updates.liatir.com` created 2026-09-28; `scripts/desktop-update-manifest.mjs` writes `desktop/latest.json`. Nothing uploaded yet. Downloads go to the public `Liatir/liatir-releases` repository, created the same day with only a README. |
| Microsoft Store identity in GitHub | Reserved 2026-09-28 (Store ID `9NDBJVZJVV1Z`, Package Family Name `Desktopr.Liatir_2a6896ac5t66t`): `MSIX_IDENTITY_NAME=Desktopr.Liatir`, `MSIX_IDENTITY_PUBLISHER=CN=B27DF8BD-5700-47C4-9719-CA85B3F0938A`, `MSIX_PUBLISHER_DISPLAY_NAME=Lorenzo Suffritti` (changed from `Desktopr` in Partner Center on 2026-09-29, before the first submission), shown to users as the publisher. Not secret; set as repository variables 2026-09-28. |
| A clean macOS arm64 machine or user for the install proof | Access, not code. |
| MSIX containment of Runtime Boxes, Python environments and WSL2 | See consequence 3 below; unproven until the package runs on a real Windows machine. |
| A real signed Beta A to Beta B update through the configured HTTPS feed, on macOS and Linux | Depends on all of the above. |

## 0.1.0 build evidence (2026-09-28, revision `4544e0e`)

- **macOS arm64**, built on the maintainer's Mac with `build-desktop-release.mjs`: Native Tools box
  code-signed by Scrollcase 1.4.0 (562 Mach-O files, self-test passed), app signed with
  `CF1EC4A38CD20857E8C2A15DA87D06307EE4DCF2` and notarized by Tauri (`spctl`: Notarized Developer ID).
  The disk image was not notarized by Tauri, so the script's DMG check failed; it was notarized
  (submission `d1ff99b3-c02d-4952-80e5-d1affe123af8`, Accepted), stapled, and passed the same
  `spctl`, `stapler validate` and `hdiutil verify` checks by hand. The script now does this itself.
  The updater archive holds the stapled app. Launched from it with an isolated `HOME`, the app stayed
  up, unpacked the box, and `samtools`, `bcftools`, `minimap2` and `h5repack` ran signed.
  SHA-256: DMG `febc3559…27626`, `Liatir_0.1.0_aarch64.app.tar.gz` `a10a97c5…9813b`.
- **Linux and the Store MSIX**, `desktop-release-build.yml` run 36449268531 at the same revision.
  Both updater signatures were verified against the public key before publishing.
- **Published 2026-09-29:** GitHub release `v0.1.0` in `Liatir/liatir-releases` (DMG, updater
  archive and signature, AppImage and signature, `.deb`, `.rpm`; GitHub's SHA-256 digests match the
  built files), and `https://updates.liatir.com/desktop/latest.json` (`Cache-Control: no-cache`)
  naming 0.1.0 for `darwin-aarch64` and `linux-x86_64`. Right after publishing, GitHub served a
  cached 500 for the DMG URL while the other assets downloaded; it cleared on its own.
- **Not done:** the Store submission (the maintainer uploads the MSIX in Partner Center), a
  clean-machine install, and a real A-to-B update, which needs 0.1.1.

## The version comes from package.json (2026-10-01)

0.1.1 was built with its version typed into the workflow while `package.json` still said 0.1.0,
so the site's homepage, which reads `package.json`, kept showing 0.1.0. The root `package.json` is
now the only source of the app version: `scripts/app-version.mjs` reads it for the conf scripts
and the local package gates, the release workflow takes it from the dispatched revision instead
of an input, and the release script refuses an `APP_VERSION` that differs. To release, bump
`package.json` (`npm version X.Y.Z --no-git-tag-version`), push, then dispatch the workflow.

The homepage of the public site (Cloudflare Pages project `liatir-docs`) reads the same
`package.json`, but the project rebuilds only for commits that change its build watch paths, which
covered `docs/` alone: the six commits from `9cb6a9d` to `1ad4fb0` were all skipped and the
homepage kept 0.1.0. `package.json` must be in the project's included build watch paths (a
dashboard setting the CLI cannot change; asked of the maintainer on 2026-10-01). The Download page
is unaffected: it reads the latest GitHub release at visit time.

## 0.1.1 build evidence (2026-09-30, revision `9cb6a9d`)

0.1.1 carries the viewer fixes found in 0.1.0: the 3D viewers were blank under the production
policy, and JBrowse never started ([decision](../../decisions/viewers-run-in-a-static-sandbox-host-page.md)).

- **Linux and the Store MSIX**, `desktop-release-build.yml` run 36747975085, `app_version=0.1.1`,
  `targets=linux-and-store`, all three jobs successful. Artifacts `liatir-0.1.1-linux` and
  `liatir-0.1.1-microsoft-store`, kept until 2026-10-14.
- **macOS arm64**: not built in that run, which had no macOS job yet. The job was added on
  2026-10-01, and 0.1.1 was rebuilt for every platform from one revision so the release is
  consistent.
- **The published build is run 36856377156** at revision `270f1d3` (`targets=all`): the macOS job
  signed the Native Tools box and the app with the Developer ID certificate and notarized the app
  and the disk image on GitHub, on its first run. Before publishing, on the maintainer's Mac: both
  updater signatures verified against `TAURI_SIGNING_PUBLIC_KEY` (minisign, file and trusted
  comment; a one-byte change to a copy was rejected); the DMG passed `spctl` (Notarized Developer
  ID), `stapler validate` and `hdiutil verify`; the app in the updater archive passed `codesign
  --verify --deep --strict`, `spctl` and `stapler validate`, version 0.1.1, team `UC22LVU6ZY`.
- **Published 2026-10-01:** GitHub release `v0.1.1` in `Liatir/liatir-releases`, marked latest,
  with the DMG, updater archive and signature, AppImage and signature, `.deb` and `.rpm`; GitHub's
  SHA-256 digests match all seven verified files. Then `desktop/latest.json` in R2 bucket
  `liatir-updates`, naming 0.1.1 for `darwin-aarch64` and `linux-x86_64`, uploaded with
  `wrangler r2 object put` (`application/json`, `no-cache`) only after both updater URLs answered
  200 with the right size; the file served at `updates.liatir.com` is byte-identical to the
  generated one. This is the first update a 0.1.0 installation is offered.
- **Store:** the 0.1.1 MSIX from the same run was handed to the maintainer for Partner Center.

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
