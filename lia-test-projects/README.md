# Liatir .lia Test Projects

Small internal projects used to validate `.lia` plugin development against the
desktop app.

These are intentionally not packages in the main workspace. They are disposable
test fixtures for checking the two supported plugin runtimes:

- `node-hello`: TypeScript/Node plugin using `@liatir/sdk`
- `wasm-length`: Rust plugin compiled to `wasm32-wasip1`

## Node plugin

```sh
cd lia-test-projects/node-hello
npm install
npm run build
```

Import `node-hello.lia` from the Liatir Plugins page.

For watch mode against a running Liatir app:

```sh
npm run dev -- --input '{"text":"hello","repeat":2}'
```

## WASM plugin

```sh
cd lia-test-projects/wasm-length
rustup target add wasm32-wasip1
npx lia build
```

Import `wasm-length.lia` from the Liatir Plugins page.

## Notes

Node plugins should declare their input/output contract once with
`defineModule(...)`. The SDK infers the TypeScript input and output types from
that schema, and `lia build` generates the `.lia` manifest from the same source.
The required shape is `defineModule({ inputs, outputs }).main(...)`: the
contract stays inside `defineModule`, and the implementation body stays inside
the SDK-controlled `.main(...)` entry point.
