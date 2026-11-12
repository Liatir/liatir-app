import type { Node, Edge } from '@xyflow/svelte';
import type { PipelinePreset } from './presets';
import { PIPELINE_REGISTRY } from '$lib/tools/pipeline-registry';

type Step = { key: string; step: string; inputs?: Record<string, string> };
/** Connects one step's output to another step's input: [from step, output, to step, input]. */
type Wire = [source: string, output: string, target: string, input: string];

interface SimulationPresetSpec {
  id: string;
  name: string;
  description: string;
  outcome: string;
  /** What the user must choose before running: data and the scientific settings left to them. */
  requiredInputs: string;
  /** Platform, components and hardware, shown before the preset is used. */
  requirements: string;
  steps: Step[];
  wires?: Wire[];
}

/**
 * Builds a preset from existing step definitions. Wiring is checked against their declared ports, so
 * a renamed tool output fails here instead of producing a pipeline with a dangling connection.
 */
function preset(spec: SimulationPresetSpec): PipelinePreset {
  const { steps, wires = [], ...card } = spec;
  return {
    ...card,
    instantiate(idFactory = () => crypto.randomUUID()) {
      const ids = new Map(steps.map((step) => [step.key, idFactory()]));
      const nodes: Node[] = steps.map((step, index) => {
        const definition = PIPELINE_REGISTRY[step.step]?.definition;
        if (!definition) throw new Error(`Preset refers to an unavailable step: ${step.step}`);
        const defaults = Object.fromEntries(Object.entries(definition.inputSchema)
          .filter(([, field]) => field.default !== undefined)
          .map(([key, field]) => [key, String(field.default)]));
        return {
          id: ids.get(step.key)!,
          type: 'tool',
          position: { x: 70 + index * 390, y: 160 },
          data: { stepId: step.step, label: definition.label, inputs: { ...defaults, ...step.inputs } },
        };
      });
      const edges: Edge[] = [];
      for (const [source, output, target, input] of wires) {
        const from = nodes.find((node) => node.id === ids.get(source))!;
        const to = nodes.find((node) => node.id === ids.get(target))!;
        const sourceDefinition = PIPELINE_REGISTRY[from.data.stepId as string].definition;
        const targetDefinition = PIPELINE_REGISTRY[to.data.stepId as string].definition;
        if (!sourceDefinition.outputSchema[output] || !targetDefinition.inputSchema[input]) {
          throw new Error(`Preset ${spec.id} wires a port that no longer exists: ${output} → ${input}.`);
        }
        (to.data.inputs as Record<string, string>)[input] = `@pipe:${from.id}:${output}`;
        if (!edges.some((edge) => edge.source === from.id && edge.target === to.id)) {
          edges.push({ id: idFactory(), source: from.id, target: to.id, sourceHandle: 'output', targetHandle: 'input', selectable: false });
        }
      }
      nodes.push({
        id: idFactory(),
        type: 'note',
        position: { x: 70, y: 20 },
        data: {
          text: `You choose: ${spec.requiredInputs}\nRequires: ${spec.requirements}.\nProduces: ${spec.outcome}\nThis template does not choose scientific settings for you and is not a validated study.`,
          width: 740,
          color: 'sky',
        },
      });
      return { nodes, edges };
    },
  };
}

const PLATFORM = 'Linux, or Windows through WSL2';
const docking: Step[] = [
  { key: 'prepare', step: 'docking-receptor-preparation' },
  { key: 'dock', step: 'molecular-docking' },
];
const dockingWires: Wire[] = [
  ['prepare', 'receptorPdbqt', 'dock', 'receptorPdbqt'],
  ['prepare', 'preparedReceptor', 'dock', 'receptorStructure'],
];
const complex: Step = { key: 'complex', step: 'docking-selected-complex' };
const complexWires: Wire[] = [
  ['prepare', 'receptorPdbqt', 'complex', 'receptorPdbqt'],
  ['prepare', 'preparedReceptor', 'complex', 'receptorStructure'],
  ['dock', 'dockedPoses', 'complex', 'posesSdf'],
];

