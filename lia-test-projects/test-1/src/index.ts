// Docs: https://liatir.com/docs/plugins

import { createLiatir, definePlugin, field, type PluginContext } from "@liatir/api";
import { window } from "@tauri-apps/api";

// This is just an example. Edit inputs and outputs definitions and the plugin logic to implement your solutions.

const liatirPlugin = definePlugin({
  inputs: {
    inputValue: field.string({
      label: "Input Value"
    })
  },
  outputs: {
    x: field.json({
      label: "Result",
    }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {

  // Write the plugin logic here

  const x: string = JSON.stringify(await Liatir);


  return {
    x,
  };
});
