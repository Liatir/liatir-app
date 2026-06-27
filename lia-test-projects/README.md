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

`lia dev` currently uses an older development runner shape than `lia build`.
The Node test module exports both a default `defineModule(...)` module and a
named `run(...)` function so it can exercise both paths while the CLI dev flow
is being finalized.
