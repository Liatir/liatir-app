/**
 * Quenta, driven end to end.
 *
 * Covers what unit tests structurally cannot: that a request survives the panel being closed and reattaches with
 * its partial answer intact, that a focused launch from a failed run arrives with the right context, and that
 * cancelling actually stops the generation running in Rust rather than just hiding the UI.
 */
import { createServer } from 'node:http';

import {
  expectNoVisibleRuntimeError,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

const RUN_ID = 'e2e-quenta-result';

async function startMockOllama(options = {}) {
  const chatRequests = [];
  let statusRequests = 0;

  async function sendChatResponse(response, request, content) {
    const thinking = request.think
      ? options.thinkingText ?? 'Reviewing the local evidence before writing the answer.'
      : '';
    if (!request.stream) {
      response.end(JSON.stringify({
        model: request.model,
        message: { role: 'assistant', content, thinking },
        prompt_eval_count: 10,
        eval_count: 8,
        total_duration: 1000,
      }));
      return;
    }

    response.setHeader('content-type', 'application/x-ndjson');
    const records = [];
    if (thinking) {
      const split = Math.max(1, Math.floor(thinking.length / 2));
      records.push(
        { model: request.model, message: { role: 'assistant', thinking: thinking.slice(0, split) }, done: false },
        { model: request.model, message: { role: 'assistant', thinking: thinking.slice(split) }, done: false },
      );
    }
    const split = Math.max(1, Math.floor(content.length / 2));
    records.push(
      { model: request.model, message: { role: 'assistant', content: content.slice(0, split) }, done: false },
      { model: request.model, message: { role: 'assistant', content: content.slice(split) }, done: false },
      {
        model: request.model,
        message: { role: 'assistant', content: '' },
        done: true,
        prompt_eval_count: 10,
        eval_count: 8,
        total_duration: 1000,
      },
    );

    for (let index = 0; index < records.length; index += 1) {
      if (response.destroyed) return;
      const line = `${JSON.stringify(records[index])}\n`;
      if (index === 0 && options.splitFirstNdjsonRecord) {
        const byteSplit = Math.max(1, Math.floor(line.length / 2));
        response.write(line.slice(0, byteSplit));
        await new Promise((resolve) => setTimeout(resolve, 10));
        response.write(line.slice(byteSplit));
      } else {
        response.write(line);
      }
      if (options.streamChunkDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.streamChunkDelayMs));
      }
    }
    response.end();
  }

  const server = createServer(async (request, response) => {
    response.setHeader('content-type', 'application/json');

    if (request.method === 'GET' && request.url === '/api/version') {
      statusRequests += 1;
      if (options.delayFirstStatusMs && statusRequests === 1) {
        await new Promise((resolve) => setTimeout(resolve, options.delayFirstStatusMs));
      }
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

      if (options.delayFirstChatMs && chatRequests.length === 1) {
        await new Promise((resolve) => setTimeout(resolve, options.delayFirstChatMs));
      }

      if (parsed.format) {
        await sendChatResponse(response, parsed, JSON.stringify({
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
        }));
        return;
      }

      const content = options.technicalFirstResponse && chatRequests.length === 1
        ? 'Run `docker inspect image` and check the system PATH for the missing binary.'
        : `Mock Quenta observed the SeqKit QC result and cites [result:${RUN_ID}].`;
      await sendChatResponse(response, parsed, content);
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

async function seedQuentaState(browser, baseUrl, thinkingEnabled = false) {
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
          thinkingEnabled: input.thinkingEnabled,
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
  }, { baseUrl, runId: RUN_ID, thinkingEnabled });
}

async function seedQuentaConversations(browser, baseUrl) {
  await browser.execute(async (input) => {
    const now = Date.now();
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'quenta/settings.json',
      content: JSON.stringify({
        config: {
          provider: 'ollama',
          baseUrl: input.baseUrl,
          model: 'mock-local',
          embeddingModel: '',
          temperature: 0.1,
          thinkingEnabled: false,
        },
      }, null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'workspaces/__test__/quenta/conversations.json',
      content: JSON.stringify({
        conversations: [
          {
            id: 'quenta-e2e-variant',
            workspaceId: '__test__',
            title: 'Variant report',
            tags: ['variant', 'report'],
            createdAt: now - 3000,
            updatedAt: now - 1000,
            messages: [
              {
                id: 'quenta-e2e-variant-message',
                role: 'user',
                intent: 'chat',
                content: 'Explain the BRCA1 variant report.',
                createdAt: now - 2900,
              },
            ],
          },
          {
            id: 'quenta-e2e-qc',
            workspaceId: '__test__',
            title: 'QC notes',
            tags: ['qc'],
            createdAt: now - 4000,
            updatedAt: now - 2000,
            messages: [
              {
                id: 'quenta-e2e-qc-message',
                role: 'user',
                intent: 'chat',
                content: 'Summarize FASTQ quality control.',
                createdAt: now - 3900,
              },
            ],
          },
          {
            id: 'quenta-e2e-protein',
            workspaceId: '__test__',
            title: 'Protein planning',
            tags: ['protein', 'report'],
            createdAt: now - 5000,
            updatedAt: now - 3000,
            messages: [],
          },
        ],
      }, null, 2),
      createDirs: true,
    });
  }, { baseUrl });
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
  await (await browser.$('[data-testid="sidebar-nav-item"]')).waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: 'Sandbox workspace shell did not open for Quenta E2E',
  });
}

