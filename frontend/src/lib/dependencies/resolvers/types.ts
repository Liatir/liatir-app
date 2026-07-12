/**
 * Contracts for the dependency resolvers.
 *
 * A resolver diagnoses *why* a dependency is unusable and proposes what to do about it. "samtools is
 * missing" is not actionable for a biologist; "Homebrew installed it but did not link it — click here
 * to run `brew link samtools`" is. That difference is what this whole subsystem exists for.
 *
 * A resolver is a pure function: same input, same diagnosis, and it never executes anything itself.
 * It only *describes* the commands, which the UI then runs after the user confirms.
 */
import type { DepRequirement } from '$lib/data/dep-requirements';
import type { DepResult } from '$lib/stores/deps.svelte';

/** What is available to fix things with — a resolver must not propose brew if brew is not installed. */
export interface DependencyResolverEnvironment {
  brewAvailable: boolean;
  condaAvailable: boolean;
}

export interface DependencyResolverInput {
  /** What detection actually found (or failed to find). */
  dep: DepResult;
  /** What the app expects of it, if anything is declared. */
  requirement?: DepRequirement;
  environment: DependencyResolverEnvironment;
}

export interface DependencyResolverMessage {
  /** Stable ID — used to deduplicate when two resolvers reach the same conclusion. */
  id: string;
  severity: 'info' | 'warning' | 'error';
  text: string;
}

export interface DependencyResolverCommand {
  cmd: string;
  args: string[];
}

/**
 * A fix the user can apply with one click.
 *
 * The `confirm*` fields exist because some of these commands modify the user's system outside
 * Liatir. Anything with that reach must be shown and accepted before it runs, never applied silently.
 */
export interface DependencyResolverAction {
  id: string;
  label: string;
  variant?: 'primary' | 'secondary';
  confirmTitle?: string;
  confirmMessage?: string;
  confirmLabel?: string;
  commands: DependencyResolverCommand[];
}

export interface DependencyResolution {
  messages: DependencyResolverMessage[];
  actions: DependencyResolverAction[];
}

/** `null` means "this resolver has nothing to say about this dependency" — the normal case. */
export type DependencyResolver = (input: DependencyResolverInput) => DependencyResolution | null;

export const EMPTY_DEPENDENCY_RESOLUTION: DependencyResolution = {
  messages: [],
  actions: [],
};
