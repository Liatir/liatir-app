import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIATIR_TOOL_RUNTIME_CATALOG,
  PVACTOOLS_RUNTIME_COMPONENT_ID,
  type LiatirRuntimeComponentKind,
  type LiatirRuntimeBoxCiCatalog,
  type LiatirAIProvenance,
} from '@liatir/core';

const root = resolve(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Runtime Component production contract', () => {
  it('keeps AI Models and Tool Runtimes as an exhaustive product classification', () => {
    const kinds: LiatirRuntimeComponentKind[] = ['ai-model', 'tool-runtime'];
    expect(kinds).toEqual(['ai-model', 'tool-runtime']);
    expect(LIATIR_TOOL_RUNTIME_CATALOG.map((runtime) => runtime.id))
      .toEqual([PVACTOOLS_RUNTIME_COMPONENT_ID]);
    expect(LIATIR_TOOL_RUNTIME_CATALOG[0]?.install.runtimeBox.publishedTargets).toEqual([
      {
        target: { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' },
        hostEnvironments: ['native'],
        minRamGb: 8,
      },
      {
        target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
        hostEnvironments: ['native', 'windows-wsl2'],
        minRamGb: 8,
      },
    ]);
  });

  it('uses the component catalog while preserving the Scrollcase modelId identity', () => {
    const catalog = JSON.parse(read('runtime-boxes/catalog.json')) as LiatirRuntimeBoxCiCatalog;
    expect(catalog.schemaVersion).toBe(2);
    expect(catalog.components.length).toBeGreaterThan(0);
    for (const component of catalog.components) {
      expect(component.componentId).toBe(component.modelId);
      expect(['ai-model', 'tool-runtime']).toContain(component.componentKind);
    }
  });

  it('exposes generic commands and retains every AI compatibility alias', () => {
    const main = read('src-tauri/src/main.rs');
    for (const command of ['status', 'install', 'rollback', 'remove']) {
      expect(main).toContain(`lia_runtime_box_${command}`);
      expect(main).toContain(command === 'status' ? 'lia_ai_runtime_status' : `lia_ai_runtime_box_${command}`);
    }
    const native = read('src-tauri/src/bridge/runtime_boxes.rs');
    expect(native).toContain('const AI_RUNTIME_ROOT: &str = "ai-runtimes"');
    expect(native).toContain('const TOOL_RUNTIME_ROOT: &str = "tool-runtimes"');
    expect(native).toContain('Self::AiModel => AI_RUNTIME_ROOT');
    expect(native).toContain('Self::ToolRuntime => TOOL_RUNTIME_ROOT');
  });

  it('makes update checking explicit and keeps archive installation behind Update', () => {
    const native = read('src-tauri/src/bridge/runtime_boxes.rs');
    const checkStart = native.indexOf('pub(crate) async fn runtime_component_update_status');
    const checkEnd = native.indexOf('async fn ensure_not_revoked', checkStart);
    const checkBody = native.slice(checkStart, checkEnd);
    expect(checkBody).toContain('fetch_control_document(&channel_url)');
    expect(checkBody).not.toContain('stream_download(');
    expect(checkBody).not.toContain('release_manifest_url');

    const manager = read('frontend/src/lib/components/dependencies/RuntimeComponentsManager.svelte');
    expect(manager).toContain('Check update');
    expect(manager).toContain('Nothing has been downloaded.');
    expect(manager).toContain('>Update</Button>');
  });

  it('surfaces install, cancel, rollback and remove from Dependencies', () => {
    const page = read('frontend/src/routes/deps/+page.svelte');
    const manager = read('frontend/src/lib/components/dependencies/RuntimeComponentsManager.svelte');
    expect(page).toContain('<RuntimeComponentsManager />');
    for (const label of ['Install', 'Cancel', 'Rollback', 'Remove']) expect(manager).toContain(label);
  });

  it('records multiple AI Models without invalidating legacy single-model Results', () => {
    const model = {
      modelId: 'model-a', modelName: 'Model A', runtimeKind: 'python-venv' as const,
      runtimeName: 'Python',
    };
    const shared = {
      toolId: 'tool', toolLabel: 'Tool', localOnly: true, generatedAt: '2026-08-25T00:00:00.000Z',
    };
    const current: LiatirAIProvenance = { ...shared, ...model, models: [model, { ...model, modelId: 'model-b' }] };
    const legacy: LiatirAIProvenance = { ...shared, ...model };
    expect(current.models).toHaveLength(2);
    expect(current.modelId).toBe('model-a');
    expect(legacy.models).toBeUndefined();
  });

  it('keeps molecular trajectories on disk until the user loads a bounded player', () => {
    const resultView = read('frontend/src/lib/components/ui/ToolResultView.svelte');
    const trajectoryViewer = read('frontend/src/lib/components/viewers/MolecularTrajectoryViewer.svelte');
    expect(resultView).toContain('<MolecularTrajectoryViewer section={section as MolecularTrajectoryViewerSection} />');
    expect(trajectoryViewer).toContain('The trajectory stays on disk until you choose Load trajectory.');
    expect(trajectoryViewer).toContain('MAX_TRAJECTORY_BYTES');
    expect(trajectoryViewer).toContain('MAX_TOPOLOGY_BYTES');
    expect(trajectoryViewer).toContain('readBase64(section.trajectoryPath, MAX_TRAJECTORY_BYTES)');
    expect(trajectoryViewer).toContain("await import('$lib/viewers/dcd')");
    expect(trajectoryViewer).toContain('viewer.addModelsAsFrames');
    expect(trajectoryViewer).toContain('viewer.setFrame');
  });
});