export const simulationPresets: PipelinePreset[] = [
  preset({
    id: 'docking-complex-preview-v1',
    name: 'Docking and complex preview',
    description: 'Prepare a receptor, dock ligands into a binding site and look at the best pose in 3D.',
    outcome: 'Docked poses, scores and an interactive 3D complex.',
    requiredInputs: 'a receptor, a ligand file and the binding site; review the receptor preparation.',
    requirements: `${PLATFORM}; Molecular Docking and 3D Structure Viewer`,
    steps: [...docking, { key: 'view', step: 'viewer-structure-3d' }],
    wires: [...dockingWires, ['dock', 'bestPoseComplex', 'view', 'structureFile']],
  }),
  preset({
    id: 'screening-neural-rescoring-v1',
    name: 'Screening with neural rescoring',
    description: 'Dock a ligand library, then rescore the same poses with the GNINA neural network.',
    outcome: 'Vina and GNINA rankings of the same docked poses.',
    requiredInputs: 'a receptor, a ligand library and the binding site.',
    requirements: `${PLATFORM}; Molecular Docking, GNINA and a compatible NVIDIA GPU`,
    steps: [...docking, { key: 'rescore', step: 'neural-pose-rescoring' }],
    wires: [...dockingWires, ['prepare', 'receptorPdbqt', 'rescore', 'receptorPdbqt'], ['dock', 'dockedPoses', 'rescore', 'posesSdf']],
  }),
  preset({
    id: 'docking-dynamics-analysis-v1',
    name: 'Docking to molecular dynamics and analysis',
    description: 'Dock, simulate the chosen pose in water, then measure its motion and contacts.',
    outcome: 'A selected pose, its simulated trajectory, motion measurements and interaction frequencies.',
    requiredInputs: 'receptor, ligands and binding site; name the ligand and pose to simulate; review solvent, duration and atom selections.',
    requirements: `${PLATFORM}; Molecular Docking, OpenMM CUDA, Molecular Analysis and a compatible NVIDIA GPU`,
    steps: [
      ...docking, complex,
      { key: 'md', step: 'molecular-dynamics', inputs: { solvent: 'tip3p-fb' } },
      { key: 'analysis', step: 'trajectory-analysis' },
      { key: 'contacts', step: 'interaction-fingerprint' },
    ],
    wires: [
      ...dockingWires, ...complexWires,
      ['complex', 'complexPdb', 'md', 'inputStructure'], ['complex', 'ligandSdf', 'md', 'ligandSdf'],
      ['md', 'topologyPdb', 'analysis', 'topology'], ['md', 'trajectoryDcd', 'analysis', 'trajectory'], ['md', 'stateCsv', 'analysis', 'stateCsv'],
      ['md', 'topologyPdb', 'contacts', 'topology'], ['md', 'trajectoryDcd', 'contacts', 'trajectory'], ['complex', 'ligandSdf', 'contacts', 'ligandReferenceSdf'],
    ],
  }),
  // The next two run two steps on the same files. Pipelines have no shared file input, so the note
  // and card ask for the same choice in both steps rather than wiring a text path.
  preset({
    id: 'trajectory-motion-interactions-v1',
    name: 'Trajectory motion and interactions',
    description: 'Measure how an existing simulation moves and which protein–ligand contacts it keeps.',
    outcome: 'Motion measurements and protein–ligand contact frequencies.',
    requiredInputs: 'the same topology and trajectory in both steps, and the ligand for the interaction analysis.',
    requirements: `${PLATFORM}; Molecular Analysis`,
    steps: [{ key: 'analysis', step: 'trajectory-analysis' }, { key: 'contacts', step: 'interaction-fingerprint' }],
  }),
  preset({
    id: 'metabolic-flux-ranges-v1',
    name: 'Metabolic fluxes and feasible ranges',
    description: 'Find the optimal fluxes of a metabolic model, then how far each can vary.',
    outcome: 'Optimal metabolic fluxes and their feasible ranges.',
    requiredInputs: 'the same metabolic model and objective in both steps; review the medium bounds.',
    requirements: `${PLATFORM}; Metabolic Modeling`,
    steps: [
      { key: 'flux', step: 'metabolic-modeling', inputs: { analysis: 'fba' } },
      { key: 'ranges', step: 'metabolic-modeling', inputs: { analysis: 'fva' } },
    ],
  }),
  preset({
    id: 'biochemical-network-v1',
    name: 'Biochemical reaction network',
    description: 'Simulate a reaction network over time, deterministically or stochastically.',
    outcome: 'Observable amounts over time, model parameters and provenance.',
    requiredInputs: 'a BNGL reaction model, the deterministic or stochastic method, and the duration in the model’s own time units.',
    requirements: `${PLATFORM}; Biochemical Simulation`,
    steps: [{ key: 'network', step: 'biochemical-simulation', inputs: { source: 'bngl' } }],
  }),
  preset({
    id: 'multicellular-population-v1',
    name: 'Multicellular population',
    description: 'Simulate a population of cells growing and interacting in a tissue-like space.',
    outcome: 'Population and substrate histories, final cell positions and a snapshot.',
    requiredInputs: 'PhysiCell settings and any cell or rule files they refer to; review the simulated duration and seed.',
    requirements: `${PLATFORM}; Multicellular Simulation`,
    steps: [{ key: 'population', step: 'multicellular-simulation', inputs: { source: 'settings' } }],
  }),
];
