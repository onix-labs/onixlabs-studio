import { ForgeRepositoryRef } from '@shared/api/forge-types';
import { detectForge } from './forge-detection';

describe('detectForge', () => {
  const expected: ForgeRepositoryRef = {
    kind: 'github',
    host: 'github.com',
    owner: 'onix-labs',
    name: 'onixlabs-studio',
  };

  it('resolvesAnHttpsRemote', () => {
    expect(detectForge('https://github.com/onix-labs/onixlabs-studio.git')).toEqual(expected);
  });

  it('resolvesAnHttpsRemote_withoutTheGitSuffix', () => {
    expect(detectForge('https://github.com/onix-labs/onixlabs-studio')).toEqual(expected);
  });

  it('resolvesTheScpLikeSshRemote', () => {
    // `git@github.com:owner/repo.git` is not a URL and cannot be parsed as one, but it is what git
    // writes for an SSH clone — so it is the form most likely to be in a real repository.
    expect(detectForge('git@github.com:onix-labs/onixlabs-studio.git')).toEqual(expected);
  });

  it('resolvesAnExplicitSshUrl', () => {
    expect(detectForge('ssh://git@github.com/onix-labs/onixlabs-studio.git')).toEqual(expected);
  });

  it('resolvesARemoteWithAPort', () => {
    expect(detectForge('ssh://git@github.com:22/onix-labs/onixlabs-studio.git')).toEqual(expected);
  });

  it('normalisesTheHostCase', () => {
    expect(detectForge('https://GitHub.com/onix-labs/onixlabs-studio.git')).toEqual(expected);
  });

  it('trimsSurroundingWhitespace', () => {
    expect(detectForge('  https://github.com/onix-labs/onixlabs-studio.git\n')).toEqual(expected);
  });

  it('declinesAnUnrecognisedHost', () => {
    // A self-hosted instance is not assumed to be GitHub merely because it is unfamiliar; recognising
    // one will mean the user naming it.
    expect(detectForge('https://git.example.com/onix-labs/onixlabs-studio.git')).toBeNull();
    expect(detectForge('git@gitlab.com:onix-labs/onixlabs-studio.git')).toBeNull();
  });

  it('declinesAPathThatIsNotOwnerAndRepository', () => {
    expect(detectForge('https://github.com/onix-labs')).toBeNull();
    expect(detectForge('https://github.com/onix-labs/studio/extra')).toBeNull();
    expect(detectForge('https://github.com/')).toBeNull();
  });

  it('declinesALocalPath', () => {
    // A local clone has a filesystem path as its remote. The Windows form matches the SCP-like shape,
    // so it must fall out at the host lookup rather than resolving to a forge named `C`.
    expect(detectForge('/Users/matthew/repos/thing')).toBeNull();
    expect(detectForge('C:\\repos\\thing')).toBeNull();
    expect(detectForge('file:///Users/matthew/repos/thing')).toBeNull();
  });

  it('declinesEmptyAndMalformedInput', () => {
    expect(detectForge('')).toBeNull();
    expect(detectForge('   ')).toBeNull();
    expect(detectForge('https://')).toBeNull();
    expect(detectForge('not a url at all')).toBeNull();
  });
});
