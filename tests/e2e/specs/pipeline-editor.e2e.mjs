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
];
