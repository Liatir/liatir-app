import { homebrewLinkConflictResolver } from './homebrew-link-conflict';
import { wrongToolResolver } from './wrong-tool';
import type {
  DependencyResolution,
  DependencyResolver,
  DependencyResolverInput,
} from './types';

const DEPENDENCY_RESOLVERS: DependencyResolver[] = [
  wrongToolResolver,
  homebrewLinkConflictResolver,
];

export function resolveDependency(input: DependencyResolverInput): DependencyResolution {
  const resolution: DependencyResolution = { messages: [], actions: [] };
  const seenMessages = new Set<string>();
  const seenActions = new Set<string>();

  for (const resolver of DEPENDENCY_RESOLVERS) {
    const partial = resolver(input);
    if (!partial) continue;

    for (const message of partial.messages) {
      if (seenMessages.has(message.id)) continue;
      seenMessages.add(message.id);
      resolution.messages.push(message);
    }
    for (const action of partial.actions) {
      if (seenActions.has(action.id)) continue;
      seenActions.add(action.id);
      resolution.actions.push(action);
    }
  }

  return resolution;
}

export {
  packageManagerInstallCommand,
  packageManagerUpdateCommand,
} from './package-manager';
export type {
  DependencyResolution,
  DependencyResolverAction,
  DependencyResolverCommand,
  DependencyResolverEnvironment,
  DependencyResolverInput,
  DependencyResolverMessage,
} from './types';
export { wrongToolMessage } from './wrong-tool';
