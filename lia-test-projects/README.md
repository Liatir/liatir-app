# Liatir .lia Test Projects

Small internal projects used to validate `.lia` module development against the
desktop app.

These are intentionally not packages in the main workspace. They are disposable
test fixtures for checking the two supported module runtimes:

- `node-hello`: TypeScript/Node module using `@liatir/sdk`
- `wasm-length`: Rust module compiled to `wasm32-wasip1`

## Node module

```sh
cd lia-test-projects/node-hello
npm install
npm run build
```

Import `node-hello.lia` from the Liatir Modules page.

For watch mode against a running Liatir app:

```sh
npm run dev -- --input '{"text":"hello","repeat":2}'
```

## WASM module

```sh
cd lia-test-projects/wasm-length
rustup target add wasm32-wasip1
npx lia build
```

Import `wasm-length.lia` from the Liatir Modules page.

## Notes

Node modules should declare their input/output contract once with
`defineModule(...)`. The SDK infers the TypeScript input and output types from
that schema, and `lia build` generates the `.lia` manifest from the same source.
The required shape is `defineModule({ inputs, outputs }).main(...)`: the
contract stays inside `defineModule`, and the implementation body stays inside
the SDK-controlled `.main(...)` entry point.
