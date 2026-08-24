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

/**
 * Which package manager an already-installed binary plausibly belongs to, judged from where it sits.
 *
 * The judgement is deliberately one-sided: it answers "is this definitely *not* Homebrew's?" rather
 * than "is this Homebrew's?". Homebrew on Intel macOS links its binaries into `/usr/local/bin`, which
 * manual installs use too, so a path there is ambiguous and must stay eligible for `brew upgrade`.
 * A path under `~/.local/bin` (the Nextflow installer's default) or inside a conda prefix is not
 * ambiguous at all, and that is the case worth acting on.
 *
 * `null` means "no idea" — an unknown path, or none at all — and callers must then behave as if the
 * question had never been asked.
 */
export type DependencyOwner = 'brew' | 'conda' | 'other';

const BREW_PATH_MARKERS = ['/homebrew/', '/cellar/', '/linuxbrew/', '/usr/local/'];
const CONDA_PATH_MARKERS = ['/conda/', '/miniconda', '/anaconda', '/miniforge', '/mambaforge', '/envs/'];

export function dependencyOwner(path: string | null | undefined): DependencyOwner | null {
  if (!path) return null;
  // Windows reports backslashes; compare on one separator, case-insensitively, because macOS and
  // Windows filesystems are case-insensitive and `/Cellar/` would otherwise be missed as `/cellar/`.
  const normalized = path.replace(/\\/g, '/').toLowerCase();
  if (BREW_PATH_MARKERS.some((marker) => normalized.includes(marker))) return 'brew';
  if (CONDA_PATH_MARKERS.some((marker) => normalized.includes(marker))) return 'conda';
  return 'other';
}

/**
 * `installedPath` is where detection actually found the binary. Without it the result is the same as
 * it has always been; with it, a tool that no package manager installed is not offered an update
 * that can only fail — `brew upgrade nextflow` on a Nextflow installed by its own script reports
 * "nextflow not installed", which reads as if the tool the screen just called installed were gone.
 */
export function packageManagerUpdateCommand(
  req: DepRequirement | undefined,
  environment: DependencyResolverEnvironment,
  installedPath?: string | null,
): DependencyResolverCommand | null {
  if (!req) return null;
  const owner = dependencyOwner(installedPath);
  if (owner === 'other') return null;
  if (environment.brewAvailable && req.brew && owner !== 'conda') {
    return { cmd: 'brew', args: ['upgrade', req.brew] };
  }
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
