# Protenix ships as base v1.0.0, and v2 waits on ByteDance

Taken 2026-09-12, after establishing that the v2 checkpoint is closed deliberately rather than
broken.

## Decision

Liatir's Protenix component is **`protenix_base_default_v1.0.0`**, the largest publicly available
Protenix checkpoint. **`protenix-v2` stays `planned` and unbuilt** until ByteDance makes its file
public; it is not cancelled, and nothing about it is worked around.

The two are **separate component identities**. v2 is not quietly re-pointed at v1.0.0's weights:
they are different models, and a box that claimed one while shipping the other would be a lie told
by a signature.

## Why v2 cannot be used

It is withheld on purpose, and upstream said so. Collaborator `@zhangyuxuann` replied on two issues
on 2026-04-09 that "the accessibility of the protenix-v2 checkpoint is currently under review as part
of our company-level internal evaluation process", with no timeline. Five months later four issues
remain open and nothing has changed.

The restriction is surgical, which is what rules out an outage: of the **19 URLs upstream publishes,
18 serve and exactly one does not**. Every other Protenix checkpoint — base, mini, tiny, v0.5.0 and
v1.0.0 alike — and the ESM2 3B weights all answer a ranged request with 206. Only
`checkpoint/protenix-v2.pt` returns `AccessDenied`.

**There is no older copy to fall back on.** Across every revision of `dependency_url.py` in the
project's history there have only ever been those same 19 addresses, so v2 never had a second URL.
Eight plausible alternative spellings of the filename all return **404** — nothing exists under them
— while the real one returns **403**. That difference is the proof: the object is present and
closed, not missing. The URL on `main` today is byte-identical to the one at the reviewed commit, so
nothing was moved either.

**The community mirror is rejected on its uploader's own word.** A Hugging Face copy circulates in
the upstream issue thread. Its owner commented there that they have "no affiliation with the
Protenix team", and when asked directly how they obtained the weights, did not answer. Signing that
into a Liatir box would assert a provenance we cannot demonstrate, for a file the publisher
deliberately withheld.

## Why base v1.0.0 rather than Mini

Protenix earns its place next to Boltz-2 as an **independent second opinion** on a prediction —
a different method, a different training pipeline, a different team. A second opinion is worth
having in proportion to how good it is, so it should be the strongest public model, not the fastest.

| | Parameters | Recycles | Diffusion steps | Checkpoint |
| --- | ---: | ---: | ---: | ---: |
| `protenix-v2` (closed) | 464 M | 10 | 200 | — |
| **`protenix_base_default_v1.0.0`** | **368 M** | **10** | **200** | **1,407 MB** |
| `protenix_mini_default_v0.5.0` | 134 M | 4 | 5 | 512 MB |

base v1.0.0 is v2's immediate predecessor, released 2026-02, and carries the same inference settings.
Mini is a screening tool at a quarter the size and a fortieth of the diffusion work; useful, and not
a peer of Boltz-2.

The dependency work already done transfers whole: same `protenix==2.0.0` package, same resolved
environment, same reviewed licences. Only the checkpoint asset and the model name change.

## What this costs, stated plainly

**Upstream publishes no accuracy comparison between v2 and v1.0.0.** Their supported-models guide describes
v2 as "an enhanced-capacity version of the base model, featuring increased representation
dimensionality" and gives no benchmark against its predecessor. So the honest statement of what we
give up is structural, not numerical: a model from the same family with about 20 % fewer parameters,
six months older. Anyone who wants that quantified has to measure it, and cannot today, because the
model to measure against is the one we cannot obtain.

## What was rejected

**Re-pointing the v2 component at v1.0.0's weights.** It would have saved a component identity and
made the catalog look complete. It would also mean a signed box saying `protenix-v2` while carrying
something else, which is precisely the claim a signature exists to make trustworthy.

**Using the Hugging Face mirror.** Covered above: no stated provenance, and an uploader who
disclaims affiliation.

**Shipping Mini instead and calling Protenix done.** Mini is fine and will likely follow, but
answering "we have a second structure model" with a 134 M-parameter screening model next to a
validated Boltz-2 would oversell it.

**Waiting for v2.** Five months of no movement, no timeline, and a company-internal process we have
no visibility into. Waiting is not a plan; v2 stays `planned` so it can be picked up the day the
file opens.

## Related

- [Protenix source review](../state/roadmap/phase3-protenix-source-review.md) — the failing
  requests, the issue thread, and the asset hashes.
- [Protenix resolves through PyPI](./protenix-resolves-through-pypi.md) — why this component takes
  its scientific stack from PyPI rather than conda-forge.
