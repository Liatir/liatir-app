import { createServer } from 'node:http';

import {
  expectNoVisibleRuntimeError,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

const RUN_ID = 'e2e-quenta-result';

async function startMockOllama() {
  const chatRequests = [];
  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');

    if (request.method === 'GET' && request.url === '/api/version') {
      response.end(JSON.stringify({ version: '0.99.0-e2e' }));
      return;
    }

    if (request.method === 'GET' && request.url === '/api/tags') {
      response.end(JSON.stringify({
        models: [
          {
            name: 'mock-local',
            modified_at: '2026-07-09T00:00:00Z',
            size: 1234,
            digest: 'sha256:e2e',
            details: {
              family: 'mock',
              parameter_size: '1B',
              quantization_level: 'Q4',
            },
          },
        ],
      }));
      return;
    }

    if (request.method === 'POST' && request.url === '/api/chat') {
      let body = '';
      for await (const chunk of request) body += chunk;
      const parsed = JSON.parse(body);
      chatRequests.push(parsed);

      if (parsed.format) {
        response.end(JSON.stringify({
          model: parsed.model,
          message: {
            role: 'assistant',
            content: JSON.stringify({
              title: 'Mock Quenta report',
              subject: `result:${RUN_ID}`,
              runStatus: 'done',
              executiveSummary: `The mock report used result evidence from [result:${RUN_ID}].`,
              methods: ['Reviewed local result metadata, structured output, and logs.'],
              findings: [
                {
                  title: 'Read count was available',
                  interpretation: 'The structured output includes a read count suitable for QC interpretation.',
                  evidence: ['The result context contains reads=42.'],
                  citationIds: [`result:${RUN_ID}`],
                },
              ],
              limitations: ['This is a mock model response for deterministic E2E validation.'],
              recommendedNextSteps: ['Validate the same run with a real local model before release sign-off.'],
              citationIds: [`result:${RUN_ID}`],
            }),
          },
          prompt_eval_count: 10,
          eval_count: 12,
          total_duration: 1000,
        }));
        return;
      }

      response.end(JSON.stringify({
        model: parsed.model,
        message: {
          role: 'assistant',
          content: `Mock Quenta observed the SeqKit QC result and cites [result:${RUN_ID}].`,
        },
        prompt_eval_count: 10,
        eval_count: 8,
        total_duration: 1000,
      }));
      return;
    }

    response.statusCode = 404;
    response.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Mock Ollama did not expose a TCP port.');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    chatRequests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function seedQuentaState(browser, baseUrl) {
  await browser.execute(async (input) => {
    const now = Date.now();
    const run = {
      id: input.runId,
      tool: 'seqkit-stats',
      label: 'Quenta E2E SeqKit Stats',
      inputs: ['reads.fastq'],
      outputSize: 512,
      outputFiles: [],
      params: { inputFile: 'reads.fastq' },
      status: 'done',
      startedAt: now - 1000,
      endedAt: now,
      durationMs: 1000,
      error: null,
    };

    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'quenta/settings.json',
      content: JSON.stringify({
        config: {
          provider: 'ollama',
          baseUrl: input.baseUrl,
          model: 'mock-local',
          embeddingModel: '',
          temperature: 0.1,
        },
      }, null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'workspaces/__test__/analysis-runs/index.json',
      content: JSON.stringify([run], null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: `workspaces/__test__/analysis-runs/${input.runId}.json`,
      content: JSON.stringify({
        sections: [
          {
            type: 'stats',
            items: [
              { label: 'reads', value: 42 },
              { label: 'gc_percent', value: 51.2 },
            ],
          },
          {
            type: 'text',
            label: 'QC note',
            content: 'Adapter content was elevated in the mock result.',
          },
        ],
      }, null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: `workspaces/__test__/analysis-runs/${input.runId}.log.json`,
      content: JSON.stringify(['SeqKit completed', 'reads=42']),
      createDirs: true,
    });
  }, { baseUrl, runId: RUN_ID });
}

async function openSandboxWorkspaceForQuenta(browser) {
  await waitForLiatirBridge(browser);
  await browser.execute(async () => {
    const now = Date.now();
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'workspaces.json',
      content: JSON.stringify({
        workspaces: [
          {
            id: '__test__',
            name: 'Sandbox',
            createdAt: now,
            lastOpenedAt: now,
          },
        ],
      }, null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'active-workspace.json',
      content: JSON.stringify({ id: '__test__' }),
      createDirs: true,
    });
    return true;
  });
  await browser.execute(() => {
    window.location.href = '/';
    return true;
  });
  await browser.waitUntil(
    async () => browser.execute(() => Boolean(document.querySelector('[data-testid="sidebar-nav-item"]'))),
    {
      timeout: 20_000,
      timeoutMsg: 'Sandbox workspace shell did not open for Quenta E2E',
    },
  );
}

export const tests = [
  {
    name: 'runs a read-only Quenta explanation against a mock Ollama server',
    async run({ browser, expect }) {
      const ollama = await startMockOllama();
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);

        await browser.execute((runId) => {
          window.location.href = `/quenta?intent=explain-result&run=${encodeURIComponent(runId)}&auto=1`;
        }, RUN_ID);

        await browser.waitUntil(
          async () => browser.execute(() => window.location.pathname === '/quenta'),
          { timeout: 20_000, timeoutMsg: 'Quenta route did not open' },
        );
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Mock Quenta observed')),
          { timeout: 30_000, timeoutMsg: 'Quenta did not render the mock model response' },
        );

        const bodyText = await (await browser.$('body')).getText();
        expect(bodyText).toContain(`result:${RUN_ID}`);
        expect(bodyText).toContain('Quenta E2E SeqKit Stats');
        expect(bodyText).toContain('Ollama 0.99.0-e2e');

        expect(ollama.chatRequests.length).toBeGreaterThanOrEqual(1);
        const chat = ollama.chatRequests.at(-1);
        expect(chat.stream).toBe(false);
        expect(chat.tools).toBeUndefined();
        expect(JSON.stringify(chat.messages)).toContain(`result:${RUN_ID}`);
        expect(JSON.stringify(chat.messages)).toContain('reads=42');

        await expectNoVisibleRuntimeError(browser);
      } finally {
        await ollama.close();
      }
    },
  },
  {
    name: 'generates a structured report with local citations through mock Ollama',
    async run({ browser, expect }) {
      const ollama = await startMockOllama();
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);

        await browser.execute((runId) => {
          window.location.href = `/quenta?intent=report&run=${encodeURIComponent(runId)}&auto=1`;
        }, RUN_ID);

        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Mock Quenta report')),
          { timeout: 30_000, timeoutMsg: 'Quenta report did not render' },
        );

        const bodyText = await (await browser.$('body')).getText();
        expect(bodyText).toContain('Executive summary');
        expect(bodyText).toContain(`Sources: [result:${RUN_ID}]`);
        expect(bodyText).toContain('Export report');

        const chat = ollama.chatRequests.at(-1);
        expect(chat.format).toBeTruthy();
        expect(chat.tools).toBeUndefined();
        expect(JSON.stringify(chat.messages)).toContain(`result:${RUN_ID}`);

        await expectNoVisibleRuntimeError(browser);
      } finally {
        await ollama.close();
      }
    },
  },
];
