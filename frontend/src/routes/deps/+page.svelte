<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { page } from '$app/state';
	import PageHeader from '$lib/components/layout/PageHeader.svelte';
	import Card from '$lib/components/ui/Card.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import InfoPopup from '$lib/components/ui/InfoPopup.svelte';
	import {
		defaultDependencyProcessState,
		depsStore,
		type DependencyProcessState,
		type DepResult
	} from '$lib/stores/deps.svelte';
	import { installProgress } from '$lib/stores/installProgress.svelte';
	import { viewerRuntimesStore } from '$lib/stores/viewerRuntimes.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { liatir } from '$lib/api';
	import { runNativeTool } from '$lib/utils/native-tool';
	import { getLastSegmentsStringFromPath, sanitizeLocalPathsForDisplay } from '$lib/utils';
	import {
		DEP_REQUIREMENTS,
		depRequirementForBinary,
		depRequirementLabel,
		depScope,
		depVersionSatisfied,
		dependencyBinaryForKeyOrBinary,
		isSoftDep,
		type DepRequirement
	} from '$lib/data/dep-requirements';
	import {
		packageManagerInstallCommand,
		packageManagerUpdateCommand,
		resolveDependency,
		type DependencyResolverAction,
		type DependencyResolverEnvironment,
		type DependencyResolverCommand,
	} from '$lib/dependencies/resolvers';
	import PageContent from '$lib/components/layout/PageContent.svelte';
	import {
		createLiatirRootExecutionIdentity,
		liatirExecutionMetadata,
		type LiatirExecutionIdentity,
	} from '@liatir/core';
	import { workspaceStore } from '$lib/stores/workspace.svelte';
	import { executionRuns } from '$lib/stores/executionRuns.svelte';
	import { jobsStore } from '$lib/stores/jobs.svelte';

	interface RelatedDependencyTool {
		id: string;
		parentBinary: string;
		label: string;
		description: string;
		actionLabel: string;
	}

	const RELATED_DEPENDENCY_TOOLS: RelatedDependencyTool[] = [
		{
			id: 'pip',
			parentBinary: 'python',
			label: 'pip',
			description: 'Python package installer used inside Python environments.',
			actionLabel: 'Update pip'
		}
	];

	// ── platform + package manager ─────────────────────────────────────
	let brewAvailable = $state(false);
	let condaAvailable = $state(false);
	let pmChecked = $state(false);
	const focusedDependency = $derived(
		dependencyBinaryForKeyOrBinary(page.url.searchParams.get('focus')?.trim() ?? '')
	);
	const resolverEnvironment = $derived<DependencyResolverEnvironment>({
		brewAvailable,
		condaAvailable,
	});

	let relatedToolsExpanded = $state<Record<string, boolean>>({});
	const processStates = $derived(depsStore.processStates);
	const viewerRuntimeProgress = $derived(viewerRuntimesStore.installProgress);
	const needsActionCount = $derived(depsStore.results.filter((dep) => dependencyNeedsAction(dep)).length);
	const focusedDependencies = $derived(focusedDependency ? [focusedDependency] : []);

	function toolState(binary: string): DependencyProcessState {
		return processStates[binary] ?? defaultDependencyProcessState();
	}

	function setToolState(binary: string, patch: Partial<DependencyProcessState>) {
		depsStore.setProcessState(binary, patch);
	}

	function relatedToolStateKey(parentBinary: string, toolId: string): string {
		return `${parentBinary}:${toolId}`;
	}

	function relatedToolsFor(binary: string): RelatedDependencyTool[] {
		return RELATED_DEPENDENCY_TOOLS.filter((tool) => tool.parentBinary === binary);
	}

	function toggleRelatedTools(binary: string) {
		relatedToolsExpanded = {
			...relatedToolsExpanded,
			[binary]: !relatedToolsExpanded[binary]
		};
	}

	function appendToolLog(key: string, line: string) {
		depsStore.appendProcessLog(key, line);
	}

	async function beginDependencyExecution(
		binary: string,
		label: string,
		operation: 'install' | 'update',
	): Promise<LiatirExecutionIdentity> {
		const workspaceId = workspaceStore.activeId;
		if (!workspaceId) throw new Error('No active workspace.');
		const identity = createLiatirRootExecutionIdentity({
			runId: crypto.randomUUID(),
			runKind: 'dependency',
			workspaceId,
			entityId: binary,
		});
		await executionRuns.begin({
			identity,
			label: `${operation === 'update' ? 'Update' : 'Install'} ${label}`,
			resultPolicy: 'none',
			params: { binary, operation },
		});
		installProgress.start(binary, label, identity.runId);
		return identity;
	}

	function isCancelledDependencyRun(identity: LiatirExecutionIdentity, error: unknown): boolean {
		return executionRuns.byId(identity.runId)?.status === 'cancelling' ||
			(error instanceof DOMException && error.name === 'AbortError') ||
			(error instanceof Error && /cancelled/i.test(error.message));
	}

	function activeDependencyRunId(binary: string): string | null {
		return executionRuns.active.find((execution) =>
			execution.identity.runKind === 'dependency' && execution.identity.entityId === binary
		)?.identity.runId ?? null;
	}

	function pythonPackageManager(dep: DepResult): 'brew' | 'conda' | null {
		const path = dep.path ?? '';
		if (
			brewAvailable &&
			(path.includes('/opt/homebrew/') || path.includes('/usr/local/bin/') || path.includes('/usr/local/Cellar/'))
		) {
			return 'brew';
		}
		if (
			condaAvailable &&
			(path.includes('/miniconda') || path.includes('/anaconda') || path.includes('/conda/'))
		) {
			return 'conda';
		}
		return null;
	}

	function relatedToolActionLabel(dep: DepResult, tool: RelatedDependencyTool): string {
		if (tool.id !== 'pip') return tool.actionLabel;
		const manager = pythonPackageManager(dep);
		if (manager === 'brew') return 'Update via Homebrew';
		if (manager === 'conda') return 'Update via conda';
		return tool.actionLabel;
	}

	function relatedToolRuntimeNote(dep: DepResult, tool: RelatedDependencyTool): string | null {
		if (tool.id !== 'pip') return null;
		const manager = pythonPackageManager(dep);
		if (manager === 'brew') {
			return 'This Python is managed by Homebrew, so pip is updated through the Homebrew Python package.';
		}
		if (manager === 'conda') {
			return 'This Python is managed by conda, so pip is updated through conda.';
		}
		return null;
	}

	async function scrollFocusedDependencyIntoView() {
		if (!focusedDependency) return;
		await tick();
		document
			.getElementById(`dependency-${focusedDependency}`)
			?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	onMount(async () => {
		void depsStore.checkAll(focusedDependencies);
		await viewerRuntimesStore.init();
		await executionRuns.init();
		for (const execution of executionRuns.records) {
			if (execution.identity.runKind !== 'dependency' || execution.status !== 'interrupted') continue;
			const binary = execution.identity.entityId;
			if (!binary) continue;
			const label = depRequirementForBinary(binary)?.label ?? binary;
			const message = 'Previous install was interrupted. Run it again to resume safely.';
			installProgress.recoverable(binary, label, message);
			setToolState(binary, { phase: 'error', error: message, showLog: true });
		}

		const api = liatir();
		if (api) {
			const [brewRes, condaRes] = await Promise.all([
				api.deps.check('brew'),
				api.deps.check('conda')
			]);
			brewAvailable = brewRes.available;
			condaAvailable = condaRes.available;
		}
		pmChecked = true;
		await scrollFocusedDependencyIntoView();
	});

	$effect(() => {
		if (depsStore.checked && focusedDependency) {
			if (!depsStore.results.some((dep) => dep.binary === focusedDependency)) {
				void depsStore.recheckOne(focusedDependency);
			}
			void scrollFocusedDependencyIntoView();
		}
	});

	// ── package manager install (brew / conda) ─────────────────────────
	function pmInstallCmd(binary: string): DependencyResolverCommand | null {
		return packageManagerInstallCommand(depRequirementForBinary(binary), resolverEnvironment);
	}

	function pmUpdateCmd(binary: string): DependencyResolverCommand | null {
		return packageManagerUpdateCommand(depRequirementForBinary(binary), resolverEnvironment);
	}

	async function pmRun(binary: string, operation: 'install' | 'update') {
		const cmd = operation === 'update' ? pmUpdateCmd(binary) : pmInstallCmd(binary);
		if (!cmd) return;

		const label = depRequirementForBinary(binary)?.label ?? binary;
		const execution = await beginDependencyExecution(binary, label, operation);
		setToolState(binary, { phase: 'pm-installing', error: null, pmLog: [], pmOperation: operation, showLog: true });
		installProgress.update(binary, { phase: 'pm-installing' });
		try {
			setToolState(binary, { pmLog: [`$ ${cmd.cmd} ${cmd.args.join(' ')}`] });
				const result = await runNativeTool(cmd.cmd, cmd.args, (line) => {
					appendToolLog(binary, line);
					void executionRuns.appendLog(execution.runId, line, { stream: 'stdout' }).catch(() => {});
				}, (line) => {
					appendToolLog(binary, line);
					void executionRuns.appendLog(execution.runId, line, { stream: 'stderr', level: 'error' }).catch(() => {});
				}, {
					env: pmRunEnv(cmd.cmd),
					label: `${operation === 'update' ? 'Update' : 'Install'} ${label}`,
					kind: 'dependency',
					metadata: { ...liatirExecutionMetadata(execution), binary, operation },
					signal: executionRuns.signal(execution.runId),
					onSpawn: (jobId) => {
						void executionRuns.attachJob(execution.runId, jobId).catch(() => {});
						void jobsStore.setProgress(jobId, {
							current: 0, total: 1, label: operation === 'update' ? 'Updating' : 'Installing', done: false,
						}).catch(() => {});
					},
				});
				if (!result.ok) {
				const msg = result.stderr || `Exited ${result.exitCode}`;
				setToolState(binary, { phase: 'error', error: msg });
					installProgress.error(binary, msg);
					await jobsStore.setProgress(result.jobId, {
						current: 0, total: 1, label: 'Failed', done: true,
					}).catch(() => {});
					await executionRuns.finish(execution.runId, 'error', msg);
				} else {
				setToolState(binary, { phase: 'done' });
				await depsStore.recheckOne(binary);
					installProgress.done(binary);
					await jobsStore.setProgress(result.jobId, {
						current: 1, total: 1, label: 'Installed', done: true,
					}).catch(() => {});
					await executionRuns.finish(execution.runId, 'done');
				}
		} catch (e) {
			const cancelled = isCancelledDependencyRun(execution, e);
			const message = cancelled ? 'Dependency update was cancelled; it can be run again safely.' : String(e);
			setToolState(binary, { phase: 'error', error: message });
			if (cancelled) installProgress.recoverable(binary, label, message);
			else installProgress.error(binary, message);
			if (executionRuns.byId(execution.runId)) {
				await executionRuns.finish(execution.runId, cancelled ? 'cancelled' : 'error', message);
			}
		}
	}

	async function pmInstall(binary: string) {
		await pmRun(binary, 'install');
	}

	async function pmUpdate(binary: string) {
		await pmRun(binary, 'update');
	}

	async function runDependencyResolverAction(
		binary: string,
		req: DepRequirement,
		action: DependencyResolverAction,
	) {
		const ok = await confirm({
			title: action.confirmTitle ?? 'Run dependency fix',
			message: action.confirmMessage ?? `Run "${action.label}" for ${req.label ?? binary}?`,
			confirmLabel: action.confirmLabel ?? 'Run',
		});
		if (!ok) return;

		const label = req.label ?? binary;
		const execution = await beginDependencyExecution(binary, label, 'update');
		setToolState(binary, {
			phase: 'pm-installing',
			error: null,
			pmLog: [],
			pmOperation: 'update',
			showLog: true,
		});
		installProgress.update(binary, { phase: 'pm-installing' });

		try {
			for (const command of action.commands) {
				const commandLog = `$ ${command.cmd} ${command.args.join(' ')}`;
				appendToolLog(binary, commandLog);
				await executionRuns.appendLog(execution.runId, commandLog, { stream: 'system' });
				const result = await runNativeTool(
					command.cmd,
					command.args,
					(line) => {
						appendToolLog(binary, line);
						void executionRuns.appendLog(execution.runId, line, { stream: 'stdout' }).catch(() => {});
					},
					(line) => {
						appendToolLog(binary, line);
						void executionRuns.appendLog(execution.runId, line, { stream: 'stderr', level: 'error' }).catch(() => {});
					},
					{
						env: pmRunEnv(command.cmd),
						label: `${action.label}: ${label}`,
						kind: 'dependency',
						metadata: { ...liatirExecutionMetadata(execution), binary, operation: 'update' },
						signal: executionRuns.signal(execution.runId),
						onSpawn: (jobId) => void executionRuns.attachJob(execution.runId, jobId).catch(() => {}),
					},
				);
				if (!result.ok) {
					const msg = result.stderr || result.stdout || `Exited ${result.exitCode}`;
					setToolState(binary, { phase: 'error', error: msg });
					installProgress.error(binary, msg);
					await executionRuns.finish(execution.runId, 'error', msg);
					return;
				}
			}
			setToolState(binary, { phase: 'done' });
			await depsStore.recheckOne(binary);
			installProgress.done(binary);
			await executionRuns.finish(execution.runId, 'done');
		} catch (e) {
			const cancelled = isCancelledDependencyRun(execution, e);
			const message = cancelled ? 'Dependency update was cancelled; it can be run again safely.' : String(e);
			setToolState(binary, { phase: 'error', error: message });
			if (cancelled) installProgress.recoverable(binary, label, message);
			else installProgress.error(binary, message);
			await executionRuns.finish(execution.runId, cancelled ? 'cancelled' : 'error', message).catch(() => {});
		}
	}

	async function updateRelatedTool(dep: DepResult, tool: RelatedDependencyTool) {
		if (tool.id !== 'pip') return;
		const key = relatedToolStateKey(dep.binary, tool.id);
		const label = `${tool.label} for ${depRequirementForBinary(dep.binary)?.label ?? dep.binary}`;
		const execution = await beginDependencyExecution(dep.binary, label, 'update');
		const manager = pythonPackageManager(dep);
		const managedCmd =
			manager === 'brew'
				? { cmd: 'brew', args: ['upgrade', DEP_REQUIREMENTS.python.brew ?? 'python@3.12'] }
				: manager === 'conda'
					? { cmd: 'conda', args: ['install', '-c', 'conda-forge', '-y', 'pip'] }
					: null;
		const python = dep.path ?? dep.binary;
		const command = managedCmd ?? { cmd: python, args: ['-m', 'pip', 'install', '--upgrade', 'pip'] };
		const commandLog = `$ ${managedCmd ? command.cmd : getLastSegmentsStringFromPath(command.cmd, 2)} ${command.args.join(' ')}`;
		setToolState(key, {
			phase: 'pm-installing',
			error: null,
			pmLog: [commandLog, relatedToolRuntimeNote(dep, tool) ?? ''].filter(Boolean),
			pmOperation: 'update',
			showLog: true
		});
		installProgress.update(dep.binary, { phase: 'pm-installing' });

		try {
			await executionRuns.appendLog(execution.runId, commandLog, { stream: 'system' });
			const result = await runNativeTool(command.cmd, command.args, (line) => {
				appendToolLog(key, line);
				void executionRuns.appendLog(execution.runId, line, { stream: 'stdout' }).catch(() => {});
			}, (line) => {
				appendToolLog(key, line);
				void executionRuns.appendLog(execution.runId, line, { stream: 'stderr', level: 'error' }).catch(() => {});
			}, {
				env: pmRunEnv(command.cmd),
				label,
				kind: 'dependency',
				metadata: {
					...liatirExecutionMetadata(execution),
					binary: dep.binary,
					operation: 'update',
					relatedTool: tool.id,
				},
				signal: executionRuns.signal(execution.runId),
				onSpawn: (jobId) => void executionRuns.attachJob(execution.runId, jobId).catch(() => {}),
			});
			if (!result.ok) {
				const rawMsg = result.stderr || result.stdout || `Exited ${result.exitCode}`;
				const msg = rawMsg.includes('externally-managed-environment')
					? 'This Python environment is externally managed. Update pip through the Python package manager, or use a virtual environment. Liatir managed AI runtimes already create isolated Python environments for model dependencies.'
					: rawMsg;
				setToolState(key, { phase: 'error', error: msg });
				installProgress.error(dep.binary, msg);
				await executionRuns.finish(execution.runId, 'error', msg);
				return;
			}
			setToolState(key, { phase: 'done' });
			await depsStore.recheckOne(dep.binary);
			installProgress.done(dep.binary);
			await executionRuns.finish(execution.runId, 'done');
		} catch (e) {
			const cancelled = isCancelledDependencyRun(execution, e);
			const message = cancelled ? 'Dependency update was cancelled; it can be run again safely.' : String(e);
			setToolState(key, { phase: 'error', error: message });
			if (cancelled) installProgress.recoverable(dep.binary, label, message);
			else installProgress.error(dep.binary, message);
			await executionRuns.finish(execution.runId, cancelled ? 'cancelled' : 'error', message).catch(() => {});
		}
	}

	function fmtBytes(b: number): string {
		if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`;
		if (b >= 1_000) return `${(b / 1_000).toFixed(0)} KB`;
		return `${b} B`;
	}

	function pmLabel(): string {
		if (brewAvailable) return 'Via Homebrew';
		if (condaAvailable) return 'Via conda';
		return '';
	}

	function pmRunEnv(cmd: string): Record<string, string> | undefined {
		if (cmd !== 'brew') return undefined;
		return {
			HOMEBREW_NO_AUTO_UPDATE: '1',
			HOMEBREW_NO_ENV_HINTS: '1',
		};
	}

	function requirementLabel(req: DepRequirement): string {
		return depRequirementLabel(req);
	}

	function dependencyScope(binary: string): NonNullable<DepRequirement['scope']> {
		return depScope(depRequirementForBinary(binary));
	}

	function isSoftDependency(binary: string): boolean {
		return isSoftDep(depRequirementForBinary(binary));
	}

	function softDependencyLabel(binary: string): string {
		return dependencyScope(binary) === 'model-runtime' ? 'AI Model runtime' : 'Optional';
	}

	function dependencyKindLabel(binary: string): string {
		const req = depRequirementForBinary(binary);
		if (isSoftDependency(binary)) return softDependencyLabel(binary);
		if (req?.category === 'workflow') return 'Workflow dependency';
		if (req?.category === 'bioinformatics') return 'Tool dependency';
		return 'Core dependency';
	}

	function isCoreDependency(binary: string): boolean {
		const req = depRequirementForBinary(binary);
		return !isSoftDependency(binary) && req?.category === 'core-runtime';
	}

	function dependencyNeedsAction(dep: DepResult): boolean {
		if (!isCoreDependency(dep.binary)) return false;
		const req = depRequirementForBinary(dep.binary);
		if (!dep.available) return true;
		return !depVersionSatisfied(dep.version, req);
	}

	function viewerProgressLabel(id: string): string {
		const progress = viewerRuntimeProgress[id];
		if (!progress) return '';
		if (progress.phase === 'done') return 'Installed';
		const file = `File ${progress.fileIndex + 1}/${progress.fileCount}`;
		const bytes = progress.bytesTotal
			? `${fmtBytes(progress.bytesDownloaded)} / ${fmtBytes(progress.bytesTotal)}`
			: fmtBytes(progress.bytesDownloaded);
		return `${file} · ${bytes}`;
	}

	async function installViewerRuntime(id: string) {
		try {
			await viewerRuntimesStore.installManagedRuntime(id);
			toast.success('Viewer runtime installed');
		} catch (error) {
			if(error instanceof Error && error?.message?.trim() && error.message.toLowerCase().includes("already installed")) toast.info(error instanceof Error ? error.message : 'Failed to install viewer runtime');
			else toast.error(error instanceof Error ? error.message : 'Failed to install viewer runtime');
		}
	}

	async function removeViewerRuntime(id: string) {
		const runtime = viewerRuntimesStore.byId(id);
		if (!runtime) return;
		const ok = await confirm({
			title: 'Remove viewer runtime',
			message: `Remove "${runtime.name}" from this device? It can be installed again later.`,
			confirmLabel: 'Remove',
		});
		if (!ok) return;
		try {
			await viewerRuntimesStore.removeManagedRuntime(id);
			toast.info('Viewer runtime removed');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'Failed to remove viewer runtime');
		}
	}
</script>

<div class="flex flex-col h-full">
	<PageHeader title="Dependencies" description="System runtimes and bioinformatics tools available on this system">
		{#snippet actions()}
			<Button
					variant="secondary"
					size="sm"
					onclick={() => depsStore.checkAll(focusedDependencies, { force: true })}
					loading={depsStore.loading}
			>
				{depsStore.checked ? 'Re-check all' : 'Check all'}
			</Button>
		{/snippet}
	</PageHeader>

	<PageContent>
	<div class="flex-1 overflow-y-auto p-6 space-y-4">
		{#if depsStore.loading}
				<div class="flex flex-col items-center gap-3 py-16">
					<Spinner size={28} />
					<p class="text-sm text-text-muted">Checking dependencies…</p>
				</div>
		{:else if !depsStore.checked}
			<div class="flex flex-col items-center gap-4 py-16">
				<p class="text-sm text-text-secondary">No check has been run yet.</p>
				<Button variant="primary" onclick={() => depsStore.checkAll(focusedDependencies)}>Check Dependencies</Button>
			</div>
		{:else}
			<!-- Summary -->
			<div class="grid grid-cols-3 gap-3">
				<Card class="p-4">
					<p class="text-xs text-text-muted mb-1">Available</p>
					<p class="text-2xl font-semibold text-emerald-500">{depsStore.availableCount}</p>
					<p class="text-xs text-text-subtle mt-1">of {depsStore.results.length} dependencies</p>
				</Card>
				<Card class="p-4">
					<p class="text-xs text-text-muted mb-1">Core issues</p>
					<p class="text-2xl font-semibold {needsActionCount > 0 ? 'text-red-400' : 'text-text-subtle'}">
						{needsActionCount}
					</p>
					<p class="text-xs text-text-subtle mt-1">runtime essentials</p>
				</Card>
				<Card class="p-4">
					<p class="text-xs text-text-muted mb-1">Checked</p>
					<p class="text-2xl font-semibold text-text">{depsStore.results.length}</p>
					<p class="text-xs text-text-subtle mt-1">total</p>
				</Card>
										</div>

			<div class="flex justify-center gap-2 items-center w-full cursor-default group">
				<div class="w-full h-px bg-surface-3 group-hover:bg-border-2"></div>
				<div class="min-w-fit text-[11px] text-text-subtle text-center group-hover:text-text-secondary">
					Dependencies are installed globally, therefore available to all workspaces
				</div>
				<div class="w-full h-px bg-surface-3 group-hover:bg-border-2"></div>
			</div>

			{#if focusedDependency}
				<div class="rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-text-secondary">
					<p class="font-medium text-text">Resolve dependency</p>
					<p class="mt-1 text-xs text-text-muted">
						Install or update <span class="font-mono">{focusedDependency}</span>, then return to AI Models and install the model again.
						{#if isSoftDependency(focusedDependency)}
							This is only required by AI Models that use this runtime.
						{/if}
					</p>
				</div>
			{/if}

			<!-- Tool list -->
			<Card>
				<div class="divide-y divide-border">
					<div>
						{#each depsStore.results as dep (dep.binary)}
							{@const req = depRequirementForBinary(dep.binary)}
							{@const state = toolState(dep.binary)}
							{@const hasPm = !!pmInstallCmd(dep.binary)}
							{@const activeDependencyRun = activeDependencyRunId(dep.binary)}
							{@const isBusy = state.phase === 'pm-installing'}
							{@const isBundled = dep.source === 'bundled'}
							{@const versionOk = !dep.available || depVersionSatisfied(dep.version, req)}
							<!-- Includes the case where nothing usable answered at all, not only a version out of range. -->
							{@const isUnsupportedVersion = dep.available && !versionOk}
							{@const isSoft = isSoftDependency(dep.binary)}
							{@const isCore = isCoreDependency(dep.binary)}
							{@const canUpdateWithPm = !!pmUpdateCmd(dep.binary)}
							{@const relatedTools = relatedToolsFor(dep.binary)}
							{@const isRelatedExpanded = !!relatedToolsExpanded[dep.binary]}
							{@const resolution = resolveDependency({ dep, requirement: req, environment: resolverEnvironment })}
							{@const primaryResolutionMessage = resolution.messages[0]?.text ?? null}

							<div
								id={`dependency-${dep.binary}`}
								class={dep.binary === focusedDependency ? 'bg-brand/5 ring-1 ring-brand/20' : ''}
							>
								<!-- Main row -->
								<div class="flex items-center gap-3 px-4 py-3">
									<!-- Status dot -->
									<span
										class="h-2 w-2 rounded-full shrink-0 {isUnsupportedVersion
											? 'bg-amber-400'
											: dep.available
											? 'bg-emerald-500'
											: !isCore || isSoft
											? 'bg-border-2'
											: 'bg-red-400'}"
									></span>

									<!-- Binary name -->
									<p class="text-sm font-mono font-medium text-text w-24 shrink-0">
										{dep.binary}
									</p>

									<!-- Info popup -->
									{#if req}
										<InfoPopup text="{req.label} — {req.description}" />
									{/if}

									<!-- Status message -->
									<div class="flex-1 min-w-0">
										{#if isBundled}
											<p class="text-xs text-emerald-600 truncate">
												Included with Liatir —
												<span class="font-mono text-text-muted" data-selectable>{dep.version}</span>
											</p>
										{:else if dep.available}
											{#if isUnsupportedVersion && req}
												{#if primaryResolutionMessage}
													<p class="text-xs text-amber-600">{primaryResolutionMessage}</p>
												{:else}
													<p class="text-xs text-amber-600 truncate">
														{dep.version ?? 'No version reported'} — requires {requirementLabel(req)}
													</p>
												{/if}
											{:else if dep.version}
												<p class="text-xs font-mono text-text-muted truncate" data-selectable>
													{dep.version}{req ? ` (requires ${requirementLabel(req)})` : ''}
												</p>
											{:else if dep.path}
												<p class="text-xs font-mono text-text-subtle truncate" data-selectable>
													<span title={getLastSegmentsStringFromPath(dep.path, 2)}>{getLastSegmentsStringFromPath(dep.path, 2)}</span>
												</p>
											{:else}
												<p class="text-xs text-text-subtle">Found in PATH</p>
											{/if}
											{#if isSoft || !isCore}
												<p class="mt-1 text-[10px] text-text-subtle">{dependencyKindLabel(dep.binary)}</p>
											{/if}
										{:else if state.phase === 'pm-installing'}
											<p class="text-xs text-brand">{state.pmOperation === 'update' ? 'Checking for update' : 'Installing'} via {pmLabel()}…</p>
										{:else if state.phase === 'done'}
											<p class="text-xs text-emerald-600">Installed successfully</p>
										{:else if state.phase === 'error'}
											<p class="text-xs text-red-500 truncate">{sanitizeLocalPathsForDisplay(state.error ?? 'Install failed.', 2)}</p>
										{:else}
											{#if isSoft || !isCore}
												<p class="text-xs text-text-subtle">
													Install when needed by {isSoft ? 'an AI Model' : 'a tool'}
													{#if pmChecked && !hasPm}
														— use <span class="font-mono">brew</span>,
														<span class="font-mono">conda</span>, or
														<span class="font-mono">apt</span>
													{/if}
												</p>
											{:else}
												<p class="text-xs text-text-subtle">
													Not found in PATH
													{#if pmChecked && !hasPm}
														— install via <span class="font-mono">brew</span>,
														<span class="font-mono">conda</span>, or
														<span class="font-mono">apt</span>
													{/if}
												</p>
											{/if}
										{/if}
										{#if req?.reason && (isUnsupportedVersion || isSoft || !isCore || dep.binary === 'python')}
											<p class="mt-1 text-[10px] text-text-subtle">{req.reason}</p>
										{/if}
									</div>

									<!-- Toggle log -->
									{#if (state.pmLog.length > 0 || state.phase === 'error') && !isBusy}
										<button
											onclick={() => setToolState(dep.binary, { showLog: !state.showLog })}
											class="text-[10px] text-text-subtle hover:text-text-secondary transition-colors shrink-0 font-mono"
										>
											{state.showLog ? 'hide' : 'log'}
										</button>
									{/if}

									<!-- Action buttons. A bundled tool has none: it arrived with the
									     application, updates with it, and cannot be removed on its own. -->
									{#if isBundled}
										<p class="text-xs text-text-subtle shrink-0">Built in</p>
									{:else if (isUnsupportedVersion || !dep.available) && pmChecked && !isBusy}
										<div class="flex items-center gap-2 shrink-0">
											{#if req?.downloadOptions}
												{#each req.downloadOptions as opt}
													<Button
														variant={opt.recommended ? 'primary' : 'secondary'}
														size="sm"
														onclick={async () => { const api = liatir(); if (api) await api.openBrowser(opt.url); }}
													>
														{opt.label} ↗
													</Button>
												{/each}
											{:else}
												{#if hasPm}
													<Button variant="secondary" size="sm" onclick={() => pmInstall(dep.binary)}>
														{dep.available ? `Install/Update ${pmLabel()}` : pmLabel()}
													</Button>
												{/if}
												{#if req}
													{#each resolution.actions as action (action.id)}
														<Button
															variant={action.variant ?? 'secondary'}
															size="sm"
															onclick={() => runDependencyResolverAction(dep.binary, req, action)}
														>
															{action.label}
														</Button>
													{/each}
												{/if}
											{/if}
										</div>
									{:else if isBusy}
										<div class="shrink-0 flex items-center gap-2">
											<svg class="animate-spin h-4 w-4 text-brand" viewBox="0 0 24 24" fill="none">
												<circle
													class="opacity-25"
													cx="12"
													cy="12"
													r="10"
													stroke="currentColor"
													stroke-width="3"
												/>
												<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
											</svg>
											{#if activeDependencyRun}
												<Button variant="secondary" size="sm" onclick={() => executionRuns.cancel(activeDependencyRun)}>Cancel</Button>
											{/if}
										</div>
									{:else if !isBusy && dep.available && pmChecked}
										<div class="flex items-center gap-2 shrink-0">
											<p class="text-xs text-text-subtle">Installed</p>
											{#if canUpdateWithPm}
												<Button variant="secondary" size="sm" onclick={() => pmUpdate(dep.binary)}>
													Check update
												</Button>
											{/if}
										</div>
									{/if}

								</div>

								<!-- Install log -->
								{#if state.showLog && (state.pmLog.length > 0 || state.phase === 'error')}
									<div
										class="mx-4 mb-3 rounded-lg border border-border bg-zinc-950 px-3 py-2 max-h-40 overflow-y-auto"
									>
										{#if state.phase === 'error' && state.error}
											<p class="text-xs font-mono text-red-400 mb-1">{sanitizeLocalPathsForDisplay(state.error, 2)}</p>
										{/if}
										{#each state.pmLog as line}
											<p class="text-[11px] font-mono text-zinc-300 leading-relaxed">{sanitizeLocalPathsForDisplay(line, 2)}</p>
										{/each}
									</div>
								{/if}

								{#if relatedTools.length > 0}
									<div class="mx-4 mb-3">
										<button
											type="button"
											class="flex w-full items-center justify-between rounded-lg border border-border bg-surface-2 px-2.5 py-1 font-light text-left text-[11px] text-text-subtle hover:text-text-secondary transition-colors hover:bg-surface-2"
											aria-expanded={isRelatedExpanded}
											onclick={() => toggleRelatedTools(dep.binary)}
										>
											<span class="font-medium">Related deps</span>
											<span class="font-mono text-[10px] text-text-subtle">
												{isRelatedExpanded ? 'collapse' : 'expand'}
											</span>
										</button>

										{#if isRelatedExpanded}
											<div class="mt-2 space-y-2">
												{#each relatedTools as relatedTool (relatedTool.id)}
													{@const relatedKey = relatedToolStateKey(dep.binary, relatedTool.id)}
													{@const relatedState = toolState(relatedKey)}
													{@const relatedBusy = relatedState.phase === 'pm-installing'}
													{@const runtimeNote = relatedToolRuntimeNote(dep, relatedTool)}
													<div class="rounded-lg border border-border bg-surface px-3 py-3">
														<div class="flex items-start gap-3">
															<span
																class="mt-1 h-2 w-2 rounded-full shrink-0 {relatedState.phase === 'error'
																	? 'bg-red-400'
																	: relatedState.phase === 'done'
																	? 'bg-emerald-500'
																	: dep.available
																	? 'bg-border-2'
																	: 'bg-red-400'}"
															></span>
															<div class="min-w-0 flex-1">
																<div class="flex items-center gap-2">
																	<p class="truncate text-sm font-mono font-medium text-text">
																		{relatedTool.label}
																	</p>
																	<InfoPopup text="{relatedTool.label} — {relatedTool.description}" />
																</div>
																<p class="mt-1 text-xs text-text-muted">{relatedTool.description}</p>
																{#if runtimeNote}
																	<p class="mt-1 text-[10px] leading-snug text-text-subtle">{runtimeNote}</p>
																{/if}
																{#if dep.available && dep.path}
																	<p class="mt-1 text-[10px] text-text-subtle">
																		Uses
																		<span class="font-mono" title={getLastSegmentsStringFromPath(dep.path, 2)}>
																			{getLastSegmentsStringFromPath(dep.path, 2)}
																		</span>
																	</p>
																{:else}
																	<p class="mt-1 text-[10px] text-red-500">Python is not available.</p>
																{/if}
																{#if relatedState.phase === 'pm-installing'}
																	<p class="mt-1 text-xs text-brand">Updating…</p>
																{:else if relatedState.phase === 'done'}
																	<p class="mt-1 text-xs text-emerald-600">Updated successfully</p>
																{:else if relatedState.phase === 'error'}
																	<p class="mt-1 truncate text-xs text-red-500">
																		{sanitizeLocalPathsForDisplay(relatedState.error ?? 'Update failed.', 2)}
																	</p>
																{/if}
															</div>
															<div class="flex shrink-0 items-center gap-2">
																{#if (relatedState.pmLog.length > 0 || relatedState.phase === 'error') && !relatedBusy}
																	<button
																		type="button"
																		onclick={() => setToolState(relatedKey, { showLog: !relatedState.showLog })}
																		class="text-[10px] text-text-subtle transition-colors hover:text-text-secondary shrink-0 font-mono"
																	>
																		{relatedState.showLog ? 'hide' : 'log'}
																	</button>
																{/if}
																<Button
																	variant="secondary"
																	size="sm"
																	disabled={!dep.available || relatedBusy}
																	loading={relatedBusy}
																	onclick={() => updateRelatedTool(dep, relatedTool)}
																>
																	{relatedToolActionLabel(dep, relatedTool)}
																</Button>
															</div>
														</div>

														{#if relatedState.showLog && (relatedState.pmLog.length > 0 || relatedState.phase === 'error')}
															<div
																class="mt-3 rounded-lg border border-border bg-zinc-950 px-3 py-2 max-h-40 overflow-y-auto"
															>
																{#if relatedState.phase === 'error' && relatedState.error}
																	<p class="text-xs font-mono text-red-400 mb-1">
																		{sanitizeLocalPathsForDisplay(relatedState.error, 2)}
																	</p>
																{/if}
																{#each relatedState.pmLog as line}
																	<p class="text-[11px] font-mono text-text-faint leading-relaxed">
																		{sanitizeLocalPathsForDisplay(line, 2)}
																	</p>
																{/each}
															</div>
														{/if}
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</div></Card
			>

			<Card>
				<div class="border-b border-border px-4 py-3">
					<p class="text-sm font-semibold text-text">Viewer runtimes</p>
					<p class="mt-1 text-xs text-text-subtle">
						Optional scientific visualization dependencies. Install only the runtimes needed by your workflows.
					</p>
				</div>
				<div class="divide-y divide-border">
					{#each viewerRuntimesStore.runtimes as runtime (runtime.id)}
						{@const progress = viewerRuntimeProgress[runtime.id]}
						{@const installable = runtime.install.kind === 'managed-script'}
						<div class="flex items-center gap-3 px-4 py-3">
							<span
								class="h-2 w-2 rounded-full shrink-0 {runtime.status === 'installed'
									? 'bg-emerald-500'
									: installable
									? 'bg-amber-400'
									: 'bg-border-2'}"
							></span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p class="truncate text-sm font-medium text-text">{runtime.name}</p>
									<span class="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">
										{runtime.capability}
									</span>
								</div>
								<p class="mt-1 text-xs text-text-muted">{runtime.description}</p>
								<p class="mt-1 text-[10px] text-text-subtle">
									{runtime.license}
									{#if runtime.localPath}
										<span class="font-mono" title={getLastSegmentsStringFromPath(runtime.localPath, 2)}>
											 · {getLastSegmentsStringFromPath(runtime.localPath, 2)}
										</span>
									{:else if runtime.install.note}
										 · {runtime.install.note}
									{/if}
								</p>
								{#if progress}
									<p class="mt-1 text-xs text-brand">{viewerProgressLabel(runtime.id)}</p>
								{/if}
							</div>
							<div class="flex shrink-0 items-center gap-2">
								{#if progress}
									<svg class="h-4 w-4 animate-spin text-brand" viewBox="0 0 24 24" fill="none">
										<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" />
										<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
									</svg>
								{:else if runtime.status === 'installed' && installable}
									<Button size="sm" variant="ghost" onclick={() => removeViewerRuntime(runtime.id)}>
										Remove
									</Button>
								{:else if installable}
									<Button size="sm" variant="primary" onclick={() => installViewerRuntime(runtime.id)}>
										Install
									</Button>
								{:else if runtime.install.docsUrl}
									<Button
										size="sm"
										variant="secondary"
										onclick={async () => { const api = liatir(); if (api) await api.openBrowser(runtime.install.docsUrl!); }}
									>
										Docs ↗
									</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</Card>

			<!-- Footer note -->
			{#if pmChecked}
				<p class="text-xs text-text-subtle text-center">
					{#if brewAvailable && condaAvailable}
						Homebrew and conda detected.
					{:else if brewAvailable}
						Homebrew detected.
					{:else if condaAvailable}
						conda detected.
					{:else}
						No package manager detected in PATH.
					{/if}
					"Download & Install" bundles precompiled binaries directly into Liatir — no package manager
					required.
				</p>
			{/if}
		{/if}
	</div>
	</PageContent>
</div>
