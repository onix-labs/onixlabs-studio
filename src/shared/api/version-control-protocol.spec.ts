import { describe, expect, it } from 'vitest';
import {
  isCompatibleVersionControlProtocol,
  isVersionControlCapability,
  VCS_GLOBAL_OPS,
  VCS_NETWORK_OPS,
  VCS_OP_CAPABILITY,
  VCS_READ_OPS,
  VCS_REPOSITORY_OPS,
  VersionControlOp,
} from './version-control-protocol';

/**
 * Every operation, as a record so the compiler fails when one is added without being listed here.
 */
const EVERY_OP: Readonly<Record<VersionControlOp, true>> = {
  initialize: true,
  resolveRoot: true,
  status: true,
  operationState: true,
  log: true,
  refs: true,
  stashes: true,
  commitFiles: true,
  readFile: true,
  discard: true,
  stage: true,
  unstage: true,
  commit: true,
  stash: true,
  stashApply: true,
  stashPop: true,
  stashDrop: true,
  checkout: true,
  createBranch: true,
  deleteBranch: true,
  renameBranch: true,
  setUpstream: true,
  fetch: true,
  fetchRef: true,
  pull: true,
  push: true,
  fetchRemote: true,
  pruneRemote: true,
  addRemote: true,
  removeRemote: true,
  checkoutTracking: true,
  merge: true,
  rebase: true,
  operationContinue: true,
  operationSkip: true,
  operationAbort: true,
  createTag: true,
  deleteTag: true,
  deleteRemoteTag: true,
  pushTag: true,
  pushAllTags: true,
  clone: true,
  getIdentity: true,
  setIdentity: true,
};

describe('isCompatibleVersionControlProtocol', () => {
  it('isCompatible_whenTheMajorMatches', () => {
    expect(isCompatibleVersionControlProtocol('1.0')).toBe(true);
    expect(isCompatibleVersionControlProtocol('1.7')).toBe(true);
  });

  it('isIncompatible_whenTheMajorDiffersOrTheVersionIsNotOne', () => {
    expect(isCompatibleVersionControlProtocol('2.0')).toBe(false);
    expect(isCompatibleVersionControlProtocol('one')).toBe(false);
    expect(isCompatibleVersionControlProtocol(1)).toBe(false);
  });
});

describe('isVersionControlCapability', () => {
  it('knowsTheClosedList', () => {
    expect(isVersionControlCapability('parallelCheckouts')).toBe(true);
    expect(isVersionControlCapability('teleport')).toBe(false);
  });
});

describe('operation tables', () => {
  it('noWriteIsTreatedAsARead', () => {
    // A write shared between two callers would run once for both — the second caller's write would
    // silently not happen.
    for (const op of VCS_READ_OPS) {
      expect(VCS_OP_CAPABILITY[op] === undefined || op === 'getIdentity').toBe(true);
    }
    expect(VCS_READ_OPS).not.toContain('commit');
    expect(VCS_READ_OPS).not.toContain('stage');
  });

  it('everyOperationIsEitherARepositoryOrAGlobalOne_neverBoth', () => {
    // The renderer may send exactly the repository operations; an operation in neither list could
    // never be reached, and one in both would let the renderer send a global one.
    const listed: readonly VersionControlOp[] = [...VCS_REPOSITORY_OPS, ...VCS_GLOBAL_OPS];
    expect([...listed].sort()).toEqual(Object.keys(EVERY_OP).sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it('cloneIsGlobalNetworkedAndNeedsTheCloneCapability', () => {
    expect(VCS_GLOBAL_OPS).toContain('clone');
    expect(VCS_NETWORK_OPS).toContain('clone');
    expect(VCS_OP_CAPABILITY.clone).toBe('clone');
  });
});
