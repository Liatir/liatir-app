# Liatir SDK

Public developer-facing packages for building, validating, and packaging Liatir plugins.

Liatir is a free desktop app that runs bioinformatics tools, AI models, custom plugins, and pipelines locally. It keeps data on the user's machine while providing native performance, including with multi-gigabyte files.

> This repository is automatically mirrored from Liatir's private development monorepo.
> Do not push directly to this repository. Changes should be made in the source monorepo and mirrored here automatically.

## Packages

This repository contains three public npm packages.

### `@liatir/core`

Core public types, shared contracts, metadata definitions, and model catalog utilities used across the Liatir SDK.

Use this package when you need the base type system and shared structures used by Liatir-compatible tools, plugins, outputs, and AI model metadata.

```bash
npm install @liatir/core
```

### `@liatir/api`

TypeScript API and shared public contracts for building Liatir-compatible plugins.

Use this package for plugin manifests, typed inputs and outputs, metadata definitions, result contracts, and other public interfaces used by Liatir.

```bash
npm install @liatir/api
```

### `@liatir/cli`

Command-line tools for developing, validating, and packaging Liatir plugins.

```bash
npm install -g @liatir/cli
```

Or run it directly with:

```bash
npx @liatir/cli
```

## Repository structure

```txt
packages/
  liatir-core/
  liatir-api/
  liatir-cli/
```

## Development

Install dependencies:

```bash
npm install
```

Build all packages:

```bash
npm run build
```

Build a single package:

```bash
npm run build --workspace packages/liatir-core
npm run build --workspace packages/liatir-api
npm run build --workspace packages/liatir-cli
```

Run type checks:

```bash
npm run typecheck
```

## Publishing

The packages are published separately on npm:

```bash
npm publish --workspace packages/liatir-core --access public
npm publish --workspace packages/liatir-api --access public
npm publish --workspace packages/liatir-cli --access public
```

## Contributing

This repository is a public mirror. Direct commits to this repository may be overwritten by the next automated sync.

If you want to contribute, open an issue or pull request here first. Accepted changes will be applied to the private source monorepo and then mirrored back to this repository.

## License

MIT