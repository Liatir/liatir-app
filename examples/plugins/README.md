# R and Native Plugins

Build either project using the local CLI after `npm run build --prefix packages/liatir-cli`:

```sh
cd examples/plugins/native-file-summary
node ../../../packages/liatir-cli/dist/cli.js build
```

`liatir build` supplies the managed SDK. Import the resulting `.lia` in Plugins.
Allow executable access before running the Native example. It counts UTF-8 text
lines and words and returns a JSON file through the ordinary Results contract.

The R example requires R >= 4.1. Its first build resolves `bioc::limma` and writes
`renv.lock`; keep that file with the Plugin project. Later builds and app preparation
restore those exact package versions. Installed Plugins run offline after preparation.
The first column of the input CSV is a unique gene identifier; the other columns
contain normalized log2 expression, with at least two `control_*` and two
`treatment_*` samples. These are already transformed expression measurements,
not raw counts. Results include limma's moderated statistics and BH-adjusted
p-values; biological interpretation still depends on the experiment and its design.
