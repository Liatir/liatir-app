# No native Windows Runtime Box targets

Owner decision, 2026-09-09. It governs every Runtime Box target from now on, and it
supersedes the per-component Windows choices made before that date.

## Decision

**Windows is an application host, never a payload platform.** Liatir ships a native Windows
desktop app, but the scientific payloads it runs — AI Models and Tool Runtimes — are Linux
boxes executed inside WSL2. No *new* Runtime Box target may declare `platform: windows`.

Every component from now on is developed for **Linux x86_64 and Windows-through-WSL2**, which are
one signed payload and two host environments, plus **macOS where that is possible**. macOS is
worth having and is not owed: a component whose dependencies do not exist there — as Protenix's
Triton, DeepSpeed and cuEquivariance do not — simply has no macOS target, and that is not a gap
to be closed. Native Windows is never a target, whether or not it would be possible.

Windows support is therefore expressed on the Linux target, not beside it: the signed scroll's
`compatibility.hostEnvironments` and the catalog target's `hostEnvironments` both read
`["native", "windows-wsl2"]`, and the two must match exactly. One signed Linux payload serves
native Linux and Windows-through-WSL2, and each of those two host environments still needs its
own real product-lifecycle proof, because WSL2 exercises path translation, the slow
`/mnt/<drive>` boundary and GPU pass-through that a native Linux run never touches.

MHCflurry and pVACseq already worked this way; this decision makes it the rule rather than one
component's choice.

## Why

A native Windows payload is a second scientific platform, and it costs what a second platform
costs: its own conda solve, its own lock, its own licence audit, its own self-hosted Windows
runner, its own scientific validation and its own lifecycle evidence — permanently, for every
component and every release. The Linux box already has to exist. Running it under WSL2 gives
Windows users the same bytes that were scientifically validated on Linux, which is a stronger
guarantee than a separately-built Windows box that happens to pass the same fixtures.

It also removes a class of defect rather than fixing instances of it. The first one surfaced the
day before this decision: the OpenMM product script's `deny_network()` guard compares socket
families against `socket.AF_UNIX`, an attribute Python does not define on Windows, so the guard
would have raised `AttributeError` instead of refusing network access. Under this decision that
code only ever runs on macOS, Linux, or Linux inside WSL2, where the attribute exists — the
defect is unreachable and needs no fix. Every future POSIX assumption in a payload script is
disarmed the same way.

## What was rejected

**Keeping native Windows for GPU components.** The argument was that WSL2 adds a GPU
pass-through layer. It was rejected because pass-through is exactly what the WSL2 lifecycle proof
has to demonstrate once per component, whereas a native Windows target costs a full parallel
platform for every component, forever.

**Fixing `AF_UNIX` and keeping the targets.** That would have bought one defect's correction at
the price of retaining the platform that generates them.

## Scope applied on 2026-09-09

Four targets were `planned` — never built, never signed, never published — and were deleted
outright, along with their scrolls, `pixi.lock` files, licence audits, signer-policy entries and
workflow references:

| Component | Deleted target |
| --- | --- |
| `openvax-mhcflurry-class1-presentation` | `windows-x86_64-cpu` |
| `openvax-mhcflurry-class1-presentation` | `windows-x86_64-cuda12.8` |
| `openmm-openmm` | `windows-x86_64-cpu` |
| `openmm-openmm` | `windows-x86_64-cuda12.9` |

Three Linux targets gained `["native", "windows-wsl2"]` in both catalog and scroll, which is free
because all three are unbuilt: `openmm-openmm/linux-x86_64-cpu`,
`openmm-openmm/linux-x86_64-cuda12.9` and
`openvax-mhcflurry-class1-presentation/linux-x86_64-cuda12.9`.

`tests/unit/runtime-box-ci-catalog.test.ts` enforces both halves. One guard pins the exact list of
native Windows targets that remain; the other requires every `windows-wsl2` catalog claim to be
matched by its scroll's `compatibility.hostEnvironments`. Both were observed failing before being
accepted — the first would have reported seven entries against the previous catalog, and the
second was broken deliberately by dropping `hostEnvironments` from the OpenMM Linux CPU scroll,
which failed naming that exact target.

## The three published native Windows targets stay

Decided by the owner on 2026-09-09, in the same conversation: **they are left exactly as they are.**

| Component | Target | Published | Archive |
| --- | --- | --- | ---: |
| `ctheodoris-geneformer-v1-10m` | `windows-x86_64-cuda12.8` | 2026-08-09 | 4,310,849,517 B |
| `bowang-scgpt-whole-human` | `windows-x86_64-cpu` | 2026-08-10 | 584,473,168 B |
| `bowang-scgpt-whole-human` | `windows-x86_64-cuda12.8` | 2026-08-10 | 4,396,488,738 B |

They are signed with the production KMS key and already installable. Withdrawing them would take a
working box away from Geneformer and scGPT users on Windows and give nothing back until the
matching Linux targets were re-published carrying `windows-wsl2` — three new signed releases, for
no user-visible gain. The rule is forward-looking, not retroactive: it stops new native Windows
work, it does not undo shipped work.

So these three are permanent legacy. Their catalog entries, scrolls, signer-policy entries and
evidence records are deliberately untouched, and the guard in
`tests/unit/runtime-box-ci-catalog.test.ts` pins exactly this list — it exists to reject a fourth,
not to count down to zero.
