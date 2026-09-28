/**
 * Assemble the Microsoft Store MSIX package from an already compiled Windows executable.
 *
 * Tauri does not emit MSIX, so the package layout is built here from the same inputs the NSIS
 * installer uses: the executable plus every resource declared in the generated tauri.conf.json.
 * Tauri resolves resources next to the executable on Windows, so they sit beside it in the package
 * root. The package is left unsigned: the Store signs what it certifies.
 */

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localNodeCliInvocation } from './node-cli.mjs';

/** Store tile images `tauri icon` generates; the manifest references exactly these. */
const ASSETS = ['StoreLogo.png', 'Square44x44Logo.png', 'Square71x71Logo.png', 'Square150x150Logo.png', 'Square310x310Logo.png'];

/** The Store requires a four-part numeric version whose last part is 0. */
export function msixVersion(appVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) {
    throw new Error(`MSIX needs a numeric X.Y.Z version, got '${appVersion}'`);
  }
  return `${appVersion}.0`;
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function msixManifest({ identity, version, displayName, executable, schemes }) {
  const protocols = schemes.map((scheme) => `
        <uap:Extension Category="windows.protocol">
          <uap:Protocol Name="${escapeXml(scheme)}" />
        </uap:Extension>`).join('');
  // Deep links are registered by the manifest here: a packaged app's own registry writes are
  // virtualized and would never reach the shell.
  const extensions = protocols ? `
      <Extensions>${protocols}
      </Extensions>` : '';
  return `<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:uap10="http://schemas.microsoft.com/appx/manifest/uap/windows10/10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap uap10 rescap">
  <Identity Name="${escapeXml(identity.name)}" Publisher="${escapeXml(identity.publisher)}" Version="${version}" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>${escapeXml(displayName)}</DisplayName>
    <PublisherDisplayName>${escapeXml(identity.publisherDisplayName)}</PublisherDisplayName>
    <Logo>Assets\\StoreLogo.png</Logo>
  </Properties>
  <Resources>
    <Resource Language="en-us" />
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.19041.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
  <Applications>
    <Application Id="Liatir" Executable="${escapeXml(executable)}" uap10:RuntimeBehavior="packagedClassicApp" uap10:TrustLevel="mediumIL">
      <uap:VisualElements DisplayName="${escapeXml(displayName)}" Description="${escapeXml(displayName)}" BackgroundColor="transparent" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png">
        <uap:DefaultTile Square71x71Logo="Assets\\Square71x71Logo.png" Square310x310Logo="Assets\\Square310x310Logo.png" />
      </uap:VisualElements>${extensions}
    </Application>
  </Applications>
</Package>
`;
}

/** Newest x64 copy of a Windows SDK tool; the SDK installs one directory per version. */
function windowsSdkTool(name) {
  const bin = join(process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'Windows Kits', '10', 'bin');
  const versions = existsSync(bin) ? readdirSync(bin).filter((entry) => /^10\./.test(entry)) : [];
  versions.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
  for (const version of versions.reverse()) {
    const tool = join(bin, version, 'x64', name);
    if (existsSync(tool)) return tool;
  }
  throw new Error(`${name} was not found in the Windows SDK under ${bin}`);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

/** Builds the package and returns its path. `executable` is the compiled release binary. */
export function assembleMsix({ root, appVersion, identity, executable }) {
  const tauriRoot = join(root, 'src-tauri');
  const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8'));
  const releaseDir = join(tauriRoot, 'target', 'release');
  const layout = join(releaseDir, 'msix-layout');
  const outputDir = join(releaseDir, 'bundle', 'msix');
  rmSync(layout, { recursive: true, force: true });
  mkdirSync(join(layout, 'Assets'), { recursive: true });
  mkdirSync(outputDir, { recursive: true });

  const executableName = 'liatir.exe';
  cpSync(executable, join(layout, executableName));
  for (const [source, target] of Object.entries(config.bundle.resources ?? {})) {
    cpSync(join(tauriRoot, source), join(layout, target), { recursive: true });
  }

  const icons = mkdtempSync(join(tmpdir(), 'liatir-msix-icons-'));
  try {
    const tauri = localNodeCliInvocation('@tauri-apps/cli/tauri.js', [
      'icon', join(tauriRoot, 'icons', 'icon.png'), '--output', icons,
    ]);
    run(tauri.command, tauri.args, root);
    for (const asset of ASSETS) cpSync(join(icons, asset), join(layout, 'Assets', asset));
  } finally {
    rmSync(icons, { recursive: true, force: true });
  }

  writeFileSync(join(layout, 'AppxManifest.xml'), msixManifest({
    identity,
    version: msixVersion(appVersion),
    displayName: config.productName,
    executable: executableName,
    schemes: config.plugins?.['deep-link']?.desktop?.schemes ?? [],
  }));

  const makepri = windowsSdkTool('makepri.exe');
  run(makepri, ['createconfig', '/cf', 'priconfig.xml', '/dq', 'en-US', '/o'], layout);
  run(makepri, ['new', '/pr', layout, '/cf', join(layout, 'priconfig.xml'), '/o'], layout);
  rmSync(join(layout, 'priconfig.xml'));

  const msix = join(outputDir, `Liatir_${appVersion}_x64.msix`);
  run(windowsSdkTool('makeappx.exe'), ['pack', '/d', layout, '/p', msix, '/o'], root);
  return msix;
}
