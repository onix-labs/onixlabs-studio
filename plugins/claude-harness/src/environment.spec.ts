import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeSessionTemporary,
  openSessionTemporary,
  runEnvironment,
  type SessionTemporary,
} from './environment';
import { sandboxFor } from './options';
import type { TurnRequest } from './protocol';

describe('session temporary folder', () => {
  let parent: string;

  beforeEach(() => {
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'environment-'));
  });

  afterEach(() => {
    fs.rmSync(parent, { recursive: true, force: true });
  });

  /**
   * Opens a session's temporary folder under the fixture.
   * @returns Returns the folder.
   */
  function opened(): SessionTemporary {
    const temporary: SessionTemporary | null = openSessionTemporary(parent);
    if (temporary === null) {
      throw new Error('No temporary folder was made');
    }
    return temporary;
  }

  it('openSessionTemporary_makesThePerUserFolderTheCliDerives', () => {
    const temporary: SessionTemporary = opened();

    expect(temporary.directory).toBe(
      path.join(temporary.root, `claude-${process.getuid?.() ?? 0}`),
    );
    expect(fs.statSync(temporary.directory).mode & 0o777).toBe(0o700);
  });

  it('openSessionTemporary_atItsDefault_staysShortEnoughForTheCliToUseIt', () => {
    // Past 44 bytes the CLI ignores it inside the sandbox, and the two modes disagree again.
    const longest: string = '/tmp/studio-XXXXXX/claude-4294967295';

    expect(Buffer.byteLength(longest)).toBeLessThanOrEqual(44);
  });

  it('openSessionTemporary_onWindows_makesNone', () => {
    expect(openSessionTemporary(parent, 'win32')).toBeNull();
  });

  it('openSessionTemporary_whenItCannotBeMade_makesNone_soTheSessionStillRuns', () => {
    expect(openSessionTemporary(path.join(parent, 'gone'))).toBeNull();
  });

  it('closeSessionTemporary_removesTheFolderAndWhatIsInIt', () => {
    const temporary: SessionTemporary = opened();
    fs.writeFileSync(path.join(temporary.directory, 'x'), 'hi');

    closeSessionTemporary(temporary);

    expect(fs.existsSync(temporary.root)).toBe(false);
  });

  it('closeSessionTemporary_withNone_doesNothing', () => {
    expect((): void => closeSessionTemporary(null)).not.toThrow();
  });

  it('runEnvironment_withATemporaryFolder_pointsBothSidesOfTheSandboxAtIt', () => {
    const temporary: SessionTemporary = opened();

    const env: Record<string, string> | null = runEnvironment(null, null, temporary);

    expect(env?.['TMPDIR']).toBe(temporary.directory);
    expect(env?.['CLAUDE_CODE_TMPDIR']).toBe(temporary.root);
    expect(env).not.toHaveProperty('CLAUDE_TMPDIR');
  });

  it('runEnvironment_withNothingToSet_inherits', () => {
    expect(runEnvironment(null, null, null)).toBeNull();
  });

  it('sandboxFor_lettsCommandsWriteToTheFolder_besideTheConfiguredPaths', () => {
    const temporary: SessionTemporary = opened();
    const turn: TurnRequest = {
      allowedWritePaths: ['/extra'],
      deniedWritePaths: [],
      allowedNetworkLocations: [],
      deniedNetworkLocations: [],
    } as unknown as TurnRequest;

    expect(sandboxFor(turn, temporary).filesystem?.allowWrite).toEqual([
      '/extra',
      temporary.directory,
    ]);
  });
});
