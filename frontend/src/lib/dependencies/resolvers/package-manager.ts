/**
 * Builds the package-manager command to install or update a dependency.
 *
 * Homebrew is preferred over conda when both are present: it installs system-wide onto PATH, which is
 * where Liatir looks, whereas conda installs into whichever environment happens to be active — so a
 * conda install can succeed and still leave the tool invisible to the app.
 *
 * `null` means neither manager can supply this dependency, and the UI must fall back to a managed
 * download or to asking the user to install it themselves.
 */
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
      // bioconda by default — it is where nearly every bioinformatics package lives. `-y` is required
      // because the command runs non-interactively and would otherwise hang waiting for a prompt.
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
    // conda has no distinct "upgrade": re-running install resolves to the newest available version,
    // so the update command is deliberately identical to the install one.
    return {
      cmd: 'conda',
      args: ['install', '-c', req.condaChannel ?? 'bioconda', '-y', req.conda],
    };
  }
  return null;
}
