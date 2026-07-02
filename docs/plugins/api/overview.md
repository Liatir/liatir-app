---
title: Liatir API
description: Comprehensive overview of the Liatir API, its lifecycle, usage, and platform specifics.
---


# Liatir API

This is the API used by code running inside the Liatir local environment.

For an introduction to installing and using the SDK, start with
[Liatir SDK](/plugins/sdk). This section is the API reference: it is organized
by namespace and then by API area or method.

Prefer typed namespaces such as `desktop`, `jobs`, `deps`, and `qc`. Use the
root-level `invoke()` escape hatch only when no typed wrapper exists.

## Namespaces

- [Plugin authoring API](/plugins/api/plugin/define-plugin)
- [Root API](/plugins/api/root/overview)
- [Desktop API](/plugins/api/desktop/app)
- [Plugins API](/plugins/api/plugins/call)
- [Pipeline API](/plugins/api/pipeline/run)
- [Jobs API](/plugins/api/jobs/spawn)
- [Dependencies API](/plugins/api/deps/check)
- [QC API](/plugins/api/qc/fastqc)

## Plugin authoring API

- [definePlugin](/plugins/api/plugin/define-plugin)
- [field](/plugins/api/plugin/field)
- [PluginContext](/plugins/api/plugin/plugin-context)
- [lia context](/plugins/api/plugin/lia-context)

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

## Plugins API

- [call](/plugins/api/plugins/call)
- [status](/plugins/api/plugins/status)
- [list](/plugins/api/plugins/list)
- [add](/plugins/api/plugins/add)
- [addFromBytes](/plugins/api/plugins/add-from-bytes)
- [remove](/plugins/api/plugins/remove)
- [killJobs](/plugins/api/plugins/kill-jobs)

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

## QC API

- [fastqc](/plugins/api/qc/fastqc)
