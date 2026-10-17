import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WorkspaceContext } from '../workspace-context';
import { checkRunRoot, type RunRootCheck } from './run-root-guard';

/**
 * A registry with one open workspace root.
 */
interface OpenWorkspace {
  readonly open: WorkspaceContext;
  readonly root: string;
}

/**
 * Builds a registry with one open workspace root (a worktree container, say) under the temp folder.
 * @returns Returns the registry and the root it holds.
 */
function openWorkspace(): OpenWorkspace {
  const root: string = path.join(os.tmpdir(), 'studio-run-root', 'container');
  const open: WorkspaceContext = new WorkspaceContext();
  open.addRoot(root);
  return { open, root };
}

describe('checkRunRoot', () => {
  it('checkRunRoot_whenNoRoot_accepts', () => {
    expect(checkRunRoot(null, new WorkspaceContext())).toEqual({ ok: true });
  });

  it('checkRunRoot_whenAnOpenRoot_accepts', () => {
    const { open, root }: OpenWorkspace = openWorkspace();
    expect(checkRunRoot(root, open)).toEqual({ ok: true });
  });

  it('checkRunRoot_whenACheckoutInsideAnOpenContainer_accepts', () => {
    const { open, root }: OpenWorkspace = openWorkspace();
    expect(checkRunRoot(path.join(root, 'feature-branch'), open)).toEqual({ ok: true });
  });

  it('checkRunRoot_whenNotOpen_refuses', () => {
    const { open }: OpenWorkspace = openWorkspace();
    const check: RunRootCheck = checkRunRoot(path.join(os.tmpdir(), 'elsewhere'), open);
    expect(check.ok).toBe(false);
    expect(check.ok ? '' : check.detail).toContain("isn't an open workspace");
  });

  it('checkRunRoot_whenTraversalEscapesTheRoot_refuses', () => {
    const { open, root }: OpenWorkspace = openWorkspace();
    expect(checkRunRoot(path.join(root, '..', '..', 'escape'), open).ok).toBe(false);
  });

  it('checkRunRoot_whenASiblingSharesTheRootsPrefix_refuses', () => {
    const { open, root }: OpenWorkspace = openWorkspace();
    expect(checkRunRoot(`${root}-sibling`, open).ok).toBe(false);
  });

  it('checkRunRoot_whenRelativeOrEmpty_refuses', () => {
    const { open }: OpenWorkspace = openWorkspace();
    expect(checkRunRoot('.', open).ok).toBe(false);
    expect(checkRunRoot('', open).ok).toBe(false);
  });

  it('checkRunRoot_whenNothingIsOpen_refuses', () => {
    const { root }: OpenWorkspace = openWorkspace();
    expect(checkRunRoot(root, new WorkspaceContext()).ok).toBe(false);
  });
});
