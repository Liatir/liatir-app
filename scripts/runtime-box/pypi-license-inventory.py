#!/usr/bin/env python3

"""
Builds the reviewed licence inventory for the PyPI half of a pixi.lock.

pixi records an SPDX licence for every conda package and none at all for a PyPI one, so Scrollcase
can derive the conda inventory from the lock but has nothing to derive the PyPI half from. The only
honest source is the distribution the lock already pins: each one is downloaded, its SHA-256 checked
against the lock, and its own metadata read. Nothing is inferred from a package name, and any
licence string this project has not reviewed stops the run instead of entering the inventory.

    python3 scripts/runtime-box/pypi-license-inventory.py \\
      runtime-boxes/scrolls/<box>/<target>/pixi.lock \\
      runtime-boxes/legal/audits/<box>-<target>-pypi.json \\
      --declaration runtime-boxes/legal/audits/<box>-<target>-pypi-declaration.json \\
      --cache ~/.cache/liatir-pypi-licenses --reviewed-at 2026-09-11

Re-running it against an unchanged lock reproduces both files byte for byte.

The inventory is this project's evidence: it binds every licence to the lock it was read from and
says how each one was determined. The declaration is what Scrollcase's `pypiLicenseDeclaration`
consumes, and its contract is a bare array of name/version/declaredLicense — so it is written here
as a projection of the inventory rather than reviewed a second time, and
`tests/unit/pypi-license-declaration.test.ts` fails if the two ever disagree.
"""

import argparse
import email
import hashlib
import json
import os
import re
import sys
import tarfile
import urllib.request
import zipfile

# SPDX identifiers this project has reviewed. An expression may combine them with AND / OR.
REVIEWED_SPDX = {
    "MIT", "MIT-CMU", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "MPL-2.0", "ISC",
    "LGPL-2.1-or-later", "LGPL-3.0-or-later", "PSF-2.0",
    # No SPDX identifier fits these, and inventing a near-enough one would misdescribe the terms.
    "LicenseRef-Biopython", "LicenseRef-Matplotlib", "LicenseRef-NVIDIA-Proprietary",
    # NVIDIA ships its CUDA libraries under two different agreements and declares the same
    # uninformative name for both. The identifiers mirror how conda-forge names them, so the same
    # library carries the same term whichever channel a box took it from.
    "LicenseRef-NVIDIA-CUDA-EULA", "LicenseRef-NVIDIA-SDK-License-Agreement",
}

# Legacy `License:` and classifier strings, mapped to SPDX after reading each distribution.
SPDX_FROM_DECLARED = {
    "BSD": "BSD-3-Clause",
    "BSD License": "BSD-3-Clause",
    "3-Clause BSD License": "BSD-3-Clause",
    "Apache 2.0": "Apache-2.0",
    "Apache License 2.0": "Apache-2.0",
    "Apache License, Version 2.0": "Apache-2.0",
    "Apache Software License": "Apache-2.0",
    "MIT License": "MIT",
    "LGPL v3": "LGPL-3.0-or-later",
    "GNU Lesser General Public License v3 (LGPLv3)": "LGPL-3.0-or-later",
    "Apache License 2.0.": "Apache-2.0",
    "Apache 2.0 License": "Apache-2.0",
    "Apache Software License 2.0": "Apache-2.0",
    "ISC license": "ISC",
    "ISC License (ISCL)": "ISC",
    "GNU Lesser General Public License v2 or later (LGPLv2+)": "LGPL-2.1-or-later",
    "new BSD": "BSD-3-Clause",
    "BSD 3-Clause License": "BSD-3-Clause",
    "Dual License": "Apache-2.0 OR BSD-3-Clause",
    # Biopython ships its own agreement, dual-licensed BSD-3-Clause for some files only.
    "Freely Distributable": "LicenseRef-Biopython",
}

# Publishers who declare a name that identifies nothing while shipping the real agreement inside the
# distribution. The declared string only says which family to look in; the identifier comes from the
# first line of the text that actually travels with the library, so a changed agreement stops the
# run instead of inheriting the old answer.
BUNDLED_AGREEMENT_FOR_DECLARED = {
    "NVIDIA Proprietary Software": {
        "End User License Agreement": "LicenseRef-NVIDIA-CUDA-EULA",
        "LICENSE AGREEMENT FOR NVIDIA SOFTWARE DEVELOPMENT KITS":
            "LicenseRef-NVIDIA-SDK-License-Agreement",
    },
}

