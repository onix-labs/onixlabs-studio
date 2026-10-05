import { VERSION_CONTROL_CAPABILITIES } from '@shared/api/version-control-protocol';
import { VersionControlDescriptor } from '../version-control-descriptor';
import { GitVersionControl } from './git-version-control';

/**
 * Describes core's own git as a version-control plugin would be described (#816).
 *
 * ⚠️ Temporary. Core still answers for git while the seam is proven, and this is the last place it
 * does: #817 publishes the same code as the Git plugin and deletes this. It sits at the lowest
 * priority, so an installed plugin claiming `.git` already wins.
 * @returns Returns the descriptor.
 */
export function coreGitDescriptor(): VersionControlDescriptor {
  return {
    id: 'core.git',
    displayName: 'Git',
    priority: Number.MIN_SAFE_INTEGER,
    markers: ['.git'],
    metadataDirectories: ['.git'],
    capabilities: VERSION_CONTROL_CAPABILITIES,
    executableModes: ['installed', 'custom'],
    resolve: () => ({ available: true, create: () => new GitVersionControl() }),
  };
}
