/**
 * The pipeline editor, authored through the UI.
 *
 * Everything else that touches a pipeline seeds `pipeline-workspace.json` on disk and then presses Run, so the
 * authoring half of the product — the canvas a user actually builds on — had no coverage at all: a broken step
 * menu, a canvas that mounts empty, or a connection drag that silently drops would all pass the rest of the suite.
 *
 * The graph is built the way a user builds it (add a step, drag a wire between two handles) and then read back
 * from the *rendered* canvas, not from the store: node boxes must have real geometry inside the pane and the edge
 * must have an actual drawn path. A store-only assertion would stay green on a canvas that renders nothing.
 *
 * Nodes and edges are matched through `@xyflow/svelte`'s own DOM classes. They are the library's public styling
 * contract and the only honest way to ask "did the canvas draw this", short of a pixel baseline — which
 * `visual.smoke` owns.
 */
import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
  reloadLiatirApp,
  setAppInputValue,
} from '../support/liatir-app.mjs';

async function openNewPipeline(browser) {
  await navigateSidebar(browser, '/pipelines');
  const newButton = await browser.$('[data-testid="pipeline-new-button"]');
  await newButton.waitForDisplayed({ timeout: 20_000 });
  await newButton.click();
  await browser.waitUntil(
    async () => browser.execute(() => (
      window.location.pathname === '/pipeline'
      && document.querySelector('[data-testid="pipeline-editor"]')?.getAttribute('data-pipeline-id') === 'draft'
    )),
    { timeout: 20_000, timeoutMsg: 'New pipeline did not open an empty editor' },
  );
}

/**
 * Adds one step through the real "Add step" menu and waits for the canvas to draw it.
 *
 * A node reaches the DOM before xyflow has measured it, and an unmeasured node is held at
 * `visibility: hidden` — it occupies no hit-testable area, so a wire cannot be dropped on it and a
 * screenshot does not show it. Counting elements would march straight past that; the wait is for a node
 * the user could actually see and aim at.
 */
async function addStep(browser, optionId, expectedNodeCount) {
  const addStep = await browser.$('[data-testid="pipeline-add-step"]');
  await addStep.waitForDisplayed({ timeout: 20_000 });
  await addStep.click();

  const option = await browser.$(`[data-testid="pipeline-step-option"][data-step-option-id="${optionId}"]`);
  await option.waitForDisplayed({ timeout: 20_000 });
  await option.click();

  await browser.waitUntil(
    async () => browser.execute((count) => {
      const nodes = [...document.querySelectorAll('.svelte-flow__node')];
      if (nodes.length !== count) return false;
      return nodes.every((node) => {
        const box = node.getBoundingClientRect();
        return getComputedStyle(node).visibility === 'visible' && box.width > 0 && box.height > 0;
      });
    }, expectedNodeCount),
    { timeout: 20_000, timeoutMsg: `Canvas did not draw ${expectedNodeCount} measured node(s) after adding ${optionId}` },
  );
}

/**
 * Drags a wire from one node's output handle to another node's input handle, with real pointer input.
 *
 * The drag is driven through WebDriver rather than by dispatching events at the handle elements, because xyflow
 * resolves the drop with `elementFromPoint`: a wire lands only if the target handle is genuinely under the cursor
 * and hit-testable. Events aimed straight at an element skip that check, and with it the most likely way for this
 * feature to break — a handle that is covered, mispositioned, or not yet measured.
 *
 * The path is walked in several steps: the first movement only has to cross xyflow's drag threshold, and the
 * intermediate points are what a hand-made drag produces.
 */
async function connectNodes(browser, sourceType, targetType) {
  const points = await browser.execute((fromType, toType) => {
    const center = (nodeType, handleKind) => {
      const handle = document.querySelector(`.svelte-flow__node-${nodeType} .svelte-flow__handle.${handleKind}`);
      if (!handle) return null;
      const box = handle.getBoundingClientRect();
      return { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) };
    };
    return { from: center(fromType, 'source'), to: center(toType, 'target') };
  }, sourceType, targetType);

  if (!points.from || !points.to) {
    throw new Error(`No handle to drag between ${sourceType} and ${targetType}`);
  }

  const steps = [1, 2, 3, 4].map((step) => ({
    type: 'pointerMove',
    duration: 60,
    x: Math.round(points.from.x + ((points.to.x - points.from.x) * step) / 4),
    y: Math.round(points.from.y + ((points.to.y - points.from.y) * step) / 4),
  }));

  await browser.request('POST', '/actions', {
    actions: [{
      type: 'pointer',
      id: 'mouse',
      parameters: { pointerType: 'mouse' },
      actions: [
        { type: 'pointerMove', duration: 0, x: points.from.x, y: points.from.y },
        { type: 'pointerDown', button: 0 },
        ...steps,
        { type: 'pointerUp', button: 0 },
      ],
    }],
  });

  return points;
}

