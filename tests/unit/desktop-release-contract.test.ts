import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateReleaseEnvironment } from '../../scripts/build-desktop-release.mjs';
import { msixManifest, msixVersion } from '../../scripts/desktop-msix.mjs';
import { updateManifest } from '../../scripts/desktop-update-manifest.mjs';

const root = resolve(import.meta.dirname, '../..');

describe('Gate 7 desktop release contract', () => {
  it('ships the production frontend inside the app and enables signed updater artifacts', async () => {
    const config = JSON.parse(await readFile(
      resolve(root, 'conf-templates/tauri.conf.template.prod.json'),
      'utf8',
    ));

    expect(config.build.frontendDist).toBe('../frontend/dist');
    expect(config.app.security.capabilities).toEqual(['local']);
    expect(config.app.security.csp).toContain("default-src 'self'");
    expect(config.bundle.targets).toContain('dmg');

    const script = await readFile(resolve(root, 'scripts/prod-conf.sh'), 'utf8');
    expect(script).toContain('.bundle.createUpdaterArtifacts = true');
    expect(script).toContain('UPDATE_ENDPOINT must use HTTPS');
    expect(script).toContain('MAIN_WINDOW_URL must be empty');
    expect(script).not.toContain('capabilities/remote.json');
  });

  it('requires exact release, updater-signing, code-signing and notarization inputs on macOS', () => {
    expect(validateReleaseEnvironment({}, 'darwin')).toEqual(expect.arrayContaining([
      'APP_VERSION must be an explicit semantic version',
      'RELEASE_REVISION must be the exact 40-character Git commit SHA',
      'UPDATE_ENDPOINT must be an explicit HTTPS URL',
      'TAURI_SIGNING_PRIVATE_KEY is required to produce signed updater artifacts',
      'APPLE_CERTIFICATE or APPLE_SIGNING_IDENTITY is required for macOS code signing',
    ]));

    expect(validateReleaseEnvironment({
      APP_VERSION: '0.3.0-beta.1',
      RELEASE_REVISION: 'a'.repeat(40),
      UPDATE_ENDPOINT: 'https://updates.liatir.com/{{target}}/{{arch}}/{{current_version}}',
      ED25519_PUBKEY: 'test-public-key',
      TAURI_SIGNING_PRIVATE_KEY: '/secure/updater.key',
      APPLE_SIGNING_IDENTITY: 'Developer ID Application: Liatir',
      APPLE_API_ISSUER: 'issuer',
      APPLE_API_KEY: 'key-id',
      APPLE_API_KEY_PATH: '/secure/AuthKey.p8',
    }, 'darwin')).toEqual([]);

    expect(validateReleaseEnvironment({
      APP_VERSION: '0.3.0-beta.1',
      RELEASE_REVISION: 'a'.repeat(40),
      UPDATE_ENDPOINT: 'https://updates.liatir.com/{{target}}/{{arch}}/{{current_version}}',
      ED25519_PUBKEY: 'test-public-key',
      TAURI_SIGNING_PRIVATE_KEY: '/secure/updater.key',
    }, 'freebsd')).toContain(
      'This Gate 7 release contract is implemented for macOS, Windows and Linux; add and verify the native platform contract first',
    );
  });

  it('requires only the signed updater inputs on Linux, whose packages carry no code signature', () => {
    expect(validateReleaseEnvironment({}, 'linux')).toEqual(expect.arrayContaining([
      'UPDATE_ENDPOINT must be an explicit HTTPS URL',
      'TAURI_SIGNING_PRIVATE_KEY is required to produce signed updater artifacts',
    ]));
    expect(validateReleaseEnvironment({
      APP_VERSION: '0.1.0',
      RELEASE_REVISION: 'a'.repeat(40),
      UPDATE_ENDPOINT: 'https://updates.liatir.com/desktop/latest.json',
      ED25519_PUBKEY: 'test-public-key',
      TAURI_SIGNING_PRIVATE_KEY: '/secure/updater.key',
    }, 'linux')).toEqual([]);
  });

  it('builds the Microsoft Store package without updater or certificate, from the reserved identity', () => {
    const store = {
      APP_VERSION: '0.1.0',
      RELEASE_REVISION: 'a'.repeat(40),
      MSIX_IDENTITY_NAME: 'Liatir.Liatir',
      MSIX_IDENTITY_PUBLISHER: 'CN=00000000-0000-0000-0000-000000000000',
      MSIX_PUBLISHER_DISPLAY_NAME: 'Liatir',
    };
    expect(validateReleaseEnvironment(store, 'win32', 'msix')).toEqual([]);
    expect(validateReleaseEnvironment(store, 'darwin', 'msix'))
      .toEqual(['The Microsoft Store package can only be built on Windows']);
    // The Store only accepts numeric versions, so a pre-release label is refused up front.
    expect(validateReleaseEnvironment({ ...store, APP_VERSION: '0.1.0-beta.1' }, 'win32', 'msix'))
      .toEqual(['APP_VERSION must be a numeric X.Y.Z version for the Microsoft Store']);
    expect(validateReleaseEnvironment({ ...store, MSIX_IDENTITY_PUBLISHER: 'Liatir' }, 'win32', 'msix'))
      .toEqual(['MSIX_IDENTITY_PUBLISHER must be the Partner Center publisher, starting with CN=']);
  });

  it('keeps the updater out of Store builds and registers deep links in the package manifest', async () => {
    const [backend, main, prodConf] = await Promise.all([
      readFile(resolve(root, 'src-tauri/src/bridge/app_updates.rs'), 'utf8'),
      readFile(resolve(root, 'src-tauri/src/main.rs'), 'utf8'),
      readFile(resolve(root, 'scripts/prod-conf.sh'), 'utf8'),
    ]);
    expect(main).toMatch(/#\[cfg\(feature = "tauri-plugin-updater"\)\]\s*\{\s*builder = builder\.plugin\(tauri_plugin_updater/);
    expect(backend).toContain('This copy of Liatir is updated by the Microsoft Store');
    expect(prodConf).toContain('del(.plugins.updater)');

    const manifest = msixManifest({
      identity: { name: 'Liatir.Liatir', publisher: 'CN=Test', publisherDisplayName: 'R&D' },
      version: msixVersion('0.1.0'),
      displayName: 'Liatir',
      executable: 'liatir.exe',
      schemes: ['liatir'],
    });
    expect(manifest).toContain('Version="0.1.0.0"');
    expect(manifest).toContain('<uap:Protocol Name="liatir" />');
    expect(manifest).toContain('R&#38;D');
    // MakeAppx rejects a large square tile without a wide one (error 80080204).
    expect(manifest).not.toContain('Square310x310Logo');
    expect(() => msixVersion('0.1.0-beta.1')).toThrow('numeric X.Y.Z');
  });

  it('requires code-signing and a countersigned timestamp on Windows', () => {
    expect(validateReleaseEnvironment({}, 'win32')).toEqual(expect.arrayContaining([
      'APP_VERSION must be an explicit semantic version',
      'TAURI_SIGNING_PRIVATE_KEY is required to produce signed updater artifacts',
      'WINDOWS_CERTIFICATE_THUMBPRINT (40 hex characters) or WINDOWS_CERTIFICATE is required for Windows code signing',
      'WINDOWS_TIMESTAMP_URL must be an explicit HTTPS RFC 3161 timestamp server',
    ]));

    const signed = {
      APP_VERSION: '0.3.0-beta.1',
      RELEASE_REVISION: 'a'.repeat(40),
      UPDATE_ENDPOINT: 'https://updates.liatir.com/{{target}}/{{arch}}/{{current_version}}',
      ED25519_PUBKEY: 'test-public-key',
      TAURI_SIGNING_PRIVATE_KEY: 'C:/secure/updater.key',
      WINDOWS_TIMESTAMP_URL: 'https://timestamp.digicert.com',
    };
    expect(validateReleaseEnvironment({
      ...signed,
      WINDOWS_CERTIFICATE_THUMBPRINT: 'A1B2C3D4E5F6' + '0'.repeat(28),
    }, 'win32')).toEqual([]);

    // An exported certificate is useless without its password, and a truncated thumbprint is not a
    // certificate identity at all.
    expect(validateReleaseEnvironment({
      ...signed,
      WINDOWS_CERTIFICATE: 'base64-pfx',
    }, 'win32')).toEqual(['WINDOWS_CERTIFICATE_PASSWORD is required with WINDOWS_CERTIFICATE']);
    expect(validateReleaseEnvironment({
      ...signed,
      WINDOWS_CERTIFICATE_THUMBPRINT: 'A1B2C3',
    }, 'win32')).toEqual([
      'WINDOWS_CERTIFICATE_THUMBPRINT (40 hex characters) or WINDOWS_CERTIFICATE is required for Windows code signing',
    ]);
  });

  it('keeps update controls behind the native bridge and blocks replacement during Jobs', async () => {
    const [backend, jobs, main, types, settings] = await Promise.all([
      readFile(resolve(root, 'src-tauri/src/bridge/app_updates.rs'), 'utf8'),
      readFile(resolve(root, 'src-tauri/src/bridge/jobs.rs'), 'utf8'),
      readFile(resolve(root, 'src-tauri/src/main.rs'), 'utf8'),
      readFile(resolve(root, 'src-ts/modules/rs/app/_types.ts'), 'utf8'),
      readFile(resolve(root, 'frontend/src/routes/settings/+page.svelte'), 'utf8'),
    ]);

    expect(main).toContain('tauri_plugin_updater::Builder::new().build()');
    expect(backend.match(/ensure_no_running_jobs\(&app\)\?/g)).toHaveLength(3);
    expect(backend).toContain('.download(');
    expect(backend).toContain('update.install(bytes)');
    expect(backend).toContain('block_new_jobs_for_update');
    expect(jobs).toContain('job_start_gate: RwLock<()>');
    expect(jobs.match(/allow_job_start\(\)\?/g)).toHaveLength(2);
    expect(types).toContain('updates: AppUpdatesInterface');
    expect(settings).toContain('Check for updates');
    expect(settings).toContain('Your data and analyses stay local');
  });

  it('writes an updater manifest carrying each platform signature verbatim, and refuses a missing platform', () => {
    const artifacts = {
      'darwin-aarch64': '/out/Liatir.app.tar.gz',
      'linux-x86_64': '/out/Liatir_0.1.0_amd64.AppImage',
    };
    const manifest = updateManifest({
      version: '0.1.0',
      downloadBase: 'https://github.com/Liatir/liatir-releases/releases/download/v0.1.0/',
      artifacts,
      publishedAt: '2026-09-28T00:00:00.000Z',
      readText: (path: string) => `signature of ${path}\n`,
    });
    expect(manifest).toEqual({
      version: '0.1.0',
      notes: '',
      pub_date: '2026-09-28T00:00:00.000Z',
      platforms: {
        'darwin-aarch64': {
          signature: 'signature of /out/Liatir.app.tar.gz.sig',
          url: 'https://github.com/Liatir/liatir-releases/releases/download/v0.1.0/Liatir.app.tar.gz',
        },
        'linux-x86_64': {
          signature: 'signature of /out/Liatir_0.1.0_amd64.AppImage.sig',
          url: 'https://github.com/Liatir/liatir-releases/releases/download/v0.1.0/Liatir_0.1.0_amd64.AppImage',
        },
      },
    });
    expect(() => updateManifest({
      version: '0.1.0',
      downloadBase: 'https://example.org',
      artifacts: { 'darwin-aarch64': artifacts['darwin-aarch64'] },
      readText: () => '',
    })).toThrow('Missing the linux-x86_64 updater artifact');
  });

  it('signs macOS with entitlements a Developer ID app can actually launch with', async () => {
    const entitlements = await readFile(resolve(root, 'src-tauri/Entitlements.plist'), 'utf8');
    // Restricted entitlements need an embedded provisioning profile; without one the notarized app
    // is killed at launch, which an ad-hoc signed gate never shows.
    expect(entitlements).not.toMatch(/<key>com\.apple\.developer\./);
    // In-process Wasmtime makes generated code executable without MAP_JIT.
    expect(entitlements).toContain('<key>com.apple.security.cs.allow-unsigned-executable-memory</key>');
  });

  it('keeps the ad-hoc package gate visibly separate from public release artifacts', async () => {
    const script = await readFile(resolve(root, 'scripts/build-desktop-macos-adhoc.mjs'), 'utf8');
    expect(script).toContain("config.bundle.createUpdaterArtifacts = false");
    expect(script).toContain("signingIdentity: '-'");
    expect(script).toContain('must not be published');
    expect(script).toContain("hdiutil', ['verify'");
  });

  it('builds the Windows package gate against the real installer format and refuses a signed one', async () => {
    const [template, script] = await Promise.all([
      readFile(resolve(root, 'conf-templates/tauri.conf.template.prod.json'), 'utf8'),
      readFile(resolve(root, 'scripts/build-desktop-windows-adhoc.mjs'), 'utf8'),
    ]);

    // The gate must package whatever the product actually ships on Windows.
    expect(JSON.parse(template).bundle.targets).toContain('nsis');
    expect(script).toContain("config.bundle.targets = ['nsis']");
    expect(script).toContain('config.bundle.createUpdaterArtifacts = false');
    expect(script).toContain("webviewInstallMode: { type: 'skip' }");
    // Unsigned is the whole separation from a release on Windows, so it is asserted, not assumed.
    expect(script).toContain("status !== 'NotSigned'");
    expect(script).toContain('must not be published');
    expect(script).toContain('NullsoftInst');
  });

  it('builds the Linux package gate against the claimed formats and produces no updater signature', async () => {
    const [template, script] = await Promise.all([
      readFile(resolve(root, 'conf-templates/tauri.conf.template.prod.json'), 'utf8'),
      readFile(resolve(root, 'scripts/build-desktop-linux-adhoc.mjs'), 'utf8'),
    ]);

    // Every Linux format the product claims has to be built and inspected, not just the easy one.
    const claimed = JSON.parse(template).bundle.targets;
    for (const target of ['deb', 'rpm', 'appimage']) expect(claimed).toContain(target);
    expect(script).toContain("const BUNDLES = ['deb', 'rpm', 'appimage']");
    expect(script).toContain('config.bundle.createUpdaterArtifacts = false');
    // Linux packages carry no signature of their own, so the absent updater signature is what keeps
    // this gate distinguishable from a release.
    expect(script).toContain('must not produce updater signatures');
    expect(script).toContain('must not be published');
    expect(script).toContain("'--contents', deb");
  });

  it('keeps unreadable workspace state intact and makes startup retryable', async () => {
    const [storage, workspaces, layout] = await Promise.all([
      readFile(resolve(root, 'frontend/src/lib/stores/app-storage.ts'), 'utf8'),
      readFile(resolve(root, 'frontend/src/lib/stores/workspace.svelte.ts'), 'utf8'),
      readFile(resolve(root, 'frontend/src/routes/+layout.svelte'), 'utf8'),
    ]);

    expect(storage).not.toContain('best effort');
    expect(workspaces).toContain("throw new Error('Workspace index is invalid: expected a workspaces array')");
    expect(workspaces).not.toMatch(/catch\s*\{\s*workspaces\s*=\s*\[\]/);
    expect(workspaces).toContain('initStarted = false');
    expect(layout).toContain('data-testid="startup-recovery"');
    expect(layout).toContain('testId="startup-retry"');
  });
});
