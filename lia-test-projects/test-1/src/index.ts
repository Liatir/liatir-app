import { defineModule, field, type ModuleContext } from "@liatir/sdk";

// Docs: https://liatir.com/docs/plugins
const liatirModule = defineModule({
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

export default liatirModule.main(async ({ input, lia }: ModuleContext<typeof liatirModule>) => {
  // Write your plugin logic here. Inputs and outputs are defined once above.
  // void lia;

  return {
    length: input.text.length,
  };
});