# Distributions whose own metadata declares nothing usable, settled by reading the licence text they
# carry. The file named here is the one that settled it, and it travels inside the distribution.
FROM_BUNDLED_TEXT = {
    "boltz": ("MIT", "boltz-2.2.1.dist-info/licenses/LICENSE"),
    "fairscale": ("BSD-3-Clause", "fairscale-0.4.13/LICENSE"),
    # Matplotlib's own agreement, derived from the PSF licence but not it; the classifier says
    # "Python Software Foundation License", which would be the wrong identifier to record.
    "matplotlib": ("LicenseRef-Matplotlib", "matplotlib-3.10.5.dist-info/LICENSE"),
    # The cuEquivariance family declares nothing at all and splits two ways once opened: the Python
    # halves are Apache-2.0, the compiled NVIDIA kernels are proprietary.
    "cuequivariance": ("Apache-2.0", "cuequivariance-0.11.1.dist-info/licenses/LICENSE"),
    "cuequivariance-torch": ("Apache-2.0", "cuequivariance_torch-0.8.0.dist-info/licenses/LICENSE"),
    "cuequivariance-ops-cu12": ("LicenseRef-NVIDIA-Proprietary",
                                "cuequivariance_ops_cu12-0.8.0.dist-info/licenses/LICENSE"),
    "cuequivariance-ops-torch-cu12": ("LicenseRef-NVIDIA-Proprietary",
                                      "cuequivariance_ops_torch_cu12-0.8.0.dist-info/licenses/LICENSE"),
}

CLASSIFIER = re.compile(r"^License :: (?:OSI Approved :: )?(.+)$")

# Filled by `inventory_entry` and reported together, so one run names every term a human still has
# to read rather than the first one alphabetically.
unreviewed = []


def lock_pypi_entries(path):
    """Every `- pypi:` entry of a pixi.lock, with the URL and SHA-256 it pins."""
    lines = open(path, encoding="utf-8").read().replace("\r\n", "\n").split("\n")
    if "packages:" not in lines:
        sys.exit(f"{path} has no packages section")
    entries, current = [], None

    def flush():
        nonlocal current
        if current and current["source"] == "pypi":
            entries.append(current)
        current = None

    for line in lines[lines.index("packages:") + 1:]:
        head = re.match(r"^- (conda|pypi): (.+)$", line)
        if head:
            flush()
            current = {"source": head.group(1), "url": head.group(2),
                       "name": None, "version": None, "sha256": None}
            continue
        if current is None:
            continue
        if line and not line.startswith(" "):
            flush()
            break
        field = re.match(r"^  (\w[\w-]*): (.*)$", line)
        if field and field.group(1) in ("name", "version", "sha256"):
            key = field.group(1)
            if current[key] is None:
                current[key] = field.group(2).strip()
    flush()
    return entries


def download(url, expected_sha256, cache):
    target = os.path.join(cache, url.split("/")[-1])
    if not os.path.exists(target):
        with urllib.request.urlopen(url, timeout=180) as response:
            payload = response.read()
        with open(target, "wb") as handle:
            handle.write(payload)
    digest = hashlib.sha256(open(target, "rb").read()).hexdigest()
    if digest != expected_sha256:
        sys.exit(f"SHA-256 mismatch for {url}: {digest} != {expected_sha256}")
    return target


def bundled_agreement(path):
    """The first line of the licence text a distribution carries, and the file it came from."""
    if not path.endswith(".whl"):
        return None, None
    with zipfile.ZipFile(path) as archive:
        candidates = [name for name in archive.namelist()
                      if name.upper().endswith(("LICENSE.TXT", "LICENSE", "LICENCE.TXT"))]
        if not candidates:
            return None, None
        name = sorted(candidates)[0]
        text = archive.read(name).decode("utf-8", "replace").strip()
    heading = text.splitlines()[0].strip() if text else ""
    return heading, name


def metadata_text(path):
    if path.endswith(".whl"):
        with zipfile.ZipFile(path) as archive:
            name = next(n for n in archive.namelist() if n.endswith(".dist-info/METADATA"))
            return archive.read(name).decode("utf-8", "replace")
    with tarfile.open(path) as archive:
        name = next(n for n in archive.getnames() if n.endswith("PKG-INFO"))
        return archive.extractfile(name).read().decode("utf-8", "replace")


def declared_strings(text):
    message = email.message_from_string(text)
    expression = (message.get("License-Expression") or "").strip()
    legacy = (message.get("License") or "").strip()
    # Some projects paste a full licence text into the field; only a short expression is usable.
    if legacy and ("\n" in legacy or len(legacy) > 64 or legacy.upper() == "UNKNOWN"):
        legacy = ""
    classifiers = []
    for raw in message.get_all("Classifier") or []:
        found = CLASSIFIER.match(raw.strip())
        if found:
            classifiers.append(found.group(1).strip())
    return expression, legacy, classifiers


def reviewed_spdx_expression(value):
    tokens = [token.strip("()").strip() for token in re.split(r"\s+(?:AND|OR)\s+", value)]
    return bool(tokens) and all(token in REVIEWED_SPDX for token in tokens)


