import { liatir } from '$lib/api';
import { confirm } from './confirm.svelte';
import { aiModelsStore } from './aiModels.svelte';
import { depsStore, type DependencyProcessState } from './deps.svelte';
import { jobsStore, type JobEntry } from './jobs.svelte';
import { pipelineStore } from './pipeline.svelte';
import { viewerRuntimesStore } from './viewerRuntimes.svelte';

type CloseRequestedPayload = {
	label?: string | null;
};

type ActiveProcessSummary = {
	count: number;
	labels: string[];
};

const ACTIVE_DEPENDENCY_PHASES = new Set<DependencyProcessState['phase']>([
	'downloading',
	'extracting',
	'pm-installing'
]);

let closePromptOpen = false;

function plural(count: number, singular: string, pluralLabel = `${singular}s`) {
	return `${count} ${count === 1 ? singular : pluralLabel}`;
}

async function listRunningJobs(): Promise<JobEntry[]> {
	const api = liatir();
	if (!api) return jobsStore.jobs.filter((job) => job.status.type === 'running');
	try {
		const jobs = (await api.invoke('lia_jobs_list', { workspaceId: null })) as JobEntry[];
		return jobs.filter((job) => job.status.type === 'running');
	} catch {
		return jobsStore.jobs.filter((job) => job.status.type === 'running');
	}
}

async function activeProcessSummary(): Promise<ActiveProcessSummary> {
	const labels: string[] = [];

	const runningJobs = await listRunningJobs();
	if (runningJobs.length > 0) labels.push(plural(runningJobs.length, 'background job'));

	const runningPipelines = pipelineStore.runningCount;
	if (runningPipelines > 0) labels.push(plural(runningPipelines, 'pipeline run'));

	const aiModelInstalls = Object.keys(aiModelsStore.installing).length;
	if (aiModelInstalls > 0) labels.push(plural(aiModelInstalls, 'AI Model install'));

	const dependencyProcesses = Object.values(depsStore.processStates).filter((state) =>
		ACTIVE_DEPENDENCY_PHASES.has(state.phase)
	).length;
	if (dependencyProcesses > 0) {
		labels.push(plural(dependencyProcesses, 'dependency install/update', 'dependency installs/updates'));
	}

	const viewerRuntimeInstalls = Object.keys(viewerRuntimesStore.installProgress).length;
	if (viewerRuntimeInstalls > 0) labels.push(plural(viewerRuntimeInstalls, 'viewer runtime install'));

	return {
		count:
			runningJobs.length +
			runningPipelines +
			aiModelInstalls +
			dependencyProcesses +
			viewerRuntimeInstalls,
		labels
	};
}

async function continueClose(label: string) {
	const api = liatir();
	if (!api) return;
	await api.invoke('lia_win_continue_close', { label });
}

async function cancelClose() {
	const api = liatir();
	if (!api) return;
	await api.invoke('lia_win_cancel_close', {});
}

async function handleCloseRequest(payload: CloseRequestedPayload | null | undefined) {
	if (closePromptOpen) return;

	const label = payload?.label ?? 'main';
	const summary = await activeProcessSummary();

	if (summary.count === 0) {
		await continueClose(label);
		return;
	}

	closePromptOpen = true;
	try {
		const detail = summary.labels.length > 0 ? `\n\nActive work: ${summary.labels.join(', ')}.` : '';
		const shouldClose = await confirm({
			title: 'Processes are still running',
			message: `Liatir still has active work in progress.${detail}\n\nClosing now may interrupt running jobs or leave partial outputs. Do you want to close anyway?`,
			confirmLabel: 'Close anyway',
			cancelLabel: 'Keep running'
		});

		if (shouldClose) {
			await continueClose(label);
		} else {
			await cancelClose();
		}
	} catch {
		await cancelClose();
	} finally {
		closePromptOpen = false;
	}
}

export async function initAppCloseGuard(): Promise<(() => void) | null> {
	const api = liatir();
	if (!api) return null;
	return api.desktop.events.on('window:close-requested', (payload: CloseRequestedPayload) => {
		void handleCloseRequest(payload);
	});
}
