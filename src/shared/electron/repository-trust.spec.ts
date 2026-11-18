import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepositoryTrust } from './repository-trust';

describe('RepositoryTrust', () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'repository-trust-'));
    file = path.join(directory, 'repository-trust.json');
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('decisionFor_whenNothingWasDecided_isUnknown', () => {
    const trust: RepositoryTrust = new RepositoryTrust(file);

    expect(trust.decisionFor(path.resolve('/projects/app'))).toBe('unknown');
    expect(trust.decisionFor('')).toBe('unknown');
    expect(trust.decisionFor(undefined)).toBe('unknown');
  });

  it('decide_appliesToTheFolderAndEverythingBeneathIt', () => {
    const trust: RepositoryTrust = new RepositoryTrust(file);
    const container: string = path.resolve('/projects/container');

    trust.decide(container, 'restricted');

    expect(trust.decisionFor(container)).toBe('restricted');
    expect(trust.decisionFor(path.join(container, 'checkout-1'))).toBe('restricted');
    // A sibling folder is a different repository and has not been decided.
    expect(trust.decisionFor(path.resolve('/projects/container-2'))).toBe('unknown');
  });

  it('decide_theNearerDecisionWins_andReplacesAnEarlierOneOnTheSameFolder', () => {
    const trust: RepositoryTrust = new RepositoryTrust(file);
    const container: string = path.resolve('/projects/container');
    const inner: string = path.join(container, 'vendor');

    trust.decide(container, 'trusted');
    trust.decide(inner, 'restricted');
    expect(trust.decisionFor(inner)).toBe('restricted');
    expect(trust.decisionFor(container)).toBe('trusted');

    trust.decide(inner, 'trusted');
    expect(trust.decisionFor(inner)).toBe('trusted');
  });

  it('persists_andReloads_droppingAnythingThatIsNotAnAbsolutePath', () => {
    const trust: RepositoryTrust = new RepositoryTrust(file);
    const repository: string = path.resolve('/projects/app');
    trust.decide(repository, 'trusted');

    const persisted: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(persisted).toEqual({ trusted: [repository], restricted: [] });

    fs.writeFileSync(
      file,
      JSON.stringify({ trusted: [repository, 'relative', 7], restricted: ['nope'] }),
    );
    const reloaded: RepositoryTrust = new RepositoryTrust(file);
    expect(reloaded.decisionFor(repository)).toBe('trusted');
    expect(reloaded.decisionFor(path.resolve('relative'))).toBe('unknown');
  });

  it('load_toleratesAMissingOrMalformedFile', () => {
    fs.writeFileSync(file, '{not json');

    expect(new RepositoryTrust(file).decisionFor(path.resolve('/x'))).toBe('unknown');
    expect(new RepositoryTrust(path.join(directory, 'absent.json')).decisionFor('/x')).toBe(
      'unknown',
    );
  });
});