export const tests = [
  {
    name: 'manages Quenta chat titles, tags, search filters, and deletion',
    async run({ browser, expect }) {
      const ollama = await startMockOllama();
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaConversations(browser, ollama.baseUrl);

        await browser.execute(() => {
          window.location.href = '/quenta';
        });
        await (await browser.$('[data-testid="quenta-conversation-search"]')).waitForDisplayed({
          timeout: 20_000,
          timeoutMsg: 'Quenta route did not open',
        });
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Variant report')),
          { timeout: 30_000, timeoutMsg: 'Seeded Quenta conversations did not render' },
        );

        const conversationCount = async () => browser.execute(
          () => document.querySelectorAll('[data-testid="quenta-conversation"]').length,
        );
        expect(await conversationCount()).toBe(3);
        await (await browser.$('[data-testid="quenta-empty-state"]')).waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Quenta selected a saved chat without an explicit user action',
        });
        expect(await (await browser.$('[data-testid="quenta-transcript"]')).isExisting()).toBe(false);
        await (await browser.$('[aria-label="Open Variant report"]')).click();
        await (await browser.$('[data-testid="quenta-transcript"]')).waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Explicitly selected Quenta chat did not open',
        });

        const search = await browser.$('[data-testid="quenta-conversation-search"]');
        await search.setValue('QC');
        await browser.waitUntil(
          async () => (await conversationCount()) === 1,
          { timeout: 10_000, timeoutMsg: 'Quenta chat search did not filter conversations' },
        );
        expect(await (await browser.$('body')).getText()).toContain('QC notes');

        await search.setValue('');
        await browser.waitUntil(
          async () => (await conversationCount()) === 3,
          { timeout: 10_000, timeoutMsg: 'Quenta chat search did not clear' },
        );

        await browser.execute(() => {
          [...document.querySelectorAll('[data-testid="quenta-tag-filter"]')]
            .find((button) => button.textContent?.includes('#report'))
            ?.click();
        });
        await browser.waitUntil(
          async () => (await conversationCount()) === 2,
          { timeout: 10_000, timeoutMsg: 'Quenta report tag filter did not apply' },
        );

        await browser.execute(() => {
          [...document.querySelectorAll('[data-testid="quenta-tag-filter"]')]
            .find((button) => button.textContent?.includes('#variant'))
            ?.click();
        });
        await browser.waitUntil(
          async () => (await conversationCount()) === 1,
          { timeout: 10_000, timeoutMsg: 'Quenta multi-tag filter did not narrow conversations' },
        );
        expect(await (await browser.$('body')).getText()).toContain('Variant report');

        await (await browser.$('[data-testid="quenta-rename-conversation"]')).click();
        await (await browser.$('[data-testid="quenta-rename-input"]')).setValue('Variant report reviewed');
        await (await browser.$('[data-testid="quenta-rename-save"]')).click();
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Variant report reviewed')),
          { timeout: 10_000, timeoutMsg: 'Quenta chat rename did not persist in UI' },
        );

        await (await browser.$('[data-testid="quenta-edit-conversation-tags"]')).click();
        await (await browser.$('[data-testid="quenta-tags-input"]')).setValue('variant, reviewed, release, ignored');
        await (await browser.$('[data-testid="quenta-tags-save"]')).click();
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('#reviewed')),
          { timeout: 10_000, timeoutMsg: 'Quenta chat tags did not render after save' },
        );

        await browser.execute(() => window.location.reload());
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Variant report reviewed')),
          { timeout: 20_000, timeoutMsg: 'Renamed Quenta chat did not survive reload' },
        );
        await (await browser.$('[data-testid="quenta-transcript"]')).waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Reloaded Quenta page did not preserve the selected chat',
        });

        await browser.execute(() => {
          [...document.querySelectorAll('[data-testid="quenta-tag-filter"]')]
            .find((button) => button.textContent?.includes('#variant'))
            ?.click();
        });
        await (await browser.$('[aria-label="Open Variant report reviewed"]')).click();
        await (await browser.$('[data-testid="quenta-delete-conversation"]')).click();
        await (await browser.$('[data-testid="quenta-delete-confirm"]')).click();
        await browser.waitUntil(
          async () => browser.execute(() => !document.body.innerText.includes('Variant report reviewed')),
          { timeout: 10_000, timeoutMsg: 'Quenta chat delete did not remove the conversation' },
        );
        await (await browser.$('[data-testid="quenta-empty-state"]')).waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Deleting the selected chat automatically selected another chat',
        });

        await browser.execute(() => window.location.reload());
        await browser.waitUntil(
          async () => browser.execute(() => window.location.pathname === '/quenta'),
          { timeout: 20_000, timeoutMsg: 'Quenta did not reload after deleting a chat' },
        );

        const persisted = await browser.execute(async () => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          return JSON.parse(raw);
        });
        expect(persisted.conversations.some((conversation) => conversation.id === 'quenta-e2e-variant')).toBe(false);
        expect(
          persisted.conversations.every((conversation) => (conversation.tags ?? []).length <= 3),
        ).toBe(true);
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.querySelector('[data-testid="quenta-provider-status"]')?.textContent
              ?.includes('Quenta ready') ?? false
          )),
          { timeout: 30_000, timeoutMsg: 'Quenta did not finish preparing after chat management reloads' },
        );

        await expectNoVisibleRuntimeError(browser);
      } finally {
        await ollama.close();
      }
    },
  },
  {
    name: 'collapses exact focused-chat duplicates and keeps reload idempotent',
    async run({ browser, expect }) {
      const ollama = await startMockOllama();
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);
        await browser.execute(async (runId) => {
          const now = Date.now();
          const prompt = `Explain why result ${runId} failed or was cancelled. Use the recorded status, logs, metadata, and outputs. Give safe troubleshooting steps without executing anything.`;
          const conversations = Array.from({ length: 8 }, (_, index) => ({
            id: `duplicate-focused-explain-${index}`,
            workspaceId: '__test__',
            title: `Failure explanation for result ${runId}`,
            tags: [],
            createdAt: now - index,
            updatedAt: now - index,
            focus: { kind: 'result', entityId: runId },
            draft: prompt,
            draftIntent: 'explain-failure',
            messages: [],
          }));
          await window.Liatir.invoke('lia_app_write_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
            content: JSON.stringify({ revision: 0, conversations }, null, 2),
            createDirs: true,
          });
          window.location.href = `/quenta?intent=explain-failure&run=${encodeURIComponent(runId)}`;
        }, RUN_ID);

        await browser.waitUntil(
          async () => browser.execute(async () => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/quenta/conversations.json',
            });
            return JSON.parse(raw).conversations.length === 1;
          }),
          { timeout: 20_000, timeoutMsg: 'Quenta did not clean exact focused-chat duplicates' },
        );
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.querySelector('[data-testid="quenta-provider-status"]')?.textContent
              ?.includes('Quenta ready') ?? false
          )),
          { timeout: 30_000, timeoutMsg: 'Quenta did not finish preparing before duplicate reload' },
        );
        await browser.execute(() => window.location.reload());
        await browser.waitUntil(
          async () => browser.execute(() => window.location.pathname === '/quenta'),
          { timeout: 20_000, timeoutMsg: 'Quenta did not reload after duplicate cleanup' },
        );
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.querySelector('[data-testid="quenta-provider-status"]')?.textContent
              ?.includes('Quenta ready') ?? false
          )),
          { timeout: 30_000, timeoutMsg: 'Quenta did not finish preparing after duplicate reload' },
        );
        const persistedCount = await browser.execute(async () => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          return JSON.parse(raw).conversations.length;
        });
        expect(persistedCount).toBe(1);
      } finally {
        await ollama.close();
      }
    },
  },
  {
    name: 'opens Result report in a separate Quenta window with Structured report selected',
    async run({ browser, expect }) {
      const ollama = await startMockOllama();
      let originalHandle = null;
      let quentaHandle = null;
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);
        await browser.execute((runId) => {
          window.location.href = `/results?run=${encodeURIComponent(runId)}`;
        }, RUN_ID);
        await (await browser.$('[data-testid="result-report"]')).waitForDisplayed({
          timeout: 20_000,
          timeoutMsg: 'Result report action did not render',
        });
        await (await browser.$('[data-testid="result-explain"]')).waitForDisplayed({
          timeout: 20_000,
          timeoutMsg: 'Explain result action did not render',
        });

        originalHandle = await browser.request('GET', '/window');
        const handlesBefore = await browser.request('GET', '/window/handles');
        await (await browser.$('[data-testid="result-report"]')).click();
        await browser.waitUntil(
          async () => (await browser.request('GET', '/window/handles')).length > handlesBefore.length,
          { timeout: 20_000, timeoutMsg: 'Generate report did not open a separate Quenta window' },
        );

        const handlesAfter = await browser.request('GET', '/window/handles');
        quentaHandle = handlesAfter.find((handle) => !handlesBefore.includes(handle));
        expect(Boolean(quentaHandle)).toBe(true);
        await browser.request('POST', '/window', { handle: quentaHandle });
        await browser.waitUntil(
          async () => browser.execute(() => (
            window.location.pathname === '/quenta'
            && document.body.innerText.includes('Structured report')
          )),
          { timeout: 30_000, timeoutMsg: 'Separate Quenta window did not select Structured report mode' },
        );
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.querySelector('[data-testid="quenta-provider-status"]')?.textContent
              ?.includes('Quenta ready') ?? false
          )),
          { timeout: 30_000, timeoutMsg: 'Separate Quenta window did not finish preparing' },
        );

        const draft = await browser.execute(() => (
          document.querySelector('[data-testid="quenta-input"]')?.value ?? ''
        ));
        expect(draft).toContain('Generate a cited structured scientific report');

        const conversationId = await browser.execute(async (runId) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          return JSON.parse(raw).conversations
            .find((conversation) => conversation.focus?.entityId === runId)?.id ?? null;
        }, RUN_ID);
        expect(Boolean(conversationId)).toBe(true);

        await browser.request('POST', '/window', { handle: originalHandle });
        await browser.execute((id) => {
          window.location.href = `/quenta?conversation=${encodeURIComponent(id)}`;
        }, conversationId);
        await browser.waitUntil(
          async () => browser.execute((id) => Boolean(
            document.querySelector(`[data-conversation-id="${id}"]`),
          ), conversationId),
          { timeout: 30_000, timeoutMsg: 'Main window did not load the shared Quenta conversation' },
        );
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.querySelector('[data-testid="quenta-provider-status"]')?.textContent
              ?.includes('Quenta ready') ?? false
          )),
          { timeout: 30_000, timeoutMsg: 'Main Quenta window did not finish preparing' },
        );

        await browser.request('POST', '/window', { handle: quentaHandle });
        const conversationSelector = `[data-conversation-id="${conversationId}"]`;
        await (await browser.$(`${conversationSelector} [data-testid="quenta-rename-conversation"]`)).click();
        await (await browser.$(`${conversationSelector} [data-testid="quenta-rename-input"]`)).setValue('Window report reviewed');
        await (await browser.$(`${conversationSelector} [data-testid="quenta-rename-save"]`)).click();
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Window report reviewed')),
          { timeout: 10_000, timeoutMsg: 'Separate window did not persist the chat rename' },
        );

        await browser.request('POST', '/window', { handle: originalHandle });
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Window report reviewed')),
          { timeout: 10_000, timeoutMsg: 'Main window did not receive the separate-window rename' },
        );
        await (await browser.$(`${conversationSelector} [data-testid="quenta-delete-conversation"]`)).click();
        await (await browser.$(`${conversationSelector} [data-testid="quenta-delete-confirm"]`)).click();
        await browser.waitUntil(
          async () => browser.execute(async (id) => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/quenta/conversations.json',
            });
            return !JSON.parse(raw).conversations.some((conversation) => conversation.id === id);
          }, conversationId),
          { timeout: 10_000, timeoutMsg: 'Stale main window did not rebase the chat deletion' },
        );

        await browser.request('POST', '/window', { handle: quentaHandle });
        await browser.waitUntil(
          async () => browser.execute((id) => !document.querySelector(`[data-conversation-id="${id}"]`), conversationId),
          { timeout: 10_000, timeoutMsg: 'Separate window did not receive the main-window deletion' },
        );
        await browser.execute(() => window.location.reload());
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.querySelector('[data-testid="quenta-provider-status"]')?.textContent
              ?.includes('Quenta ready') ?? false
          )),
          { timeout: 30_000, timeoutMsg: 'Separate Quenta window did not finish reloading' },
        );
        await browser.waitUntil(
          async () => browser.execute((id) => !document.querySelector(`[data-conversation-id="${id}"]`), conversationId),
          { timeout: 30_000, timeoutMsg: 'Deleted chat reappeared after reloading the separate window' },
        );
      } finally {
        if (quentaHandle) {
          await browser.request('DELETE', '/window').catch(() => {});
        }
        if (originalHandle) {
          await browser.request('POST', '/window', { handle: originalHandle }).catch(() => {});
        }
        await ollama.close();
      }
    },
  },
  {
    name: 'consumes Result report deep links without duplicating the chat after reload',
    async run({ browser, expect }) {
      const ollama = await startMockOllama({ delayFirstStatusMs: 3_000 });
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);
        await browser.execute(async (runId) => {
          await window.Liatir.invoke('lia_app_write_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
            content: JSON.stringify({ conversations: [] }, null, 2),
            createDirs: true,
          });
          window.location.href = `/quenta?intent=report&run=${encodeURIComponent(runId)}`;
        }, RUN_ID);

        await browser.waitUntil(
          async () => browser.execute(() => (
            window.location.pathname === '/quenta'
            && !window.location.search.includes('intent=')
            && !window.location.search.includes('run=')
          )),
          { timeout: 20_000, timeoutMsg: 'Quenta did not consume the one-shot Result deep link' },
        );
        await browser.waitUntil(
          async () => browser.execute(async () => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/quenta/conversations.json',
            });
            return JSON.parse(raw).conversations.length === 1;
          }),
          { timeout: 20_000, timeoutMsg: 'Quenta did not persist the focused report chat' },
        );

        const beforeReload = await browser.execute(async () => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          return JSON.parse(raw).conversations;
        });
        expect(beforeReload).toHaveLength(1);

        await browser.execute(() => window.location.reload());
        await browser.waitUntil(
          async () => browser.execute(() => window.location.pathname === '/quenta'),
          { timeout: 20_000, timeoutMsg: 'Quenta did not reload after consuming the Result deep link' },
        );
        const afterReload = await browser.execute(async () => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          return JSON.parse(raw).conversations;
        });
        expect(afterReload.map((conversation) => conversation.id)).toEqual(
          beforeReload.map((conversation) => conversation.id),
        );
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.body.innerText.includes('Structured report')
            && document.querySelector('[data-testid="quenta-input"]')?.value
              .includes('Generate a cited structured scientific report')
          )),
          { timeout: 20_000, timeoutMsg: 'Selected report draft and mode did not survive reload' },
        );
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.querySelector('[data-testid="quenta-provider-status"]')?.textContent
              ?.includes('Quenta ready') ?? false
          )),
          { timeout: 30_000, timeoutMsg: 'Quenta did not finish preparing after the deep-link reload' },
        );
      } finally {
        await ollama.close();
      }
    },
  },
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

        await (await browser.$('[data-testid="quenta-transcript"]')).waitForDisplayed({
          timeout: 20_000,
          timeoutMsg: 'Quenta transcript did not open',
        });
        await browser.waitUntil(
          async () => browser.execute(() => (
            document.body.innerText.includes('Mock Quenta observed')
            && Boolean(document.querySelector('[data-testid="quenta-activity"][data-state="complete"]'))
          )),
          { timeout: 30_000, timeoutMsg: 'Quenta did not finalize the mock model response' },
        );

        const bodyText = await (await browser.$('body')).getText();
        expect(bodyText).toContain(`result:${RUN_ID}`);
        expect(bodyText).toContain('Quenta E2E SeqKit Stats');
        expect(bodyText).toContain('Quenta ready');

        expect(ollama.chatRequests.length).toBeGreaterThanOrEqual(1);
        const chat = ollama.chatRequests.at(-1);
        expect(chat.stream).toBe(true);
        expect(chat.think).toBe(false);
        expect(chat.options.num_predict).toBe(2048);
        expect(chat.options.num_ctx).toBe(16384);
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
    name: 'repairs developer-facing model output before showing it to the user',
    async run({ browser, expect }) {
      const ollama = await startMockOllama({
        technicalFirstResponse: true,
        streamChunkDelayMs: 100,
      });
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);
        await browser.execute(async () => {
          await window.Liatir.invoke('lia_app_write_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
            content: JSON.stringify({ conversations: [] }, null, 2),
            createDirs: true,
          });
          window.location.href = '/quenta';
        });
        await (await browser.$('[data-testid="quenta-empty-new-chat"]')).waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Quenta did not show the empty state for response safety validation',
        });
        await (await browser.$('[data-testid="quenta-empty-new-chat"]')).click();
        await (await browser.$('[data-testid="quenta-input"]')).setValue('Explain the result simply.');
        await (await browser.$('[data-testid="quenta-send"]')).click();

        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Mock Quenta observed')),
          { timeout: 30_000, timeoutMsg: 'Quenta did not show the repaired plain-language response' },
        );
        const bodyText = await (await browser.$('body')).getText();
        expect(bodyText).not.toContain('docker inspect');
        expect(bodyText).not.toContain('system PATH');
        expect(ollama.chatRequests).toHaveLength(2);
        expect(JSON.stringify(ollama.chatRequests[1].messages)).toContain('non-technical Liatir user');
      } finally {
        await ollama.close();
      }
    },
  },
  {
    name: 'shows sanitized local-model reasoning without exposing local paths',
    async run({ browser, expect }) {
      const reasoning = 'Reviewing /Users/lorenzo/private/result.json before writing the answer.';
      const ollama = await startMockOllama({
        thinkingText: reasoning,
        streamChunkDelayMs: 250,
        splitFirstNdjsonRecord: true,
      });
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl, true);
        await browser.execute(async () => {
          await window.Liatir.invoke('lia_app_write_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
            content: JSON.stringify({ conversations: [] }, null, 2),
            createDirs: true,
          });
          window.location.href = '/quenta';
        });

        const newChat = await browser.$('[data-testid="quenta-empty-new-chat"]');
        await newChat.waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Quenta did not show the empty state for the reasoning test',
        });
        await newChat.click();
        const input = await browser.$('[data-testid="quenta-input"]');
        await input.waitForDisplayed({ timeout: 10_000 });
        await input.setValue('Explain the observed QC result.');
        await (await browser.$('[data-testid="quenta-send"]')).click();

        const reasoningStep = await browser.$('[data-testid="quenta-activity-step"][data-phase="reasoning"]');
        await reasoningStep.waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Quenta did not show the user-facing review activity',
        });
        expect(await reasoningStep.getText()).toContain('Reviewing the selected information');
        const liveReasoning = await browser.$('[data-testid="quenta-reasoning-content"]');
        await liveReasoning.waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Quenta did not render the sanitized reasoning trace',
        });
        expect(await liveReasoning.getText()).toContain('Reviewing [local path]');
        expect(await liveReasoning.getText()).not.toContain('/Users/lorenzo');
        const streamingContent = await browser.$('[data-testid="quenta-streaming-content"]');
        await streamingContent.waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Quenta did not show the answer while it was being written',
        });
        expect(await streamingContent.getText()).toContain('Mock Quenta');
        expect(await (await browser.$('[data-testid="quenta-streaming-cursor"]')).isDisplayed()).toBe(true);
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Mock Quenta observed')),
          { timeout: 20_000, timeoutMsg: 'Quenta did not finalize the streamed answer' },
        );

        await browser.waitUntil(
          async () => browser.execute(() => (
            Boolean(document.querySelector('[data-testid="quenta-activity"][data-state="complete"]'))
            && !document.querySelector('[data-testid="quenta-activity"][data-state="active"]')
          )),
          { timeout: 10_000, timeoutMsg: 'Quenta did not replace live activity with the completed response' },
        );
        expect(await browser.execute(() => (
          document.querySelector('[data-testid="quenta-activity"]')?.getAttribute('data-state')
        ))).toBe('complete');
        await (await browser.$('[data-testid="quenta-activity-toggle"]')).click();
        await (await browser.$('[data-testid="quenta-reasoning-content"]')).waitForDisplayed({
          timeout: 5_000,
          timeoutMsg: 'Completed Quenta reasoning was not expandable',
        });
        expect(await (await browser.$('[data-testid="quenta-reasoning-content"]')).getText()).toContain('[local path]');

        const persistedAssistant = await browser.execute(async () => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          const conversations = JSON.parse(raw).conversations;
          return conversations[0]?.messages.find((message) => message.role === 'assistant') ?? null;
        });
        expect(persistedAssistant?.generation?.reasoning).toContain('[local path]');
        expect(persistedAssistant?.generation?.reasoning).not.toContain('/Users/lorenzo');
        expect(persistedAssistant?.generation?.reasoningDurationMs).toBeGreaterThan(0);
        expect(persistedAssistant?.generation?.durationMs).toBeGreaterThan(0);

        const chat = ollama.chatRequests.at(-1);
        expect(chat.stream).toBe(true);
        expect(chat.think).toBe(true);
        expect(chat.options.num_predict).toBe(4096);
        expect(chat.tools).toBeUndefined();
      } finally {
        await ollama.close();
      }
    },
  },
  {
    name: 'stops and retries a Quenta response without duplicating the user message',
    async run({ browser, expect }) {
      const ollama = await startMockOllama({ delayFirstChatMs: 3_000 });
      const prompt = 'Explain this result after a stopped response.';
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);
        await browser.execute(async () => {
          await window.Liatir.invoke('lia_app_write_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
            content: JSON.stringify({ conversations: [] }, null, 2),
            createDirs: true,
          });
          window.location.href = '/quenta';
        });
        const emptyNewChat = await browser.$('[data-testid="quenta-empty-new-chat"]');
        await emptyNewChat.waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Quenta empty state did not render',
        });
        const conversationsBeforeNewChat = await browser.execute(async () => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          return JSON.parse(raw).conversations.length;
        });
        expect(conversationsBeforeNewChat).toBe(0);
        await emptyNewChat.click();
        const input = await browser.$('[data-testid="quenta-input"]');
        await input.waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Quenta did not become ready for the Stop test',
        });
        await input.setValue(prompt);
        await (await browser.$('[data-testid="quenta-send"]')).click();
        await (await browser.$('[data-testid="quenta-stop"]')).waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Stop response action did not appear',
        });
        await (await browser.$('[data-testid="quenta-stop"]')).click();
        await (await browser.$('[data-testid="quenta-retry"]')).waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Retry action did not appear after stopping the response',
        });
        expect(await (await browser.$('[data-testid="quenta-error"]')).getText()).toContain('Response stopped');

        await (await browser.$('[data-testid="quenta-retry"]')).click();
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Mock Quenta observed')),
          { timeout: 20_000, timeoutMsg: 'Quenta retry did not produce a response' },
        );

        const messages = await browser.execute(async (content) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          const conversations = JSON.parse(raw).conversations;
          return conversations
            .find((conversation) => conversation.messages.some((message) => message.content === content))
            ?.messages ?? [];
        }, prompt);
        expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
        expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
      } finally {
        await ollama.close();
      }
    },
  },
  {
    name: 'reattaches to an active Quenta response after reload without duplicating messages',
    async run({ browser, expect }) {
      const ollama = await startMockOllama({ delayFirstChatMs: 3_000 });
      const prompt = 'Explain this result after reloading an active response.';
      try {
        await openSandboxWorkspaceForQuenta(browser);
        await seedQuentaState(browser, ollama.baseUrl);
        await browser.execute(async () => {
          await window.Liatir.invoke('lia_app_write_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
            content: JSON.stringify({ conversations: [] }, null, 2),
            createDirs: true,
          });
          window.location.href = '/quenta';
        });
        const emptyNewChat = await browser.$('[data-testid="quenta-empty-new-chat"]');
        await emptyNewChat.waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Quenta empty state did not render for the reload recovery test',
        });
        await emptyNewChat.click();
        const input = await browser.$('[data-testid="quenta-input"]');
        await input.waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Quenta did not become ready for the reload recovery test',
        });
        await input.setValue(prompt);
        await (await browser.$('[data-testid="quenta-send"]')).click();
        await (await browser.$('[data-testid="quenta-stop"]')).waitForDisplayed({
          timeout: 10_000,
          timeoutMsg: 'Quenta response did not start before reload',
        });

        await browser.execute(() => window.location.reload());
        const savedConversation = await browser.$('[data-testid="quenta-conversation"] button[aria-label^="Open"]');
        await savedConversation.waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Reloaded Quenta chat was not available',
        });
        await (await browser.$('[data-testid="quenta-stop"]')).waitForDisplayed({
          timeout: 30_000,
          timeoutMsg: 'Reloaded Quenta chat did not reattach to the active response',
        });
        expect(await browser.execute(() => Boolean(
          document.querySelector('[data-testid="quenta-error"]'),
        ))).toBe(false);
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('Mock Quenta observed')),
          { timeout: 20_000, timeoutMsg: 'Reloaded Quenta response did not finish normally' },
        );

        const messages = await browser.execute(async (content) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/quenta/conversations.json',
          });
          const conversations = JSON.parse(raw).conversations;
          return conversations
            .find((conversation) => conversation.messages.some((message) => message.content === content))
            ?.messages ?? [];
        }, prompt);
        expect(messages.filter((message) => message.role === 'user')).toHaveLength(1);
        expect(messages.filter((message) => message.role === 'assistant')).toHaveLength(1);
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

        await (await browser.$('[data-testid="quenta-transcript"]')).waitForDisplayed({
          timeout: 20_000,
          timeoutMsg: 'Quenta transcript did not open for report',
        });
        await browser.waitUntil(
          async () => (await (await browser.$('body')).getText()).includes('Mock Quenta report'),
          { timeout: 30_000, timeoutMsg: 'Quenta report did not render' },
        );

        const bodyText = await (await browser.$('body')).getText();
        expect(bodyText).toContain('Executive summary');
        expect(bodyText).toContain(`Sources: [result:${RUN_ID}]`);
        expect(bodyText).toContain('Export report');

        const chat = ollama.chatRequests.at(-1);
        expect(chat.format).toBeTruthy();
        expect(chat.think).toBe(false);
        expect(chat.tools).toBeUndefined();
        expect(JSON.stringify(chat.messages)).toContain(`result:${RUN_ID}`);

        await expectNoVisibleRuntimeError(browser);
      } finally {
        await ollama.close();
      }
    },
  },
];
