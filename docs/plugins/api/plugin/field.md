---
title: field
description: Field builders for Node .lia plugin input and output schemas.
---

# field

`field` contains builders for declaring plugin inputs and outputs.

The schema is used in three places:

- TypeScript inference for `input` and returned output objects;
- generated `manifest.json` during `lia build`;
- Liatir UI forms and pipeline ports after import.

## Import

```ts
import { field, output } from "@liatir/sdk";
```

`field.*` is the normal builder set. `output.file(...)` is useful for file
outputs because it types returned file values correctly.

## Input field types

Inputs support:

| Builder | TypeScript value | Notes |
| --- | --- | --- |
| `field.string(...)` | `string` | Text input. |
| `field.number(...)` | `number` | Numeric input. |
| `field.boolean(...)` | `boolean` | Toggle input. |
| `field.file(...)` | `string` | Local file path selected in Liatir. |

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

| Option | Description |
| --- | --- |
| `label` | Human-readable field label. |
| `description` | Short explanation shown in the UI. |
| `required` | Whether the input must be filled before running. |
| `default` | Default value. |
| `accept` | Accepted extensions for file inputs. |
| `ext` | Expected extensions for file outputs. |
| `format` | Numeric output display hint: `integer`, `decimal`, `percent`, or `bytes`. |

## File output values

A file output can return an existing path:

```ts
return {
  report: "/absolute/path/to/report.csv",
};
```

Or content that Liatir should persist under workspace Results:

```ts
return {
  report: {
    content: "sample,score\nA,0.92\n",
    fileName: "report.csv",
  },
};
```

For binary content, return base64:

```ts
return {
  image: {
    content: pngBase64,
    fileName: "plot.png",
    base64: true,
  },
};
```

