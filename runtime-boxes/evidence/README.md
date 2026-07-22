# Runtime Box evidence records

GitHub Actions keeps complete Runtime Box evidence as small JSON artifacts for
7 days. It never uploads model weights, archives, extracted runtimes, private
keys, tokens, or raw scientific outputs.

After a production release has been reviewed, copy only its compact
`liatir.runtime-box.ci-evidence` JSON record into this directory in a normal
reviewed commit and point the target's `publication.evidenceRecord` field in
`runtime-boxes/catalog.json` at it. CI deliberately has no `contents: write`
permission and cannot accept its own evidence.

Use one immutable path per publication. The current flat paths use this form:

```text
runtime-boxes/evidence/<box-id>-<target-id>-<version>.json
```

When the same version and target are published again after a reviewed
revalidation, append `-run-<workflow-run-id>` before `.json`. Never overwrite
an earlier reviewed evidence record.

`npm run runtime-box:catalog:check` validates every referenced record against
the shared contract in `packages/liatir-core/src/runtime-box.ts`, its exact
model/target identity, and its successful protected-publication status.

Legacy operator publications may remain summarized directly in the catalog;
they must not invent GitHub workflow or approver metadata.

The reviewed target matrix, production topology, and operational ownership are
summarized in the internal
[Runtime Box production report](../../internal-docs/roadmap/runtime-box-production-report.md).
