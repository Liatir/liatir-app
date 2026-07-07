---
title: sidecar
description: Run binaries bundled with the Liatir app.
---

# .sidecar

`Liatir.sidecar.run()` executes a binary that is bundled with the Liatir desktop
app and captures its stdout, stderr, and exit code.

Use this to run bioinformatics tools (samtools, minimap2, bwa, bcftools, etc.)
without requiring the user to install them separately.

## Signature

<Tabs>
<Tab title="Node">

```ts
run(name: string, args: string[]): Promise<SidecarResult>
```

</Tab>
<Tab title="Python">

```python
run(name, args=None) -> dict
```

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const result = await Liatir.sidecar.run('samtools', ['--version']);

if (result.ok) {
  console.log(result.stdout);
} else {
  console.error('Exit code:', result.exitCode);
  console.error(result.stderr);
}
```

</Tab>
<Tab title="Python">

```python
result = ctx.liatir.sidecar.run('samtools', ['--version'])

if result['ok']:
    print(result['stdout'])
else:
    print('Exit code:', result['exitCode'])
    print(result['stderr'])
```

</Tab>
</Tabs>

## SidecarResult

| Field        | Type            | Description                              |
|--------------|-----------------|------------------------------------------|
| `ok`         | `boolean` / `bool` | `true` if the process exited with code 0. |
| `stdout`     | `string` / `str`   | Captured standard output.                |
| `stderr`     | `string` / `str`   | Captured standard error.                 |
| `exitCode`   | `number \| null` / `int \| None` | Process exit code.       |
| `error`      | `string \| null` / `str \| None` | Error message if the process failed. |
| `durationMs` | `number` / `int`   | Execution time in milliseconds.          |

::: warning NOTE
`SidecarResult` fields are always camelCase in both Node and Python, because they
come from the JSON response of the Liatir bridge.
:::

## Available binaries

The following binaries are bundled with Liatir and can be invoked via sidecar:

| Binary     | Description                        |
|------------|------------------------------------|
| `samtools` | SAM/BAM processing                 |
| `minimap2` | Long-read alignment                |
| `bwa`      | Short-read alignment               |
| `bcftools` | VCF/BCF manipulation               |
| `fastp`    | FASTQ preprocessing                |
| `seqkit`   | FASTA/FASTQ toolkit                |
| `snpeff`   | Variant annotation                 |

## Notes

:::tip
Sidecar binaries run in a sandboxed environment. They cannot access arbitrary
paths on the host filesystem — use the plugin filesystem (`.desktop.fs.pluginFs` / `.desktop.fs.plugin_fs`)
to stage input files and read output files.
:::

:::warning
The list of available sidecar binaries depends on the Liatir app version.
Always check `result.ok` / `result['ok']` and handle errors gracefully.
:::