/** What the canvas actually drew: one entry per node box, plus the edge paths. */
async function readCanvasGeometry(browser) {
  return browser.execute(() => {
    const pane = document.querySelector('.svelte-flow__pane')?.getBoundingClientRect() ?? null;
    const nodes = [...document.querySelectorAll('.svelte-flow__node')].map((node) => {
      const box = node.getBoundingClientRect();
      return {
        type: [...node.classList].find((name) => name.startsWith('svelte-flow__node-'))?.replace('svelte-flow__node-', '') ?? null,
        width: Math.round(box.width),
        height: Math.round(box.height),
        insidePane: Boolean(pane)
          && box.right > pane.left && box.left < pane.right
          && box.bottom > pane.top && box.top < pane.bottom,
      };
    });
    // Each edge draws twice: the visible wire, plus a wider transparent path that only widens its click target.
    const edgePaths = [...document.querySelectorAll('.svelte-flow__edge path.svelte-flow__edge-path')]
      .map((path) => path.getAttribute('d') ?? '')
      .filter((d) => d.length > 0);
    return { edgePaths, nodes };
  });
}

/** The node types the canvas currently draws, sorted, so an assertion reads as a set. */
async function drawnNodeTypes(browser) {
  return (await readCanvasGeometry(browser)).nodes.map((node) => node.type).sort();
}

/** Clicks one editor control and waits for the canvas to settle on a node count. */
async function clickAndSettle(browser, testId, expectedNodeCount) {
  const control = await browser.$(`[data-testid="${testId}"]`);
  await control.waitForDisplayed({ timeout: 20_000 });
  await control.click();
  await browser.waitUntil(
    async () => browser.execute((count) => document.querySelectorAll('.svelte-flow__node').length === count, expectedNodeCount),
    { timeout: 20_000, timeoutMsg: `${testId} did not leave ${expectedNodeCount} node(s) on the canvas` },
  );
}

/** The canvas zoom, read from the transform xyflow writes on its viewport. */
async function canvasZoom(browser) {
  return browser.execute(() => {
    const transform = document.querySelector('.svelte-flow__viewport')?.style.transform ?? '';
    const scale = /scale\(([\d.]+)\)/.exec(transform);
    return scale ? Number(scale[1]) : null;
  });
}

/**
 * A saved pipeline of `count` variable nodes laid out far wider than any screen.
 *
 * Seeded rather than authored, because this is about opening a graph the user already has: the point
 * is what the editor does on load, and clicking 24 steps into place would prove nothing extra.
 */
function wideSavedPipeline(name, count) {
  // A grid roughly 2,600 × 1,800 canvas units: far past any window, and still inside the fitter's
  // 0.1 minimum zoom. A single row of the same nodes would be ~12,000 wide, which that floor cannot
  // frame — nodes would sit outside the pane by design, and the test would be asserting a bug.
  //
  // One variable feeding a chain of math steps, because the chain has to be wireable: a variable
  // node only has an output handle, so variable→variable edges have nowhere to land and xyflow
  // draws none of them. Handles are named, as the editor names them when a user drags a wire.
  const nodes = Array.from({ length: count }, (_, index) => (index === 0
    ? { id: 'wide-node-0', type: 'variable', position: { x: 0, y: 0 }, data: { varType: 'number', value: '1' } }
    : {
      id: `wide-node-${index}`,
      type: 'math',
      position: { x: (index % 6) * 520, y: Math.floor(index / 6) * 460 },
      data: { operation: '+' },
    }));
  return {
    id: 'e2e-wide-pipeline',
    name,
    nodes,
    edges: nodes.slice(1).map((node, index) => ({
      id: `wide-edge-${index}`,
      source: nodes[index].id,
      sourceHandle: index === 0 ? 'value' : 'result',
      target: node.id,
      targetHandle: 'input',
    })),
    updatedAt: Date.now(),
  };
}

