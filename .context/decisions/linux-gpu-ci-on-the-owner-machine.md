# Linux GPU CI runs on the owner's WSL2 machine

Taken 2026-09-10, when the project acquired its first machine able to run a CUDA Runtime Box.

## Decision

The owner's Windows machine, through its WSL2 Ubuntu distribution, is the project's Linux
self-hosted runner. It carries both self-hosted Linux labels: `liatir-linux-cuda-selfhosted` and
`liatir-linux-selfhosted`.

The owner has authorized these runs **standing, without per-run permission**. This replaces the
earlier rule that every GPU CI run needed a separate explicit authorization, for this machine only.

Two OpenMM targets are therefore switched to `nativeCiEnabled: true` in
`runtime-boxes/catalog.json`:

- `openmm-openmm/linux-x86_64-cpu`
- `openmm-openmm/linux-x86_64-cuda12.9`

`openmm-openmm/macos-aarch64-cpu` stays disabled: it needs a macOS runner, which is a hosted, paid
resource and a separate decision.

A run is started by hand, in two halves that must overlap:

1. `bash scripts/run-runtime-box-selfhosted-runner.sh --model openmm-openmm --target <target>
   --mode <mode> --runner-root /home/<user>/liatir-runner`, inside WSL2, from the Linux filesystem.
2. `gh workflow run runtime-box-openmm.yml --ref main -f target_id=<target> -f mode=<mode>`.

The runner is **ephemeral**: it registers, takes exactly one job, deregisters, and deletes its work
root. There is no standing connection to GitHub, and nothing is left running between jobs.

## Why

Every remaining Phase 3 component — OpenMM's GPU target, Boltz-2, both Protenix variants — is a
Linux CUDA payload. Until today the project had no machine that could build or measure one, so those
targets could not leave `planned` no matter how complete their sources were. Hosted GPU runners were
the only alternative and cost real money per minute.

The standing authorization exists because the cost objection does not apply here: the electricity is
the owner's, the GPU is idle otherwise, and asking before each of a long series of build-and-measure
runs converts a mechanical step into a conversation. The paid-runner rule in `AGENTS.md` is
unchanged for every runner that is not this machine.

Both Linux targets are enabled together rather than one at a time because they share one recipe
family, one validator and one runner host; enabling only the GPU one would leave the CPU target —
which serves every WSL2 user without an NVIDIA card — permanently unbuilt for no reason.

## What was rejected

**Registering a persistent, always-on runner.** It would idle against GitHub indefinitely, accept
jobs nobody was watching, and keep a checkout and a multi-gigabyte conda prefix alive between runs.
The ephemeral launcher already existed and is strictly safer.

**Running the builds locally and hand-copying the artifacts.** That is what produced today's
evidence, and it is exactly what cannot be published: a local build is signed with a development key
and has no CI record tying it to committed bytes.

**Enabling `macos-aarch64-cpu` in the same change.** It is ready, but it runs somewhere else and on
someone else's meter. It is a publication decision, taken separately.

## Addendum 2026-09-13: the two structure models join it

`jwohlwend-boltz-2/linux-x86_64-cuda12.9` and `bytedance-protenix-base-v1-0-0/linux-x86_64-cuda12.6`
are added to the catalog with `nativeCiEnabled: true`, on the same runner labels and under the same
standing authorization. The authorization was given for this machine, and its stated reason was
precisely these payloads: they are Linux CUDA, both built and scientifically validated here, and
this is still the only host that can run them. Nothing else about the rule changes — runs stay
manual, ephemeral and started by hand in the two overlapping halves above.

Their catalog status is `scientifically-validated`, not `native-lifecycle-validated`: that step is
the product lifecycle in the real app, and it has to pass before the status may move.

## Related

- [Runtime Box publication runs on hosted CI](./runtime-box-publication-runs-on-hosted-ci.md)
- [No native Windows Runtime Box targets](./no-native-windows-runtime-box-targets.md)
- [How VRAM is measured](./vram-measurement-method.md)
