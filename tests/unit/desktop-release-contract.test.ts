import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateReleaseEnvironment } from '../../scripts/build-desktop-release.mjs';

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
    }, 'win32')).toContain(
      'This Gate 7 release contract is implemented only for macOS; add and verify the native platform contract first',
    );
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

  it('keeps the ad-hoc package gate visibly separate from public release artifacts', async () => {
    const script = await readFile(resolve(root, 'scripts/build-desktop-macos-adhoc.mjs'), 'utf8');
    expect(script).toContain("config.bundle.createUpdaterArtifacts = false");
    expect(script).toContain("signingIdentity: '-'");
    expect(script).toContain('must not be published');
    expect(script).toContain("hdiutil', ['verify'");
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
