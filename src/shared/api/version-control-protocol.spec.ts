import { describe, expect, it } from 'vitest';
import {
  isCompatibleVersionControlProtocol,
  isVersionControlCapability,
  VCS_GLOBAL_OPS,
  VCS_NETWORK_OPS,
  VCS_OP_CAPABILITY,
  VCS_READ_OPS,
} from './version-control-protocol';

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

  it('cloneIsGlobalNetworkedAndNeedsTheCloneCapability', () => {
    expect(VCS_GLOBAL_OPS).toContain('clone');
    expect(VCS_NETWORK_OPS).toContain('clone');
    expect(VCS_OP_CAPABILITY.clone).toBe('clone');
  });
});
