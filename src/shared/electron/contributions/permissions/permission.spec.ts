import { describe, expect, it } from 'vitest';
import { PermissionDeniedError, PermissionId, sanitizePermissions } from './permission';

describe('sanitizePermissions', () => {
  it('keepsKnownPermissionIds', () => {
    const result: ReadonlySet<PermissionId> = sanitizePermissions(['container.socket']);
    expect([...result]).toEqual(['container.socket']);
  });

  it('dropsUnknownOrMalformedIds', () => {
    const result: ReadonlySet<PermissionId> = sanitizePermissions([
      'container.socket',
      'net.raw',
      '',
      'DOCKER.SOCKET',
    ]);
    expect([...result]).toEqual(['container.socket']);
  });

  it('deduplicatesRepeatedIds', () => {
    const result: ReadonlySet<PermissionId> = sanitizePermissions([
      'container.socket',
      'container.socket',
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
      'containers',
      'container.socket',
      'undeclared',
    );
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PermissionDeniedError');
    expect(error.contributionId).toBe('containers');
    expect(error.permission).toBe('container.socket');
    expect(error.reason).toBe('undeclared');
    expect(error.message).toContain(
      "contribution 'containers' denied permission 'container.socket' (undeclared)",
    );
  });
});
