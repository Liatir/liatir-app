import { definePlugin, field } from "@liatir/sdk";

export default definePlugin({
  inputs: {
    text: field.string({
      label: "Text",
      required: true,
      default: "hello from node",
    }),
    repeat: field.number({
      label: "Repeat",
      default: 1,
    }),
  },
  outputs: {
    message: field.string({ label: "Message" }),
    length: field.number({ label: "Length" }),
  },
}).main(async ({ input }) => {
  const repeat = Math.max(1, Math.trunc(Number(input.repeat ?? 1)));
  const message = Array.from({ length: repeat }, () => input.text).join(" ");

  return {
    message,
    length: message.length,
  };
});
