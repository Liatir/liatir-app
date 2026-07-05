---
title: field
description: Field builders for .lia plugin input and output schemas, in Node, Python, and WASM.
---

# field

`field` contains the builders for declaring plugin inputs and outputs. The
builder set is the same across the three runtimes; only the call syntax differs.

The declared schema is used in three places:

- static typing for `input` and returned output objects (Node);
- generated `manifest.json` during `liatir build`;
- Liatir UI forms and pipeline ports after import.

## Import

::: code-group

```ts [Node]
import { field, output } from "@liatir/api";
```

```python [Python]
from liatir import field
```

```rust [WASM]
use liatir::field;
```

:::

In Node, `field.*` is the normal builder set and `output.file(...)` types
returned file values correctly. In Python and WASM the `liatir` module is
scaffolded into your project by `liatir init` (no separate install).

## Input field types

Inputs support:

| Builder | TypeScript value | Notes |
| --- | --- | --- |
| `field.string(...)` | `string` | Text input. |
| `field.number(...)` | `number` | Numeric input. |
| `field.boolean(...)` | `boolean` | Toggle input. |
| `field.file(...)` | `string` | Local file path selected in Liatir. |

::: code-group

```ts [Node]
inputs: {
  fastq: field.file({
    label: "FASTQ file",
    description: "Input reads.",
    required: true,
    accept: ["fastq", "fq", "fastq.gz", "fq.gz"],
  }),
}
```

```python [Python]
inputs={
    "fastq": field.file(
        label="FASTQ file",
        description="Input reads.",
        required=True,
        accept=["fastq", "fq", "fastq.gz", "fq.gz"],
    ),
}
```

```rust [WASM]
.input("fastq", field::file()
    .label("FASTQ file")
    .description("Input reads.")
    .required(true)
    .accept(&["fastq", "fq", "fastq.gz", "fq.gz"]))
```

:::

## Output field types

Outputs support:

| Builder | TypeScript value | Notes |
| --- | --- | --- |
| `field.string(...)` | `string` | Text output. |
| `field.number(...)` | `number` | Numeric output. |
| `field.boolean(...)` | `boolean` | Boolean output. |
| `output.file(...)` | file value | Existing path or content to save. |
| `field.json(...)` | JSON value | Structured JSON output. |
| `field.stats(...)` | `ToolOutput` | Structured Liatir result output. |

```ts
outputs: {
  length: field.number({
    label: "Length",
    description: "Number of characters.",
    format: "integer",
  }),
}
```

## Shared options

Every builder takes the same options in all three runtimes. In Node they are
passed in an options object (`field.string({ label, required })`); in Python as
keyword arguments (`field.string(label=..., required=True)`); in WASM as chained
methods (`field::string().label(...).required(true)`).

| Option | WASM method | Description |
| --- | --- | --- |
| `label` | `.label(...)` | Human-readable field label. |
| `description` | `.description(...)` | Short explanation shown in the UI. |
| `required` | `.required(true)` | Whether the input must be filled before running. |
| `default` | `.default_value(...)` | Default value (must match the field type). |
| `accept` | `.accept(&[...])` | Accepted extensions for file inputs. |
| `ext` | `.ext(&[...])` | Expected extensions for file outputs. |
| `format` | `.format(...)` / `.integer()` | Numeric display hint: `integer`, `decimal`, `percent`, or `bytes`. |

A `default` that does not match its field type (for example a string default on
a `number` field) is rejected when the plugin is built.

## File output values

A `file` output can return an existing path, or content Liatir should persist
under workspace Results. The shape is the same in every runtime — a path string,
`{ path }`, or `{ content, fileName }` (with `base64: true` for binary content).

::: code-group

```ts [Node]
// existing path
return { report: "/absolute/path/to/report.csv" };

// content Liatir saves under Results
return {
  report: { content: "sample,score\nA,0.92\n", fileName: "report.csv" },
};

// binary content
return {
  image: { content: pngBase64, fileName: "plot.png", base64: true },
};
```

```python [Python]
# existing path
return {"report": "/absolute/path/to/report.csv"}

# content Liatir saves under Results
return {"report": {"content": "sample,score\nA,0.92\n", "fileName": "report.csv"}}

# binary content
return {"image": {"content": png_base64, "fileName": "plot.png", "base64": True}}
```

```rust [WASM]
// existing path
Ok(json!({ "report": "/absolute/path/to/report.csv" }))

// content Liatir saves under Results
Ok(json!({ "report": { "content": "sample,score\nA,0.92\n", "fileName": "report.csv" } }))

// binary content
Ok(json!({ "image": { "content": png_base64, "fileName": "plot.png", "base64": true } }))
```

:::

