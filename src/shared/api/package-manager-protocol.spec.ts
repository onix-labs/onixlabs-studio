import { describe, expect, it } from 'vitest';
import {
  isCompatiblePackageManagerProtocol,
  isPackageManagerCapability,
  PACKAGE_MANAGER_CAPABILITIES,
  PackageManagerOp,
  PM_OP_CAPABILITY,
  PM_READ_OPS,
  PM_WRITE_OPS,
} from './package-manager-protocol';

/**
 * Every operation, as a record so the compiler fails when one is added without being listed here.
 */
const EVERY_OP: Readonly<Record<PackageManagerOp, true>> = {
  initialize: true,
  load: true,
  sources: true,
  search: true,
  install: true,
  update: true,
  remove: true,
  restore: true,
};

describe('package-manager protocol', () => {
  it('isCompatiblePackageManagerProtocol_acceptsTheSameMajorOnly', () => {
    expect(isCompatiblePackageManagerProtocol('1.0')).toBe(true);
    expect(isCompatiblePackageManagerProtocol('1.7')).toBe(true);
    expect(isCompatiblePackageManagerProtocol('2.0')).toBe(false);
  });

  it('isCompatiblePackageManagerProtocol_refusesWhatIsNotAVersion', () => {
    expect(isCompatiblePackageManagerProtocol('one')).toBe(false);
    expect(isCompatiblePackageManagerProtocol(1)).toBe(false);
    expect(isCompatiblePackageManagerProtocol(undefined)).toBe(false);
  });

  it('isPackageManagerCapability_knowsTheClosedListOnly', () => {
    for (const capability of PACKAGE_MANAGER_CAPABILITIES) {
      expect(isPackageManagerCapability(capability)).toBe(true);
    }
    expect(isPackageManagerCapability('publish')).toBe(false);
    expect(isPackageManagerCapability(7)).toBe(false);
  });

  it('readAndWriteOps_doNotOverlap', () => {
    for (const op of PM_WRITE_OPS) {
      expect(PM_READ_OPS).not.toContain(op);
    }
  });

  it('everyWriteOp_needsACapability', () => {
    for (const op of PM_WRITE_OPS) {
      expect(PM_OP_CAPABILITY[op]).toBeDefined();
    }
  });

  it('theHandshakeAndLoad_needNoCapability', () => {
    expect(PM_OP_CAPABILITY.initialize).toBeUndefined();
    expect(PM_OP_CAPABILITY.load).toBeUndefined();
  });

  it('everyOp_isEitherTheHandshakeARead_orAWrite', () => {
    const listed: readonly PackageManagerOp[] = ['initialize', ...PM_READ_OPS, ...PM_WRITE_OPS];

    expect([...listed].sort()).toEqual(Object.keys(EVERY_OP).sort());
  });
});
