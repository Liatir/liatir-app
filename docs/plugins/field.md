---
title: Declaring plugin fields
description: Field builders for .lia plugin input and output schemas, in Node, Python, R, Native, and WASM.
---

# Declaring plugin fields

`field` contains the builders for declaring plugin inputs and outputs. The
field types are shared across all five runtimes; builder syntax follows the language.

The declared schema is used in three places:

- static typing for `input` and returned output objects (Node);
- generated `manifest.json` during `liatir build`;
- Liatir UI forms and pipeline ports after import.

## Import

<Tabs>
<Tab title="Node">

```ts
import { field, output } from "@liatir/api";
```

</Tab>
<Tab title="Python">

```python
from liatir import field
```

</Tab>
<Tab title="R">

```r
source("liatir.R")
```

</Tab>
<Tab title="Native/WASM">

::: info
Native/WASM Plugins can use any compatible language; Rust and C++ are examples.
WASM targets must support WASI Preview 1 and remain isolated from the app bridge.
:::

<Tabs>
<Tab title="Rust">

```rust
use liatir::field;
```

</Tab>
<Tab title="C++">

```cpp
#include <nlohmann/json.hpp>
using json = nlohmann::json;
```

</Tab>
</Tabs>
</Tab>
</Tabs>

> <small>
>
> In Node, `field.*` is the normal builder set and `output.file(...)` types
> returned file values correctly. Python, R and Rust use
> [CLI-managed SDK files](/plugins/api-packages) supplied by `liatir init`
> and refreshed by `liatir build` (no separate SDK install).
>
> </small>

## Input field types

Inputs support:

| Builder | JSON value | Notes |
| --- | --- | --- |
| `field.string(...)` | `string` | Text input. |
| `field.number(...)` | `number` | Numeric input. |
| `field.boolean(...)` | `boolean` | Toggle input. |
| `field.file(...)` | `string` | Local file path selected in Liatir. |

Builder names in the tables use Node/Python spelling; R uses `field$string`,
`field$number`, etc., and Rust uses `field::string()`, `field::number()`, etc.

<Tabs>
<Tab title="Node">

```ts
inputs: {
  fastq: field.file({
    label: "FASTQ file",
    description: "Input reads.",
    required: true,
    accept: ["fastq", "fq", "fastq.gz", "fq.gz"],
  }),
}
```

</Tab>
<Tab title="Python">

```python
inputs={
    "fastq": field.file(
        label="FASTQ file",
        description="Input reads.",
        required=True,
        accept=["fastq", "fq", "fastq.gz", "fq.gz"],
    ),
}
```

</Tab>
<Tab title="R">

```r
inputs = list(
  fastq = field$file(
    label = "FASTQ file", description = "Input reads.", required = TRUE,
    accept = c("fastq", "fq", "fastq.gz", "fq.gz")
  )
)
```

</Tab>
<Tab title="Native/WASM">

::: info
Native/WASM Plugins can use any compatible language; Rust and C++ are examples.
WASM targets must support WASI Preview 1 and remain isolated from the app bridge.
:::

<Tabs>
<Tab title="Rust">

```rust
.input("fastq", field::file()
    .label("FASTQ file")
    .description("Input reads.")
    .required(true)
    .accept(&["fastq", "fq", "fastq.gz", "fq.gz"]))
```

</Tab>
<Tab title="C++">

```cpp
json inputs = {{"fastq", {
    {"type", "file"}, {"label", "FASTQ file"}, {"description", "Input reads."},
    {"required", true}, {"accept", {"fastq", "fq", "fastq.gz", "fq.gz"}}
}}};
// Emit inputs in the version 1 contract; validate file input values as strings.
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Output field types

Outputs support:

| Builder | JSON value | Notes |
| --- | --- | --- |
| `field.string(...)` | `string` | Text output. |
| `field.number(...)` | `number` | Numeric output. |
| `field.boolean(...)` | `boolean` | Boolean output. |
| `output.file(...)` (Node), `field.file(...)` (Python), `field$file(...)` (R), `field::file()` (Rust) | file value | Existing path or content to save. |
| `field.json(...)` | JSON value | Structured JSON output. |
| `field.stats(...)` | object | Structured Liatir result output. |

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

The common options below have equivalents in every supplied SDK. In Node they are
passed in an options object (`field.string({ label, required })`); in Python as
keyword arguments (`field.string(label=..., required=True)`); in Rust as chained
methods (`field::string().label(...).required(true)`). Native Rust uses the same
methods; R uses named arguments (`field$string(label="Text", required=TRUE)`).
See [complete entry points](./define-plugin) for examples. Advanced field metadata
is part of the shared schema, but convenience methods differ by SDK; for example,
Rust exposes `.artifact(json!(...))` but has no `.options()` builder method.
C++ examples declare these same properties directly in JSON.

| Option | Rust method (Native / WASM) | Description |
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

<Tabs>
<Tab title="Node">

```ts
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

</Tab>
<Tab title="Python">

```python
# existing path
return {"report": "/absolute/path/to/report.csv"}

# content Liatir saves under Results
return {"report": {"content": "sample,score\nA,0.92\n", "fileName": "report.csv"}}

# binary content
return {"image": {"content": png_base64, "fileName": "plot.png", "base64": True}}
```

</Tab>
<Tab title="R">

```r
# existing path outside the temporary Job directory
list(report = list(path = report_path))

# content Liatir saves under Results
list(report = list(content = "sample,score\nA,0.92\n", fileName = "report.csv"))

# binary content (png_base64 is a base64 string)
list(image = list(content = png_base64, fileName = "plot.png", base64 = TRUE))
```

</Tab>
<Tab title="Native/WASM">

::: info
Native/WASM Plugins can use any compatible language; Rust and C++ are examples.
WASM targets must support WASI Preview 1 and remain isolated from the app bridge.
:::

<Tabs>
<Tab title="Rust">

```rust
// existing accessible path; sandbox paths only for WASM
Ok(json!({ "report": { "path": report_path } }))

// content Liatir saves under Results
Ok(json!({ "report": { "content": "sample,score\nA,0.92\n", "fileName": "report.csv" } }))

// binary content
Ok(json!({ "image": { "content": png_base64, "fileName": "plot.png", "base64": true } }))
```

</Tab>
<Tab title="C++">

```cpp
// Existing accessible path; sandbox paths only for WASM.
return json{{"report", {{"path", report_path}}}};

// Content Liatir saves under Results.
return json{{"report", {{"content", "sample,score\nA,0.92\n"}, {"fileName", "report.csv"}}}};

// Binary content.
return json{{"image", {{"content", png_base64}, {"fileName", "plot.png"}, {"base64", true}}}};
```

</Tab>
</Tabs>
</Tab>
</Tabs>

In R, use named lists for JSON objects and scalar values for text, numbers and
booleans. For JSON output arrays with one element, use a list such as `list(1)`
to preserve the array shape. `json` and `stats` are output types, not input types.

R and Native working directories are temporary and are deleted when their Job
terminates. Return inline content, as above, or an absolute path in persistent
bridge-managed storage. A path inside that temporary directory will no longer
exist when Results are saved. In WASM, use paths accessible through the sandbox's
mounts; arbitrary host paths are unavailable.
