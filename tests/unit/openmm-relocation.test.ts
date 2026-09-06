import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PYTHON = ['python3', 'python'].find((command) => (
  spawnSync(command, ['-c', 'import sys'], { encoding: 'utf8' }).status === 0
)) ?? 'python3';
const bootstrapDirectory = resolve(import.meta.dirname, '../../runtime-boxes/scrolls/openmm');
const bootstrap = join(bootstrapDirectory, 'python-startup.py');

describe('OpenMM Python relocation', () => {
  it('selects only the relocated environment library directory before imports, from any working directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'liatir-openmm-relocation-'));
    try {
      const original = join(root, 'original');
      const relocated = join(root, 'relocated with spaces');
      const created = spawnSync(PYTHON, ['-m', 'venv', '--without-pip', original], { encoding: 'utf8' });
      expect(created.status, created.stderr).toBe(0);
      const executable = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
      const discovered = spawnSync(join(original, executable), ['-c',
        'import site; print(site.getsitepackages()[0])'], { encoding: 'utf8' });
      expect(discovered.status, discovered.stderr).toBe(0);
      const sitePackages = discovered.stdout.trim();
      mkdirSync(sitePackages, { recursive: true });
      copyFileSync(bootstrap, join(sitePackages, 'liatir_openmm_bootstrap.py'));
      copyFileSync(join(bootstrapDirectory, 'liatir-openmm.pth'), join(sitePackages, 'liatir-openmm.pth'));
      renameSync(original, relocated);
      const result = spawnSync(join(relocated, executable), ['-c', [
        'import json, os, sys',
        'print(json.dumps({"path": os.environ.get("OPENMM_PLUGIN_DIR"), "prefix": sys.prefix, "search": sys.path,',
        '"startup": getattr(sys.modules.get("liatir_openmm_bootstrap"), "__file__", None),',
        '"scientificLoaded": "openmm" in sys.modules or "torch" in sys.modules}))',
      ].join('\n')], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, PYTHONPATH: '', PYTHONNOUSERSITE: '1', OPENMM_PLUGIN_DIR: '/untrusted/host/plugins' },
      });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toContain('Error processing line');
      const report = JSON.parse(result.stdout);
      expect(report.path, JSON.stringify({ sitePackages, report })).toBe(join(report.prefix, process.platform === 'win32' ? 'Library/lib/plugins' : 'lib/plugins'));
      expect(report.path).toContain('relocated with spaces');
      expect(report.scientificLoaded).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('retains both Windows DLL search handles for later OpenMM imports', () => {
    const result = spawnSync(PYTHON, ['-c', [
      'import json, os, pathlib, sys, tempfile',
      'with tempfile.TemporaryDirectory() as directory:',
      '    sys.prefix = directory',
      '    sys.platform = "win32"',
      '    for name in ("lib", "bin"): pathlib.Path(directory, "Library", name).mkdir(parents=True)',
      '    os.add_dll_directory = lambda value: value',
      '    namespace = {}',
      `    exec(${JSON.stringify(readFileSync(bootstrap, 'utf8'))}, namespace)`,
      '    print(json.dumps({"retained": namespace["_liatir_openmm_dll_handles"], "prefix": directory}))',
    ].join('\n')], { encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.retained).toEqual(['bin', 'lib'].map((part) => join(report.prefix, 'Library', part)));
  });
});
