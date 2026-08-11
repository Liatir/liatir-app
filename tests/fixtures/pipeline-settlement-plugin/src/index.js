// Keep this native E2E fixture dependency-free: the CLI validates and bundles
// the same public object contract produced by @liatir/api's definePlugin().
export default {
  __liatirPlugin: true,
  inputs: {
    value: { type: 'string', label: 'Value', required: true },
    delayMs: { type: 'number', label: 'Delay (ms)', default: 800 },
  },
  outputs: {
    value: { type: 'string', label: 'Settled value' },
    report: { type: 'file', label: 'Settlement report', ext: ['json'] },
  },
  async run(input) {
    await new Promise((resolve) => setTimeout(resolve, Number(input.delayMs ?? 800)));
    return {
      value: input.value,
      report: {
        fileName: 'plugin-settlement.json',
        content: JSON.stringify({ value: input.value, settled: true }),
      },
    };
  },
};