def inventory_entry(entry, cache):
    path = download(entry["url"], entry["sha256"], cache)
    expression, legacy, classifiers = declared_strings(metadata_text(path))
    name = entry["name"]
    # pixi quotes versions YAML would otherwise read as numbers; the version is the inner text.
    version = re.sub(r"^'(.*)'$", r"\1", entry["version"])
    base = {"name": name, "version": version, "source": "pypi",
            "sha256": entry["sha256"], "distribution": os.path.basename(path)}

    if expression:
        return {**base, "declaredLicense": expression, "determinedFrom": "license-expression"}
    declared = legacy or (classifiers[0] if classifiers else "")
    source = "license-field" if legacy else "classifier"
    if declared and reviewed_spdx_expression(declared):
        return {**base, "declaredLicense": declared, "determinedFrom": source}
    if declared and declared in SPDX_FROM_DECLARED:
        return {**base, "declaredLicense": SPDX_FROM_DECLARED[declared],
                "determinedFrom": source, "declaredText": declared}
    if declared in BUNDLED_AGREEMENT_FOR_DECLARED:
        heading, license_file = bundled_agreement(path)
        license_id = BUNDLED_AGREEMENT_FOR_DECLARED[declared].get(heading)
        if license_id:
            return {**base, "declaredLicense": license_id,
                    "determinedFrom": "bundled-license-agreement",
                    "licenseFile": license_file, "declaredText": declared,
                    "agreementHeading": heading}
    if name in FROM_BUNDLED_TEXT:
        license_id, license_file = FROM_BUNDLED_TEXT[name]
        return {**base, "declaredLicense": license_id, "determinedFrom": "bundled-license-file",
                "licenseFile": license_file, **({"declaredText": declared} if declared else {})}
    # Unreviewed licences are collected rather than fatal on the first one: reviewing a lock means
    # reading every unfamiliar term once, and stopping at each in turn would mean one download pass
    # per unknown package.
    unreviewed.append({"name": name, "version": version, "declaredText": declared,
                       "classifiers": classifiers, "distribution": base["distribution"]})
    return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("lock")
    parser.add_argument("output")
    parser.add_argument("--declaration", help="also write the array Scrollcase's scroll consumes")
    parser.add_argument("--cache", default=os.path.expanduser("~/.cache/liatir-pypi-licenses"))
    parser.add_argument("--reviewed-at", required=True, help="ISO date of this review")
    arguments = parser.parse_args()

    os.makedirs(arguments.cache, exist_ok=True)
    lock_bytes = open(arguments.lock, "rb").read()
    target_id = os.path.basename(os.path.dirname(os.path.abspath(arguments.lock)))
    packages = [entry for entry in
                (inventory_entry(item, arguments.cache) for item in lock_pypi_entries(arguments.lock))
                if entry is not None]
    packages.sort(key=lambda item: (item["name"], item["version"]))

    if unreviewed:
        print(f"{len(unreviewed)} distribution(s) declare a licence this project has not reviewed.",
              file=sys.stderr)
        for item in sorted(unreviewed, key=lambda entry: entry["name"]):
            print(f"  {item['name']}=={item['version']}", file=sys.stderr)
            print(f"      declared:    {item['declaredText']!r}", file=sys.stderr)
            print(f"      classifiers: {item['classifiers']}", file=sys.stderr)
            print(f"      from:        {item['distribution']}", file=sys.stderr)
        sys.exit("Review each one and record it in REVIEWED_SPDX, SPDX_FROM_DECLARED "
                 "or FROM_BUNDLED_TEXT before this lock can be inventoried.")

    document = {
        "schemaVersion": 1,
        "kind": "liatir.runtime-box.pypi-dependency-license-inventory",
        "targetId": target_id,
        "dependencyLockSha256": hashlib.sha256(lock_bytes).hexdigest(),
        "reviewedAt": arguments.reviewed_at,
        "packages": packages,
    }
    with open(arguments.output, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(document, indent=2) + "\n")

    if arguments.declaration:
        declaration = [{"name": package["name"], "version": package["version"],
                        "declaredLicense": package["declaredLicense"]} for package in packages]
        with open(arguments.declaration, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(json.dumps(declaration, indent=2) + "\n")
        print(f"{len(declaration)} declared licences -> {arguments.declaration}")

    counts = {}
    for package in packages:
        counts[package["declaredLicense"]] = counts.get(package["declaredLicense"], 0) + 1
    print(f"{len(packages)} PyPI distributions -> {arguments.output}")
    for license_id, count in sorted(counts.items(), key=lambda item: (-item[1], item[0])):
        print(f"  {count:3d}  {license_id}")


if __name__ == "__main__":
    main()
