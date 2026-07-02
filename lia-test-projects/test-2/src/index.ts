import { definePlugin, field, type PluginContext } from "@liatir/sdk";

// Docs: https://liatir.com/docs/plugins
const liatirPlugin = definePlugin({
  inputs: {
    text: field.string({
      label: "Text",
      description: "Text to analyze.",
      required: true,
      default: "hello from Liatir",
    }),
  },
  outputs: {
    length: field.number({
      label: "Length",
      description: "Number of characters in the input text.",
      format: "integer",
    }),
  },
});

export default liatirPlugin.main(async ({ input }: PluginContext<typeof liatirPlugin>) => {
  return {
    length: input.text.length,
  };
});
