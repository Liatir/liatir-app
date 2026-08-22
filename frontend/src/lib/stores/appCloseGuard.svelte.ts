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

// Downloading and extracting went with the managed binary installer; a package
// manager is the only dependency work the app still runs itself.
const ACTIVE_DEPENDENCY_PHASES = new Set<DependencyProcessState['phase']>([
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
		const jobs = (await api.invoke('lia_jobs_list', { workspaceId: null, includeDev: true })) as JobEntry[];
		return jobs.filter((job) => job.status.type === 'running');
	} catch {
		return jobsStore.jobs.filter((job) => job.status.type === 'running');
	}
}

/**
 * Read a single active-process counter defensively. A throwing store getter
 * must never be able to strand the close flow, so any failure counts as "0
 * active" for that source (and is logged) rather than propagating.
 */
function safeCount(read: () => number): number {
	try {
		return read();
	} catch (err) {
		console.error('[closeGuard] failed to read active-process counter', err);
		return 0;
	}
}

async function activeProcessSummary(): Promise<ActiveProcessSummary> {
	const labels: string[] = [];

	const runningJobs = (await listRunningJobs()).length;
	if (runningJobs > 0) labels.push(plural(runningJobs, 'background job'));

	const runningPipelines = safeCount(() => pipelineStore.runningCount);
	if (runningPipelines > 0) labels.push(plural(runningPipelines, 'pipeline run'));

	const aiModelInstalls = safeCount(() => Object.keys(aiModelsStore.installing).length);
	if (aiModelInstalls > 0) labels.push(plural(aiModelInstalls, 'AI Model install'));

	const dependencyProcesses = safeCount(
		() =>
			Object.values(depsStore.processStates).filter((state) =>
				ACTIVE_DEPENDENCY_PHASES.has(state.phase)
			).length
	);
	if (dependencyProcesses > 0) {
		labels.push(plural(dependencyProcesses, 'dependency install/update', 'dependency installs/updates'));
	}

	const viewerRuntimeInstalls = safeCount(() => Object.keys(viewerRuntimesStore.installProgress).length);
	if (viewerRuntimeInstalls > 0) labels.push(plural(viewerRuntimeInstalls, 'viewer runtime install'));

	return {
		count:
			runningJobs +
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

	// Compute the summary defensively. If we cannot even determine what is
	// running, we must not trap the user: proceed with the close rather than
	// leaving the window stuck open with no feedback (the reported symptom).
	let summary: ActiveProcessSummary;
	try {
		summary = await activeProcessSummary();
	} catch (err) {
		console.error('[closeGuard] failed to compute active processes, closing anyway', err);
		await continueClose(label);
		return;
	}

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
	} catch (err) {
		// If the prompt itself fails, default to closing: an un-closable window
		// is a worse outcome than an unconfirmed close.
		console.error('[closeGuard] close prompt failed, closing anyway', err);
		await continueClose(label);
	} finally {
		closePromptOpen = false;
	}
}

export async function initAppCloseGuard(): Promise<(() => void) | null> {
	const api = liatir();
	if (!api) return null;
	try {
		return await api.desktop.events.on('window:close-requested', (payload: CloseRequestedPayload) => {
			void handleCloseRequest(payload);
		});
	} catch (err) {
		// Never let a failed listener registration abort app startup. It would
		// also leave the window un-closable, so surface it loudly.
		console.error('[closeGuard] failed to register close listener', err);
		return null;
	}
}
