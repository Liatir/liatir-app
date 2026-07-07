// Docs: https://liatir.com/docs/plugins

import { definePlugin, field, tools, type PluginContext } from "@liatir/api";

// This is just an example. Edit inputs and outputs definitions and the plugin logic to implement your solutions.

const liatirPlugin = definePlugin({
  inputs: {},
  outputs: {
    res: field.json({
      label: "Result"
    }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {

  // Write the plugin logic here
  await Liatir.progress.start(100);
  await Liatir.log.debug("Start");

  let n = 100;

  do {
    await Liatir.progress.advance(1);
    n--;
  } while (n>0 && n<=100);

  await Liatir.progress.done();

  const res = JSON.stringify({});

  return {
    res,
  };
});
