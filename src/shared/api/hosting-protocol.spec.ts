import { describe, expect, it } from 'vitest';
import {
  HOSTING_CAPABILITIES,
  HOSTING_OP_CAPABILITY,
  HOSTING_READ_OPS,
  HOSTING_REPOSITORY_OPS,
  HOSTING_WRITE_OPS,
  HostedRepositoryRef,
  HostingOp,
  isCompatibleHostingProtocol,
  isHostingAuthMode,
  isHostingCapability,
  parseRemoteUrl,
} from './hosting-protocol';

describe('parseRemoteUrl', () => {
  it('readsEveryRemoteFormGitAccepts', () => {
    const expected: HostedRepositoryRef = {
      host: 'github.com',
      owner: 'onix-labs',
      name: 'studio',
    };

    expect(parseRemoteUrl('https://github.com/onix-labs/studio.git')).toEqual(expected);
    expect(parseRemoteUrl('https://github.com/onix-labs/studio')).toEqual(expected);
    expect(parseRemoteUrl('git@github.com:onix-labs/studio.git')).toEqual(expected);
    expect(parseRemoteUrl('ssh://git@github.com/onix-labs/studio.git')).toEqual(expected);
    expect(parseRemoteUrl('  https://GitHub.com/onix-labs/studio/  ')).toEqual(expected);
  });

  it('keepsASelfHostedServersHostAndPort', () => {
    expect(parseRemoteUrl('https://ghe.example.com:8443/team/app.git')).toEqual({
      host: 'ghe.example.com',
      owner: 'team',
      name: 'app',
    });
  });

  it('readsNull_forWhatTheVocabularyDoesNotName', () => {
    // A GitLab subgroup is three segments deep; a bare host names no repository.
    expect(parseRemoteUrl('https://gitlab.com/group/sub/project.git')).toBeNull();
    expect(parseRemoteUrl('https://github.com/')).toBeNull();
    expect(parseRemoteUrl('/Users/me/repo')).toBeNull();
    expect(parseRemoteUrl('file:///Users/me/repo')).toBeNull();
    expect(parseRemoteUrl('not a url')).toBeNull();
  });
});

describe('the operation tables', () => {
  it('everyWrite_needsACapability', () => {
    // A write with no capability could not be hidden on a host that does not offer it.
    for (const op of HOSTING_WRITE_OPS) {
      expect(HOSTING_OP_CAPABILITY[op], op).toBeDefined();
    }
  });

  it('noOperation_isBothAReadAndAWrite', () => {
    expect(HOSTING_READ_OPS.filter((op: HostingOp) => HOSTING_WRITE_OPS.includes(op))).toEqual([]);
  });

  it('everyCapabilityAnOperationNeeds_isAKnownOne', () => {
    for (const capability of Object.values(HOSTING_OP_CAPABILITY)) {
      expect(HOSTING_CAPABILITIES).toContain(capability);
    }
  });

  it('cancelAndRerun_areSeparateCapabilities', () => {
    expect(HOSTING_OP_CAPABILITY.rerunCiRun).toBe('ciRerun');
    expect(HOSTING_OP_CAPABILITY.cancelCiRun).toBe('ciCancel');
  });

  it('describeRepository_isARepositoryRequestThatNeedsNoCapability', () => {
    expect(HOSTING_REPOSITORY_OPS).toContain('describeRepository');
    expect(HOSTING_OP_CAPABILITY.describeRepository).toBeUndefined();
  });
});

describe('the guards', () => {
  it('isCompatibleHostingProtocol_acceptsTheSameMajorOnly', () => {
    expect(isCompatibleHostingProtocol('1.0')).toBe(true);
    expect(isCompatibleHostingProtocol('1.7.2')).toBe(true);
    expect(isCompatibleHostingProtocol('2.0')).toBe(false);
    expect(isCompatibleHostingProtocol('one')).toBe(false);
    expect(isCompatibleHostingProtocol(1)).toBe(false);
  });

  it('isHostingCapability_andIsHostingAuthMode_knowOnlyTheClosedLists', () => {
    expect(isHostingCapability('ciCancel')).toBe(true);
    expect(isHostingCapability('teleport')).toBe(false);
    expect(isHostingAuthMode('cli')).toBe(true);
    expect(isHostingAuthMode('oauth')).toBe(false);
  });
});
