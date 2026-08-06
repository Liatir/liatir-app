import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createCondaDependencyLicenseAudit,
  lockedCondaDistributions,
  parseCondaPackageReference,
  validateCondaDependencyLicenseAudit,
} from '../../scripts/runtime-box/licenses.mjs';

// A trimmed but structurally faithful pixi.lock: the environments block, then a packages list whose
// conda entries carry name/version in the filename and the license inline, plus one pypi entry.
const LOCK = `version: 7
environments:
  default:
    channels:
    - url: https://conda.anaconda.org/conda-forge/
    packages:
      osx-arm64:
      - conda: https://conda.anaconda.org/conda-forge/noarch/anndata-0.12.19-pyhd8ed1ab_0.conda
packages:
- conda: https://conda.anaconda.org/conda-forge/noarch/array-api-compat-1.15.0-pyhc364b38_0.conda
  sha256: 328865729d20c18ad2bb2472ae88dbe04e20291b4e36d9fab89d10b5a2badf35
  depends:
  - python >=3.10
  license: MIT
  license_family: MIT
  size: 62003
- conda: https://conda.anaconda.org/conda-forge/noarch/anndata-0.12.19-pyhd8ed1ab_0.conda
  license: BSD-3-Clause
  license_family: BSD
- pypi: https://files.pythonhosted.org/packages/xx/example-2.0.0-py3-none-any.whl
  name: example
  version: 2.0.0
  license: Apache-2.0
`;

describe('Runtime Box conda license audit', () => {
  it('parses (name, version) from a conda package filename, names with hyphens included', () => {
    expect(parseCondaPackageReference(
      'https://conda.anaconda.org/conda-forge/noarch/array-api-compat-1.15.0-pyhc364b38_0.conda',
    )).toEqual({ name: 'array-api-compat', version: '1.15.0' });
    expect(parseCondaPackageReference('.../pytorch-2.8.0-cpu_generic_py311_hf0c13c8_2.conda'))
      .toEqual({ name: 'pytorch', version: '2.8.0' });
    expect(() => parseCondaPackageReference('.../not-a-package.txt')).toThrow(/unparseable conda package/);
  });

  it('collects sorted conda + pypi distributions with their declared licenses from pixi.lock', () => {
    expect(lockedCondaDistributions(Buffer.from(LOCK))).toEqual([
      { name: 'anndata', version: '0.12.19', declaredLicense: 'BSD-3-Clause', source: 'conda' },
      { name: 'array-api-compat', version: '1.15.0', declaredLicense: 'MIT', source: 'conda' },
      { name: 'example', version: '2.0.0', declaredLicense: 'Apache-2.0', source: 'pypi' },
    ]);
  });

  it('builds a deterministic audit bound to the exact pixi.lock hash', () => {
    const lockBytes = Buffer.from(LOCK);
    const audit = createCondaDependencyLicenseAudit({ lockBytes, targetId: 'macos-aarch64-metal' });
    expect(audit).toMatchObject({
      schemaVersion: 1,
      kind: 'liatir.runtime-box.conda-dependency-license-audit',
      targetId: 'macos-aarch64-metal',
      dependencyLockSha256: createHash('sha256').update(lockBytes).digest('hex'),
    });
    expect(audit.packages).toHaveLength(3);
    expect(validateCondaDependencyLicenseAudit(audit, audit)).toBe(audit);
    expect(() => validateCondaDependencyLicenseAudit(
      { ...audit, packages: audit.packages.slice(1) },
      audit,
    )).toThrow(/differ from the reviewed audit/);
  });

  it('rejects a package with no declared license', () => {
    const noLicense = LOCK.replace('  license: MIT\n', '');
    expect(() => lockedCondaDistributions(Buffer.from(noLicense))).toThrow(/lacks a declared license/);
  });
});
