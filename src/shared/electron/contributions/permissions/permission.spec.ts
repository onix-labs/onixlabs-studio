import { describe, expect, it } from 'vitest';
import { PermissionDeniedError, PermissionId, sanitizePermissions } from './permission';

describe('sanitizePermissions', () => {
  it('keepsKnownPermissionIds', () => {
    const result: ReadonlySet<PermissionId> = sanitizePermissions(['docker.socket']);
    expect([...result]).toEqual(['docker.socket']);
  });

  it('dropsUnknownOrMalformedIds', () => {
    const result: ReadonlySet<PermissionId> = sanitizePermissions([
      'docker.socket',
      'net.raw',
      '',
      'DOCKER.SOCKET',
    ]);
    expect([...result]).toEqual(['docker.socket']);
  });

  it('deduplicatesRepeatedIds', () => {
    const result: ReadonlySet<PermissionId> = sanitizePermissions([
      'docker.socket',
      'docker.socket',
    ]);
    expect(result.size).toBe(1);
  });

  it('treatsUndefinedAsNoDeclaredPermissions', () => {
    expect(sanitizePermissions(undefined).size).toBe(0);
  });
});

describe('PermissionDeniedError', () => {
  it('carriesTheContributionPermissionAndReasonInMessageAndFields', () => {
    const error: PermissionDeniedError = new PermissionDeniedError(
      'docker',
      'docker.socket',
      'undeclared',
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PermissionDeniedError');
    expect(error.contributionId).toBe('docker');
    expect(error.permission).toBe('docker.socket');
    expect(error.reason).toBe('undeclared');
    expect(error.message).toContain(
      "contribution 'docker' denied permission 'docker.socket' (undeclared)",
    );
  });
});