export const tests = [
  {
    name: 'builds a pipeline on the canvas and keeps it across a reload',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await openNewPipeline(browser);

      await addStep(browser, 'variable', 1);
      await addStep(browser, 'math', 2);

      await connectNodes(browser, 'variable', 'math');
      await browser.waitUntil(
        async () => browser.execute(() => document.querySelectorAll('.svelte-flow__edge').length === 1),
        { timeout: 20_000, timeoutMsg: 'Dragging between two handles did not create a connection' },
      );

      const built = await readCanvasGeometry(browser);
      expect(built.nodes.map((node) => node.type).sort()).toEqual(['math', 'variable']);
      for (const node of built.nodes) {
        expect(node.width).toBeGreaterThan(0);
        expect(node.height).toBeGreaterThan(0);
        expect(node.insidePane).toBe(true);
      }
      expect(built.edgePaths.length).toBe(1);
      await expectNoVisibleRuntimeError(browser);

      // Adding a step and connecting both save on their own, so a reload is the honest check that the
      // graph reached disk rather than only the in-memory store.
      await reloadLiatirApp(browser);
      await browser.waitUntil(
        async () => browser.execute(() => (
          window.location.pathname === '/pipeline'
          && document.querySelectorAll('.svelte-flow__node').length === 2
          && document.querySelectorAll('.svelte-flow__edge').length === 1
        )),
        { timeout: 30_000, timeoutMsg: 'Editor did not restore the built pipeline after a reload' },
      );

      const restored = await readCanvasGeometry(browser);
      expect(restored.nodes.map((node) => node.type).sort()).toEqual(['math', 'variable']);
      expect(restored.edgePaths.length).toBe(1);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'adds a note, then walks the canvas back and forward through undo and redo',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await openNewPipeline(browser);

      await addStep(browser, 'variable', 1);
      await clickAndSettle(browser, 'pipeline-add-note', 2);
      expect(await drawnNodeTypes(browser)).toEqual(['note', 'variable']);

      await clickAndSettle(browser, 'pipeline-undo', 1);
      expect(await drawnNodeTypes(browser)).toEqual(['variable']);
      await clickAndSettle(browser, 'pipeline-undo', 0);

      await clickAndSettle(browser, 'pipeline-redo', 1);
      expect(await drawnNodeTypes(browser)).toEqual(['variable']);
      await clickAndSettle(browser, 'pipeline-redo', 2);
      expect(await drawnNodeTypes(browser)).toEqual(['note', 'variable']);
      await expectNoVisibleRuntimeError(browser);

      // Undo and redo write the graph back to disk like any other edit, so the canvas the user is
      // left looking at must be the one that survives a restart — not the state before the redo.
      await reloadLiatirApp(browser);
      await browser.waitUntil(
        async () => browser.execute(() => (
          window.location.pathname === '/pipeline'
          && document.querySelectorAll('.svelte-flow__node').length === 2
        )),
        { timeout: 30_000, timeoutMsg: 'The redone canvas did not survive a reload' },
      );
      expect(await drawnNodeTypes(browser)).toEqual(['note', 'variable']);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'saves a named pipeline and reopens exactly it from the list',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      await openNewPipeline(browser);

      await addStep(browser, 'variable', 1);
      await addStep(browser, 'math', 2);
      await connectNodes(browser, 'variable', 'math');
      await browser.waitUntil(
        async () => browser.execute(() => document.querySelectorAll('.svelte-flow__edge').length === 1),
        { timeout: 20_000, timeoutMsg: 'Dragging between two handles did not create a connection' },
      );

      await (await browser.$('[data-testid="pipeline-rename"]')).click();
      await setAppInputValue(browser, '[data-testid="pipeline-name-input"]', 'Gate editor pipeline');
      // The field commits its name on blur as well as on Enter, and blurring needs no key events —
      // this harness drives the page through the DOM, and has no keyboard. Focus first: the editor
      // focuses the input on a timer, and `blur()` on an element that is not yet the active one
      // fires nothing at all.
      await browser.execute(() => {
        const input = document.querySelector('[data-testid="pipeline-name-input"]');
        input.focus();
        input.blur();
      });
      await browser.waitUntil(
        async () => browser.execute(() => !document.querySelector('[data-testid="pipeline-name-input"]')),
        { timeout: 10_000, timeoutMsg: 'The pipeline name editor never committed the typed name' },
      );
      const saveButton = await browser.$('[data-testid="pipeline-save-button"]');
      await saveButton.waitForDisplayed({ timeout: 20_000 });
      await saveButton.click();

      // Saved means on disk under that name, with the graph the canvas is showing.
      const savedPipelineId = await browser.execute(async () => {
        const raw = await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/pipeline-workspace.json' });
        const saved = (JSON.parse(raw).saved ?? []).find((entry) => entry.name === 'Gate editor pipeline');
        return saved ? { id: saved.id, nodes: saved.nodes.length, edges: saved.edges.length } : null;
      });
      expect(savedPipelineId).toMatchObject({ nodes: 2, edges: 1 });

      // Open something else first, so reopening cannot pass by leaving the editor untouched.
      await openNewPipeline(browser);
      expect(await browser.execute(() => document.querySelectorAll('.svelte-flow__node').length)).toBe(0);

      await navigateSidebar(browser, '/pipelines');
      const card = `[data-testid="pipeline-card"][data-pipeline-id="${savedPipelineId.id}"]`;
      await (await browser.$(card)).waitForDisplayed({ timeout: 20_000 });
      await (await browser.$(`${card} [data-testid="pipeline-card-open"]`)).click();

      await browser.waitUntil(
        async () => browser.execute((id) => (
          window.location.pathname === '/pipeline'
          && document.querySelector('[data-testid="pipeline-editor"]')?.getAttribute('data-pipeline-id') === id
          && document.querySelectorAll('.svelte-flow__node').length === 2
          && document.querySelectorAll('.svelte-flow__edge').length === 1
        ), savedPipelineId.id),
        { timeout: 30_000, timeoutMsg: 'The saved pipeline did not reopen in the editor' },
      );
      expect(await drawnNodeTypes(browser)).toEqual(['math', 'variable']);
      expect(await (await browser.$('body')).getText()).toContain('Gate editor pipeline');
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'frames a graph far wider than the screen when it is opened',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      const pipeline = wideSavedPipeline('Gate wide pipeline', 24);
      await browser.execute(async (saved) => {
        await window.Liatir.invoke('lia_app_write_text', {
          rel: 'workspaces/__test__/pipeline-workspace.json',
          content: JSON.stringify({
            current: { nodes: [], edges: [], name: '', id: null },
            saved: [saved],
          }, null, 2),
          createDirs: true,
        });
      }, pipeline);
      await reloadLiatirApp(browser);
      await openSandboxWorkspace(browser);

      await navigateSidebar(browser, '/pipelines');
      const card = `[data-testid="pipeline-card"][data-pipeline-id="${pipeline.id}"]`;
      await (await browser.$(card)).waitForDisplayed({ timeout: 20_000 });
      await (await browser.$(`${card} [data-testid="pipeline-card-open"]`)).click();

      await browser.waitUntil(
        async () => browser.execute((count) => (
          window.location.pathname === '/pipeline'
          && document.querySelectorAll('.svelte-flow__node').length === count
        ), pipeline.nodes.length),
        { timeout: 30_000, timeoutMsg: 'The editor did not draw every node of the wide pipeline' },
      );

      // Fitting is asynchronous: it waits for xyflow to measure the nodes, so the assertion waits too.
      await browser.waitUntil(
        async () => {
          const geometry = await readCanvasGeometry(browser);
          return geometry.nodes.length === pipeline.nodes.length
            && geometry.nodes.every((node) => node.insidePane && node.width > 0 && node.height > 0);
        },
        { timeout: 30_000, timeoutMsg: 'Opening the wide pipeline left nodes outside the visible canvas' },
      );

      // A graph this much wider than the window can only be framed by zooming out, and the fitter
      // never zooms past 1 — so a zoom below 1 is the proof that it actually framed the graph.
      const zoom = await canvasZoom(browser);
      expect(zoom).toBeGreaterThan(0);
      expect(zoom).toBeLessThan(1);
      expect((await readCanvasGeometry(browser)).edgePaths.length).toBe(pipeline.edges.length);
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
