import { defineModule, field } from "@liatir/sdk";

type Input = {
  text?: string;
  repeat?: number;
};

export async function run(input: Input = {}) {
  const text = input.text ?? "hello from node";
  const repeat = Math.max(1, Math.trunc(Number(input.repeat ?? 1)));
  const message = Array.from({ length: repeat }, () => text).join(" ");

  return {
    message,
    length: message.length,
  };
}

export default defineModule({
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
  async run({ input }) {
    return run(input);
  },
});
