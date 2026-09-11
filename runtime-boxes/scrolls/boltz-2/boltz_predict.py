"""Liatir's entry point into the unmodified Boltz CLI.

Boltz's `predict` command calls `download_boltz2(cache)` unconditionally, and that function fetches
`mols.tar` from the network whenever the archive is absent — which it always is inside a box, since
the dictionary is expanded at build time and carrying the 1.86 GB original a second time would
double the payload for nothing. Left alone it would either reach the network from an offline box or
fail with a download error that says nothing about what is actually wrong.

Replacing that one function with a check over the bundled cache is the entire difference between
this entry point and `boltz`. Argument parsing, prediction and output all belong to the unmodified
package, so a Boltz release changes behaviour here exactly as much as it changes it upstream.
"""

import os
from pathlib import Path
import sys

# Set before Boltz is imported, because these clients read their configuration at import time, and
# assigned rather than defaulted: an offline signed box makes a promise that an inherited
# `WANDB_MODE=online` must not be able to take back. Boltz hard-requires `wandb` and `sentry-sdk` —
# a training-telemetry stack and an error reporter — and neither has any business in a scientific
# run. The product runner also denies the process network access; this is the half that keeps them
# quiet rather than merely blocked.
os.environ["WANDB_MODE"] = "disabled"
os.environ["WANDB_DISABLED"] = "true"
os.environ["WANDB_SILENT"] = "true"
os.environ["SENTRY_DSN"] = ""
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

import boltz.main


REQUIRED = (
    ("boltz2_conf.ckpt", "the structure model"),
    ("boltz2_aff.ckpt", "the affinity model"),
    ("mols", "the molecule dictionary"),
)


def validate_bundled_cache(cache: Path) -> None:
    """Stands in for `download_boltz2`: the box already carries everything it would fetch."""
    missing = [f"{name} ({what})" for name, what in REQUIRED if not (Path(cache) / name).exists()]
    if missing:
        raise SystemExit(
            "This Runtime Box is incomplete: " + ", ".join(missing) + f" is missing from {cache}. "
            "Reinstall the model rather than letting Boltz download it, which would leave the box "
            "carrying assets nobody signed."
        )


def refuse_boltz1(_cache: Path) -> None:
    """`--model boltz1` reaches a second downloader, and this box carries no Boltz-1 weights."""
    raise SystemExit(
        "This Runtime Box contains Boltz-2 only. Boltz-1 has its own weights, its own licence "
        "review and its own evidence, and none of them are in here."
    )


boltz.main.download_boltz2 = validate_bundled_cache
boltz.main.download_boltz1 = refuse_boltz1


if __name__ == "__main__":
    sys.exit(boltz.main.cli())
