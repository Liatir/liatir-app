import type { DepRequirement } from '$lib/data/dep-requirements';
import type { DependencyResolverCommand, DependencyResolverEnvironment } from './types';

export function packageManagerInstallCommand(
  req: DepRequirement | undefined,
  environment: DependencyResolverEnvironment,
): DependencyResolverCommand | null {
  if (!req) return null;
  if (environment.brewAvailable && req.brew) return { cmd: 'brew', args: ['install', req.brew] };
  if (environment.condaAvailable && req.conda) {
    return {
      cmd: 'conda',
      args: ['install', '-c', req.condaChannel ?? 'bioconda', '-y', req.conda],
    };
  }
  return null;
}

export function packageManagerUpdateCommand(
  req: DepRequirement | undefined,
  environment: DependencyResolverEnvironment,
): DependencyResolverCommand | null {
  if (!req) return null;
  if (environment.brewAvailable && req.brew) return { cmd: 'brew', args: ['upgrade', req.brew] };
  if (environment.condaAvailable && req.conda) {
    return {
      cmd: 'conda',
      args: ['install', '-c', req.condaChannel ?? 'bioconda', '-y', req.conda],
    };
  }
  return null;
}
