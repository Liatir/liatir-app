import type { DepRequirement } from '$lib/data/dep-requirements';
import type { DepResult } from '$lib/stores/deps.svelte';

export interface DependencyResolverEnvironment {
  brewAvailable: boolean;
  condaAvailable: boolean;
}

export interface DependencyResolverInput {
  dep: DepResult;
  requirement?: DepRequirement;
  environment: DependencyResolverEnvironment;
}

export interface DependencyResolverMessage {
  id: string;
  severity: 'info' | 'warning' | 'error';
  text: string;
}

export interface DependencyResolverCommand {
  cmd: string;
  args: string[];
}

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

export type DependencyResolver = (input: DependencyResolverInput) => DependencyResolution | null;

export const EMPTY_DEPENDENCY_RESOLUTION: DependencyResolution = {
  messages: [],
  actions: [],
};
