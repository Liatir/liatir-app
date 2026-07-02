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
	import { managedBins } from '$lib/stores/managedBins.svelte';
	import { installProgress } from '$lib/stores/installProgress.svelte';
	import { viewerRuntimesStore } from '$lib/stores/viewerRuntimes.svelte';
	import { confirm } from '$lib/stores/confirm.svelte';
	import { toast } from '$lib/stores/toast.svelte';
	import { liatir } from '$lib/api';
	import { runNativeTool } from '$lib/utils/native-tool';
	import { getLastSegmentsStringFromPath, sanitizeLocalPathsForDisplay } from '$lib/utils';
	import {
		getRelease,
		installBinary,
		type OsPlatform,
		type Arch
	} from '$lib/tools/binary-manager';
	import {
		DEP_REQUIREMENTS,
		depRequirementForBinary,
		depRequirementLabel,
		depScope,
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
	import { versionGte, versionLt } from '$lib/utils/versions';
	import PageContent from '$lib/components/layout/PageContent.svelte';

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
	let platformOs = $state<OsPlatform>('macos');
	let platformArch = $state<Arch>('x86_64');
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
		await managedBins.init();
		await viewerRuntimesStore.init();

		const api = liatir();
		if (api) {
			const info = await api.desktop.app.info();
			platformOs = info.os as OsPlatform;
			platformArch = (info.arch === 'aarch64' ? 'arm64' : 'x86_64') as Arch;

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

	// ── download install (precompiled binary) ──────────────────────────
	async function downloadInstall(binary: string) {
		const label = depRequirementForBinary(binary)?.label ?? binary;
		setToolState(binary, {
			phase: 'downloading',
			error: null,
			bytesDownloaded: 0,
			bytesTotal: null
		});
		installProgress.start(binary, label);
		try {
			await installBinary(binary, platformOs, platformArch, (p) => {
				if (p.phase === 'downloading') {
					setToolState(binary, {
						phase: 'downloading',
						bytesDownloaded: p.bytesDownloaded,
						bytesTotal: p.bytesTotal
					});
					installProgress.update(binary, {
						phase: 'downloading',
						bytesDownloaded: p.bytesDownloaded,
						bytesTotal: p.bytesTotal
					});
				} else if (p.phase === 'extracting') {
					setToolState(binary, { phase: 'extracting' });
					installProgress.update(binary, { phase: 'extracting' });
				} else if (p.phase === 'done') {
					setToolState(binary, { phase: 'done' });
				}
			});
			await depsStore.recheckOne(binary);
			installProgress.done(binary);
		} catch (e) {
			setToolState(binary, { phase: 'error', error: String(e) });
			installProgress.error(binary, String(e));
		}
	}

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
		setToolState(binary, { phase: 'pm-installing', error: null, pmLog: [], pmOperation: operation, showLog: true });
		installProgress.start(binary, label);
		installProgress.update(binary, { phase: 'pm-installing' });
		try {
			setToolState(binary, { pmLog: [`$ ${cmd.cmd} ${cmd.args.join(' ')}`] });
			const result = await runNativeTool(cmd.cmd, cmd.args, (line) => {
				appendToolLog(binary, line);
			}, (line) => {
				appendToolLog(binary, line);
			}, { env: pmRunEnv(cmd.cmd) });
			if (!result.ok) {
				const msg = result.stderr || `Exited ${result.exitCode}`;
				setToolState(binary, { phase: 'error', error: msg });
				installProgress.error(binary, msg);
			} else {
				setToolState(binary, { phase: 'done' });
				await depsStore.recheckOne(binary);
				installProgress.done(binary);
			}
		} catch (e) {
			setToolState(binary, { phase: 'error', error: String(e) });
			installProgress.error(binary, String(e));
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
		setToolState(binary, {
			phase: 'pm-installing',
			error: null,
			pmLog: [],
			pmOperation: 'update',
			showLog: true,
		});
		installProgress.start(binary, label);
		installProgress.update(binary, { phase: 'pm-installing' });

		try {
			for (const command of action.commands) {
				appendToolLog(binary, `$ ${command.cmd} ${command.args.join(' ')}`);
				const result = await runNativeTool(
					command.cmd,
					command.args,
					(line) => appendToolLog(binary, line),
					(line) => appendToolLog(binary, line),
					{ env: pmRunEnv(command.cmd) },
				);
				if (!result.ok) {
					const msg = result.stderr || result.stdout || `Exited ${result.exitCode}`;
					setToolState(binary, { phase: 'error', error: msg });
					installProgress.error(binary, msg);
					return;
				}
			}
			setToolState(binary, { phase: 'done' });
			await depsStore.recheckOne(binary);
			installProgress.done(binary);
		} catch (e) {
			setToolState(binary, { phase: 'error', error: String(e) });
			installProgress.error(binary, String(e));
		}
	}

	async function updateRelatedTool(dep: DepResult, tool: RelatedDependencyTool) {
		if (tool.id !== 'pip') return;
		const key = relatedToolStateKey(dep.binary, tool.id);
		const manager = pythonPackageManager(dep);
		const managedCmd =
			manager === 'brew'
				? { cmd: 'brew', args: ['upgrade', DEP_REQUIREMENTS.python.brew ?? 'python@3.12'] }
				: manager === 'conda'
					? { cmd: 'conda', args: ['install', '-c', 'conda-forge', '-y', 'pip'] }
					: null;
		if (managedCmd) {
			setToolState(key, {
				phase: 'pm-installing',
				error: null,
				pmLog: [
					`$ ${managedCmd.cmd} ${managedCmd.args.join(' ')}`,
					relatedToolRuntimeNote(dep, tool) ?? ''
				].filter(Boolean),
				pmOperation: 'update',
				showLog: true
			});

			try {
				const result = await runNativeTool(managedCmd.cmd, managedCmd.args, (line) => {
					appendToolLog(key, line);
				}, (line) => {
					appendToolLog(key, line);
				}, { env: pmRunEnv(managedCmd.cmd) });
				if (!result.ok) {
					const msg = result.stderr || result.stdout || `Exited ${result.exitCode}`;
					setToolState(key, { phase: 'error', error: msg });
					return;
				}
				setToolState(key, { phase: 'done' });
				await depsStore.recheckOne(dep.binary);
			} catch (e) {
				setToolState(key, { phase: 'error', error: String(e) });
			}
			return;
		}

		const python = dep.path ?? dep.binary;
		const args = ['-m', 'pip', 'install', '--upgrade', 'pip'];
		setToolState(key, {
			phase: 'pm-installing',
			error: null,
			pmLog: [`$ ${getLastSegmentsStringFromPath(python, 2)} ${args.join(' ')}`],
			pmOperation: 'update',
			showLog: true
		});

		try {
			const result = await runNativeTool(python, args, (line) => {
				appendToolLog(key, line);
			}, (line) => {
				appendToolLog(key, line);
			});
			if (!result.ok) {
				const rawMsg = result.stderr || result.stdout || `Exited ${result.exitCode}`;
				const msg = rawMsg.includes('externally-managed-environment')
					? 'This Python environment is externally managed. Update pip through the Python package manager, or use a virtual environment. Liatir managed AI runtimes already create isolated Python environments for model dependencies.'
					: rawMsg;
				setToolState(key, { phase: 'error', error: msg });
				return;
			}
			setToolState(key, { phase: 'done' });
		} catch (e) {
			setToolState(key, { phase: 'error', error: String(e) });
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

	function dependencyVersionOk(version: string | null, req: DepRequirement | undefined): boolean {
		if (!req || !version) return true;
		if (!versionGte(version, req.minVersion)) return false;
		if (req.maxVersionExclusive && !versionLt(version, req.maxVersionExclusive)) return false;
		return true;
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
		const managed = managedBins.get(dep.binary);
		if (!dep.available && !managed) return true;
		return dep.available && !!dep.version && !dependencyVersionOk(dep.version, req);
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
					<p class="text-sm text-zinc-500">Checking dependencies…</p>
				</div>
		{:else if !depsStore.checked}
			<div class="flex flex-col items-center gap-4 py-16">
				<p class="text-sm text-zinc-600">No check has been run yet.</p>
				<Button variant="primary" onclick={() => depsStore.checkAll(focusedDependencies)}>Check Dependencies</Button>
			</div>
		{:else}
			<!-- Summary -->
			<div class="grid grid-cols-3 gap-3">
				<Card class="p-4">
					<p class="text-xs text-zinc-500 mb-1">Available</p>
					<p class="text-2xl font-semibold text-emerald-500">{depsStore.availableCount}</p>
					<p class="text-xs text-zinc-400 mt-1">of {depsStore.results.length} dependencies</p>
				</Card>
				<Card class="p-4">
					<p class="text-xs text-zinc-500 mb-1">Core issues</p>
					<p class="text-2xl font-semibold {needsActionCount > 0 ? 'text-red-400' : 'text-zinc-400'}">
						{needsActionCount}
					</p>
					<p class="text-xs text-zinc-400 mt-1">runtime essentials</p>
				</Card>
				<Card class="p-4">
					<p class="text-xs text-zinc-500 mb-1">Checked</p>
					<p class="text-2xl font-semibold text-zinc-900">{depsStore.results.length}</p>
					<p class="text-xs text-zinc-400 mt-1">total</p>
				</Card>
										</div>

			<div class="flex justify-center gap-2 items-center w-full cursor-default group">
				<div class="w-full h-px bg-zinc-200 group-hover:bg-zinc-300"></div>
				<div class="min-w-fit text-[11px] text-zinc-400 text-center group-hover:text-zinc-600">
					Dependencies are installed globally, therefore available to all workspaces
				</div>
				<div class="w-full h-px bg-zinc-200 group-hover:bg-zinc-300"></div>
			</div>

			{#if focusedDependency}
				<div class="rounded-lg border border-brand/20 bg-brand/5 px-4 py-3 text-sm text-zinc-700">
					<p class="font-medium text-zinc-800">Resolve dependency</p>
					<p class="mt-1 text-xs text-zinc-500">
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
							{@const hasRelease = !!getRelease(dep.binary, platformOs, platformArch)}
							{@const hasPm = !!pmInstallCmd(dep.binary)}
							{@const managed = managedBins.get(dep.binary)}
							{@const isBusy =
								state.phase === 'downloading' ||
								state.phase === 'extracting' ||
								state.phase === 'pm-installing'}
							{@const versionOk = !dep.available || dependencyVersionOk(dep.version, req)}
							{@const isUnsupportedVersion = dep.available && !!dep.version && !versionOk}
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
											: dep.available || managed
											? 'bg-emerald-500'
											: !isCore || isSoft
											? 'bg-zinc-300'
											: 'bg-red-400'}"
									></span>

									<!-- Binary name -->
									<p class="text-sm font-mono font-medium text-zinc-800 w-24 shrink-0">
										{dep.binary}
									</p>

									<!-- Info popup -->
									{#if req}
										<InfoPopup text="{req.label} — {req.description}" />
									{/if}

									<!-- Status message -->
									<div class="flex-1 min-w-0">
										{#if managed && !dep.available}
											<p class="text-xs text-emerald-600 truncate">
												Managed v{managed.version} —
												<span class="font-mono text-zinc-400" title={getLastSegmentsStringFromPath(managed.path, 2)}>
													{getLastSegmentsStringFromPath(managed.path, 2)}
												</span>
											</p>
										{:else if dep.available}
											{#if isUnsupportedVersion && req}
												{#if primaryResolutionMessage}
													<p class="text-xs text-amber-600">{primaryResolutionMessage}</p>
												{:else}
													<p class="text-xs text-amber-600 truncate">
														{dep.version} — requires {requirementLabel(req)}
													</p>
												{/if}
											{:else if dep.version}
												<p class="text-xs font-mono text-zinc-500 truncate" data-selectable>
													{dep.version}{req ? ` (requires ${requirementLabel(req)})` : ''}
												</p>
											{:else if dep.path}
												<p class="text-xs font-mono text-zinc-400 truncate" data-selectable>
													<span title={getLastSegmentsStringFromPath(dep.path, 2)}>{getLastSegmentsStringFromPath(dep.path, 2)}</span>
												</p>
											{:else}
												<p class="text-xs text-zinc-400">Found in PATH</p>
											{/if}
											{#if isSoft || !isCore}
												<p class="mt-1 text-[10px] text-zinc-400">{dependencyKindLabel(dep.binary)}</p>
											{/if}
										{:else if state.phase === 'downloading'}
											<p class="text-xs text-brand">
												Downloading…
												{#if state.bytesTotal}
													{fmtBytes(state.bytesDownloaded)} / {fmtBytes(state.bytesTotal)}
												{:else}
													{fmtBytes(state.bytesDownloaded)}
												{/if}
											</p>
										{:else if state.phase === 'extracting'}
											<p class="text-xs text-brand">Extracting…</p>
										{:else if state.phase === 'pm-installing'}
											<p class="text-xs text-brand">{state.pmOperation === 'update' ? 'Checking for update' : 'Installing'} via {pmLabel()}…</p>
										{:else if state.phase === 'done'}
											<p class="text-xs text-emerald-600">Installed successfully</p>
										{:else if state.phase === 'error'}
											<p class="text-xs text-red-500 truncate">{sanitizeLocalPathsForDisplay(state.error ?? 'Install failed.', 2)}</p>
										{:else}
											{#if isSoft || !isCore}
												<p class="text-xs text-zinc-400">
													Install when needed by {isSoft ? 'an AI Model' : 'a tool'}
													{#if pmChecked && !hasRelease && !hasPm}
														— use <span class="font-mono">brew</span>,
														<span class="font-mono">conda</span>, or
														<span class="font-mono">apt</span>
													{/if}
												</p>
											{:else}
												<p class="text-xs text-zinc-400">
													Not found in PATH
													{#if pmChecked && !hasRelease && !hasPm}
														— install via <span class="font-mono">brew</span>,
														<span class="font-mono">conda</span>, or
														<span class="font-mono">apt</span>
													{/if}
												</p>
											{/if}
										{/if}
										{#if req?.reason && (isUnsupportedVersion || isSoft || !isCore || dep.binary === 'python')}
											<p class="mt-1 text-[10px] text-zinc-400">{req.reason}</p>
										{/if}
									</div>

									<!-- Toggle log -->
									{#if (state.pmLog.length > 0 || state.phase === 'error') && !isBusy}
										<button
											onclick={() => setToolState(dep.binary, { showLog: !state.showLog })}
											class="text-[10px] text-zinc-400 hover:text-zinc-600 transition-colors shrink-0 font-mono"
										>
											{state.showLog ? 'hide' : 'log'}
										</button>
									{/if}

									<!-- Action buttons -->
									{#if (isUnsupportedVersion || (!dep.available && !managed)) && pmChecked && !isBusy}
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
												{#if hasRelease}
													<Button
														variant="primary"
														size="sm"
														onclick={() => downloadInstall(dep.binary)}
													>
														{dep.available || managed ? 'Download & Update' : 'Download & Install'}
													</Button>
												{/if}
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
										<div class="shrink-0">
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
										</div>
									{:else if !isBusy && (dep.available || managed) && pmChecked}
										<div class="flex items-center gap-2 shrink-0">
											<p class="text-xs text-zinc-400">Installed</p>
											{#if managed && hasRelease}
												<Button variant="secondary" size="sm" onclick={() => downloadInstall(dep.binary)}>
													Update
												</Button>
											{/if}
											{#if dep.available && canUpdateWithPm}
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
											class="flex w-full items-center justify-between rounded-lg border border-border bg-zinc-50 px-2.5 py-1 font-light text-left text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors hover:bg-zinc-100"
											aria-expanded={isRelatedExpanded}
											onclick={() => toggleRelatedTools(dep.binary)}
										>
											<span class="font-medium">Related deps</span>
											<span class="font-mono text-[10px] text-zinc-400">
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
													<div class="rounded-lg border border-border bg-white px-3 py-3">
														<div class="flex items-start gap-3">
															<span
																class="mt-1 h-2 w-2 rounded-full shrink-0 {relatedState.phase === 'error'
																	? 'bg-red-400'
																	: relatedState.phase === 'done'
																	? 'bg-emerald-500'
																	: dep.available
																	? 'bg-zinc-300'
																	: 'bg-red-400'}"
															></span>
															<div class="min-w-0 flex-1">
																<div class="flex items-center gap-2">
																	<p class="truncate text-sm font-mono font-medium text-zinc-800">
																		{relatedTool.label}
																	</p>
																	<InfoPopup text="{relatedTool.label} — {relatedTool.description}" />
																</div>
																<p class="mt-1 text-xs text-zinc-500">{relatedTool.description}</p>
																{#if runtimeNote}
																	<p class="mt-1 text-[10px] leading-snug text-zinc-400">{runtimeNote}</p>
																{/if}
																{#if dep.available && dep.path}
																	<p class="mt-1 text-[10px] text-zinc-400">
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
																		class="text-[10px] text-zinc-400 transition-colors hover:text-zinc-600 shrink-0 font-mono"
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
																	<p class="text-[11px] font-mono text-zinc-300 leading-relaxed">
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
					<p class="text-sm font-semibold text-zinc-800">Viewer runtimes</p>
					<p class="mt-1 text-xs text-zinc-400">
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
									: 'bg-zinc-300'}"
							></span>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p class="truncate text-sm font-medium text-zinc-800">{runtime.name}</p>
									<span class="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[10px] text-zinc-500">
										{runtime.capability}
									</span>
								</div>
								<p class="mt-1 text-xs text-zinc-500">{runtime.description}</p>
								<p class="mt-1 text-[10px] text-zinc-400">
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
				<p class="text-xs text-zinc-400 text-center">
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
