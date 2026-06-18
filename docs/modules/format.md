# .lia Bundle Format

A `.lia` file is a ZIP archive with a specific internal structure. Rust validates the bundle before any content is extracted or executed.

## Archive contents

| File | Required | Description |
|------|----------|-------------|
| `_sig` | Yes | Text file containing exactly `LIATIR/1` |
| `manifest.json` | Yes | Module metadata and schema |
| `index.js` | Yes | ESM bundle (all dependencies inlined by esbuild) |

The `_sig` file is checked first. If its contents do not exactly equal `LIATIR/1`, the import is rejected immediately and no other files are read.

## manifest.json

```json
{
  "name": "my-module",
  "version": "1.0.0",
  "description": "What this module does",
  "inputSchema": {
    "reads": {
      "type": "file",
      "label": "Input FASTQ",
      "required": true,
      "accept": ".fastq,.fastq.gz"
    },
    "threshold": {
      "type": "number",
      "label": "Quality threshold",
      "default": 20
    }
  },
  "outputSchema": {
    "report": {
      "type": "stats",
      "label": "QC report"
    },
    "trimmed": {
      "type": "file",
      "label": "Trimmed reads",
      "ext": ".fastq.gz"
    }
  }
}
```

## InputFieldSchema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'string' \| 'number' \| 'boolean' \| 'file'` | Yes | Input data type |
| `label` | `string` | No | Human-readable label shown in the UI |
| `required` | `boolean` | No | Whether the field must be provided (default: `false`) |
| `default` | `string \| number \| boolean` | No | Default value pre-filled in the form |
| `accept` | `string` | No | Comma-separated file extensions (only for `type: 'file'`) |

## OutputFieldSchema

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `'file' \| 'stats' \| 'string' \| 'number'` | Yes | Output data type |
| `label` | `string` | No | Human-readable label shown in the results |
| `ext` | `string` | No | Expected file extension (only for `type: 'file'`) |
| `description` | `string` | No | Additional context shown below the result |

## index.js

The entry point must be an ESM module that exports a `run` function:

```typescript
export async function run(inputs: Record<string, unknown>): Promise<OutputType>
```

The `run` function receives inputs as a plain object keyed by the field names in `inputSchema`. It must write its result to stdout using the marker format:

```javascript
process.stdout.write(`__LIATIR_RESULT__${JSON.stringify(result)}\n`)
```

::: info All dependencies must be inlined
The bundle is executed directly; there is no `node_modules` directory. Use `liatir build` (which calls esbuild) to inline all imports into `index.js`.
:::
