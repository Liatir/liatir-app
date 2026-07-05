---
title: Liatir API
description: Comprehensive overview of the Liatir API, its lifecycle, usage, and platform specifics.
---


# Liatir API

This is the API used by code running inside the Liatir local environment.

For an introduction to installing and using the API packages, start with
[Liatir API packages](/plugins/api-packages). This section is the API reference: it is organized
by namespace and then by API area or method.

Prefer typed namespaces such as `desktop`, `jobs`, `deps`, and `qc`. Use the
root-level `invoke()` escape hatch only when no typed wrapper exists.

## Namespaces

- [Plugin authoring API](/plugins/api/plugin/define-plugin)
- [Root API](/plugins/api/root/overview)
- [Desktop API](/plugins/api/desktop/app)
- [Pipeline API](/plugins/api/pipeline/run)
- [Jobs API](/plugins/api/jobs/spawn)
- [Dependencies API](/plugins/api/deps/check)
- [Bio: QC API](/plugins/api/qc/fastqc)
- [Bio: Alignment API](/plugins/api/align/bwa-mem)
- [Bio: Variants API](/plugins/api/variants/bcftools-stats)

## Root API

- [Overview](/plugins/api/root/overview)
- [openBrowser](/plugins/api/root/open-browser)
- [invoke](/plugins/api/root/invoke)

## Desktop API areas

- [App](/plugins/api/desktop/app)
- [Files](/plugins/api/desktop/files)
- [File system](/plugins/api/desktop/file-system)
- [Window](/plugins/api/desktop/window)
- [Events](/plugins/api/desktop/events)
- [Clipboard](/plugins/api/desktop/clipboard)
- [Notifications](/plugins/api/desktop/notifications)
- [Network](/plugins/api/desktop/network)
- [Shortcuts](/plugins/api/desktop/shortcuts)
- [Drag and drop](/plugins/api/desktop/drag-and-drop)
- [Deep links](/plugins/api/desktop/deep-links)
- [Utilities](/plugins/api/desktop/utilities)

## Pipeline API

- [run](/plugins/api/pipeline/run)

## Jobs API

- [spawn](/plugins/api/jobs/spawn)
- [status](/plugins/api/jobs/status)
- [list](/plugins/api/jobs/list)
- [kill](/plugins/api/jobs/kill)
- [clearDone](/plugins/api/jobs/clear-done)

## Dependencies API

- [check](/plugins/api/deps/check)
- [checkMany](/plugins/api/deps/check-many)

## Bio: QC API

- [seqkit](/plugins/api/qc/seqkit)
- [fastp](/plugins/api/qc/fastp)
- [fastqc](/plugins/api/qc/fastqc)

## Bio: Alignment API

- [bwaMem](/plugins/api/align/bwa-mem)
- [minimap2](/plugins/api/align/minimap2)

## Bio: Variants API

- [bcftoolsStats](/plugins/api/variants/bcftools-stats)
- [snpeff](/plugins/api/variants/snpeff)
