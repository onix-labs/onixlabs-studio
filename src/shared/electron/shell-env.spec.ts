import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCapturedEnvironment,
  captureShellEnvironment,
  captureShellEnvironmentCached,
  ENV_DELIMITER,
  hydrateLoginShellEnvironment,
  mergePath,
  parseEnvironment,
  profileFilesFor,
  profileStamps,
  readShellEnvironmentCache,
  sameStamps,
  sanitizeAgentShell,
  writeShellEnvironmentCache,
  type ShellEnvironmentCache,
} from './shell-env';

/**
 * Frames a raw `env`-style body between the two delimiters, mimicking the capture script's stdout
 * (including profile noise printed outside the markers).
 */
function framed(body: string, noiseBefore: string = '', noiseAfter: string = ''): string {
  return `${noiseBefore}${ENV_DELIMITER}\n${body}\n${ENV_DELIMITER}${noiseAfter}`;
}

describe('parseEnvironment', () => {
  it('parsesSimpleAssignmentsBetweenTheDelimiters', () => {
    const stdout: string = framed('FOO=bar\nGITHUB_TOKEN=ghp_123\nPATH=/usr/bin:/bin');
    expect(parseEnvironment(stdout)).toEqual({
      FOO: 'bar',
      GITHUB_TOKEN: 'ghp_123',
      PATH: '/usr/bin:/bin',
    });
  });

  it('discardsProfileNoisePrintedOutsideTheDelimiters', () => {
    const stdout: string = framed('FOO=bar', 'Welcome banner\n', '\nignored=trailing');
    expect(parseEnvironment(stdout)).toEqual({ FOO: 'bar' });
  });

  it('keepsValuesContainingEqualsAndEmptyValues', () => {
    const stdout: string = framed('URL=https://x/?a=1&b=2\nEMPTY=');
    expect(parseEnvironment(stdout)).toEqual({ URL: 'https://x/?a=1&b=2', EMPTY: '' });
  });

  it('skipsInvalidKeysAndContinuationLinesOfMultiLineValues', () => {
    // A bash exported function dumps as a key with `()` (invalid identifier) followed by body lines
    // that have no leading key at all — neither should become a variable.
    const stdout: string = framed('BASH_FUNC_x%%=() {\n  echo hi\n}\nGOOD=1');
    expect(parseEnvironment(stdout)).toEqual({ GOOD: '1' });
  });

  it('returnsNullWhenDelimitersAreMissing', () => {
    expect(parseEnvironment('FOO=bar\nBAZ=qux')).toBeNull();
  });

  it('returnsNullWhenOnlyOneDelimiterIsPresent', () => {
    expect(parseEnvironment(`${ENV_DELIMITER}\nFOO=bar`)).toBeNull();
  });
});

describe('mergePath', () => {
  it('prefersTheShellOrderingThenAppendsLaunchExtras', () => {
    expect(mergePath('/opt/homebrew/bin:/usr/bin', '/usr/bin:/sbin')).toBe(
      '/opt/homebrew/bin:/usr/bin:/sbin',
    );
  });

  it('deduplicatesRepeatedEntries', () => {
    expect(mergePath('/usr/bin:/bin', '/usr/bin:/bin')).toBe('/usr/bin:/bin');
  });

  it('handlesAMissingExistingPath', () => {
    expect(mergePath('/usr/bin:/bin', undefined)).toBe('/usr/bin:/bin');
  });

  it('ignoresEmptySegments', () => {
    expect(mergePath('/usr/bin::/bin', '')).toBe('/usr/bin:/bin');
  });
});

describe('sanitizeAgentShell', () => {
  it('keepsAnAbsolutePath', () => {
    expect(sanitizeAgentShell('/bin/zsh')).toBe('/bin/zsh');
  });

  it('trimsSurroundingWhitespace', () => {
    expect(sanitizeAgentShell('  /usr/local/bin/fish  ')).toBe('/usr/local/bin/fish');
  });

  it('fallsBackToNullForEmptyBareNameOrRelativePath', () => {
    expect(sanitizeAgentShell('')).toBeNull();
    expect(sanitizeAgentShell('zsh')).toBeNull();
    expect(sanitizeAgentShell('bin/zsh')).toBeNull();
  });

  it('fallsBackToNullForNonStrings', () => {
    expect(sanitizeAgentShell(undefined)).toBeNull();
    expect(sanitizeAgentShell(null)).toBeNull();
    expect(sanitizeAgentShell(42)).toBeNull();
  });
});

describe('applyCapturedEnvironment', () => {
  it('inGapFillModeAddsMissingKeysWithoutClobberingTheBase', () => {
    const result: Record<string, string> = applyCapturedEnvironment(
      { KEEP: 'base', SHARED: 'base' },
      { SHARED: 'shell', ADDED: 'shell' },
      false,
    );
    expect(result).toEqual({ KEEP: 'base', SHARED: 'base', ADDED: 'shell' });
  });

  it('inOverrideModeReplacesExistingBaseValues', () => {
    const result: Record<string, string> = applyCapturedEnvironment(
      { KEEP: 'base', SHARED: 'base' },
      { SHARED: 'shell', ADDED: 'shell' },
      true,
    );
    expect(result).toEqual({ KEEP: 'base', SHARED: 'shell', ADDED: 'shell' });
  });

  it('alwaysMergesPathRegardlessOfMode', () => {
    const result: Record<string, string> = applyCapturedEnvironment(
      { PATH: '/usr/bin:/sbin' },
      { PATH: '/opt/homebrew/bin:/usr/bin' },
      false,
    );
    expect(result['PATH']).toBe('/opt/homebrew/bin:/usr/bin:/sbin');
  });

  it('dropsNonStringBaseValues', () => {
    const result: Record<string, string> = applyCapturedEnvironment(
      { REAL: 'value', GONE: undefined },
      {},
      false,
    );
    expect(result).toEqual({ REAL: 'value' });
  });
});

describe('captureShellEnvironment', () => {
  it('returnsNullWhenTheShellCannotBeSpawned', () => {
    expect(captureShellEnvironment('/no/such/shell/executable', { timeoutMs: 1000 })).toBeNull();
  });
});

describe('captureShellEnvironmentCached', () => {
  it('memoisesAFailedCaptureSoTheShellIsNotReSpawned', () => {
    const shell: string = '/no/such/shell/cached-probe';
    expect(captureShellEnvironmentCached(shell, { timeoutMs: 1000 })).toBeNull();
    // Second call returns the cached null without spawning again.
    expect(captureShellEnvironmentCached(shell)).toBeNull();
  });
});

describe('profileFilesFor', () => {
  it('listsTheShellFamilysOwnProfilesPlusTheSystemPathLists', () => {
    const zsh: readonly string[] = profileFilesFor('/bin/zsh', '/home/u');
    expect(zsh).toContain('/etc/paths');
    expect(zsh).toContain('/etc/paths.d');
    expect(zsh).toContain('/home/u/.zshrc');
    expect(zsh).toContain('/home/u/.zprofile');
    expect(zsh).not.toContain('/home/u/.bashrc');

    const bash: readonly string[] = profileFilesFor('/bin/bash', '/home/u');
    expect(bash).toContain('/home/u/.bash_profile');
    expect(bash).toContain('/home/u/.profile');
    expect(bash).not.toContain('/home/u/.zshrc');

    const fish: readonly string[] = profileFilesFor('/opt/homebrew/bin/fish', '/home/u');
    expect(fish).toContain('/home/u/.config/fish/config.fish');
  });
});

describe('profileStamps and sameStamps', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shell-env-stamps-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('stampsExistingFilesWithTheirMtimeAndMissingOnesWithNull', () => {
    const present: string = join(dir, '.zshrc');
    const absent: string = join(dir, '.zlogin');
    writeFileSync(present, 'export A=1');
    const stamps: Record<string, number | null> = profileStamps([present, absent]);
    expect(typeof stamps[present]).toBe('number');
    expect(stamps[absent]).toBeNull();
  });

  it('seesAChangedEditedOrAppearingFileAsDifferent', () => {
    const file: string = join(dir, '.zshrc');
    const before: Record<string, number | null> = { [file]: null, '/etc/paths': 1 };
    expect(sameStamps(before, { [file]: null, '/etc/paths': 1 })).toBe(true);
    expect(sameStamps(before, { [file]: 42, '/etc/paths': 1 })).toBe(false);
    expect(sameStamps(before, { [file]: null, '/etc/paths': 2 })).toBe(false);
    expect(sameStamps(before, { [file]: null })).toBe(false);
  });
});

describe('readShellEnvironmentCache and writeShellEnvironmentCache', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'shell-env-cache-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('roundTripsACaptureThroughTheFile', () => {
    const file: string = join(dir, 'nested', 'shell-environment.json');
    const cache: ShellEnvironmentCache = {
      shell: '/bin/zsh',
      stamps: { '/etc/paths': 12.5, '/home/u/.zlogin': null },
      variables: { PATH: '/opt/homebrew/bin:/usr/bin', FOO: 'bar' },
    };
    writeShellEnvironmentCache(file, cache);
    expect(readShellEnvironmentCache(file)).toEqual(cache);
  });

  it('returnsNullForAMissingMalformedOrMisshapenFile', () => {
    expect(readShellEnvironmentCache(join(dir, 'missing.json'))).toBeNull();
    const malformed: string = join(dir, 'malformed.json');
    writeFileSync(malformed, '{not json');
    expect(readShellEnvironmentCache(malformed)).toBeNull();
    const misshapen: string = join(dir, 'misshapen.json');
    writeFileSync(misshapen, JSON.stringify({ shell: 1, stamps: [], variables: 'x' }));
    expect(readShellEnvironmentCache(misshapen)).toBeNull();
  });

  it('keepsOnlyStringVariablesAndNumericStamps', () => {
    const file: string = join(dir, 'mixed.json');
    writeFileSync(
      file,
      JSON.stringify({
        shell: '/bin/zsh',
        stamps: { a: 1, b: 'no', c: null },
        variables: { GOOD: 'yes', BAD: 7, WORSE: { x: 1 } },
      }),
    );
    expect(readShellEnvironmentCache(file)).toEqual({
      shell: '/bin/zsh',
      stamps: { a: 1, b: null, c: null },
      variables: { GOOD: 'yes' },
    });
  });
});

describe('hydrateLoginShellEnvironment', () => {
  /**
   * Runs the callback with `process.env` restored afterwards, so a test that flips the capture
   * switches or lets the hydrate mutate the environment cannot leak into other tests.
   */
  function withEnv(run: () => void): void {
    const saved: Record<string, string | undefined> = { ...process.env };
    try {
      run();
    } finally {
      for (const key of Object.keys(process.env)) {
        if (!(key in saved)) {
          delete process.env[key];
        }
      }
      Object.assign(process.env, saved);
    }
  }

  it('doesNothingWhenDisabled', () => {
    withEnv(() => {
      delete process.env['STUDIO_SHELL_ENV_CAPTURED'];
      process.env['STUDIO_DISABLE_SHELL_ENV'] = '1';
      hydrateLoginShellEnvironment();
      // The run-once marker is only set once a capture is attempted, so a disabled run leaves it unset.
      expect(process.env['STUDIO_SHELL_ENV_CAPTURED']).toBeUndefined();
    });
  });

  it('skipsWhenTermIsSetAndNotForced', () => {
    withEnv(() => {
      delete process.env['STUDIO_SHELL_ENV_CAPTURED'];
      delete process.env['STUDIO_DISABLE_SHELL_ENV'];
      delete process.env['STUDIO_FORCE_SHELL_ENV'];
      process.env['TERM'] = 'xterm-256color';
      hydrateLoginShellEnvironment();
      expect(process.env['STUDIO_SHELL_ENV_CAPTURED']).toBeUndefined();
    });
  });

  it('capturesWhenForced', () => {
    if (process.platform === 'win32') {
      return;
    }
    withEnv(() => {
      delete process.env['STUDIO_SHELL_ENV_CAPTURED'];
      delete process.env['STUDIO_DISABLE_SHELL_ENV'];
      delete process.env['TERM'];
      process.env['STUDIO_FORCE_SHELL_ENV'] = '1';
      hydrateLoginShellEnvironment();
      // The marker is always set once a capture is attempted, whether or not it succeeded.
      expect(process.env['STUDIO_SHELL_ENV_CAPTURED']).toBe('1');
    });
  });

  describe('with a remembered capture', () => {
    let dir: string;
    let file: string;
    // A shell that cannot run: if the hydrate tried to capture, it would get nothing, so every variable
    // that lands in process.env provably came from the remembered capture.
    const shell: string = '/no/such/shell/remembered-probe';

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'shell-env-hydrate-'));
      file = join(dir, 'shell-environment.json');
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function forced(run: () => void): void {
      if (process.platform === 'win32') {
        return;
      }
      withEnv(() => {
        delete process.env['STUDIO_SHELL_ENV_CAPTURED'];
        delete process.env['STUDIO_DISABLE_SHELL_ENV'];
        delete process.env['TERM'];
        delete process.env['STUDIO_SPEC_REMEMBERED'];
        process.env['STUDIO_FORCE_SHELL_ENV'] = '1';
        process.env['SHELL'] = shell;
        run();
      });
    }

    it('appliesTheRememberedCaptureWithoutStartingTheShellWhenTheProfilesAreUnchanged', () => {
      forced(() => {
        writeShellEnvironmentCache(file, {
          shell,
          stamps: profileStamps(profileFilesFor(shell, homedir())),
          variables: { STUDIO_SPEC_REMEMBERED: 'yes' },
        });
        hydrateLoginShellEnvironment(file);
        expect(process.env['STUDIO_SPEC_REMEMBERED']).toBe('yes');
        expect(process.env['STUDIO_SHELL_ENV_CAPTURED']).toBe('1');
      });
    });

    it('stillAppliesTheRememberedCaptureAtOnceWhenAProfileChanged', () => {
      forced(() => {
        writeShellEnvironmentCache(file, {
          shell,
          stamps: { '/etc/paths': 1 },
          variables: { STUDIO_SPEC_REMEMBERED: 'stale-but-used' },
        });
        hydrateLoginShellEnvironment(file);
        expect(process.env['STUDIO_SPEC_REMEMBERED']).toBe('stale-but-used');
      });
    });

    it('ignoresACaptureRememberedFromAnotherShell', () => {
      forced(() => {
        writeShellEnvironmentCache(file, {
          shell: '/bin/other-shell',
          stamps: {},
          variables: { STUDIO_SPEC_REMEMBERED: 'wrong-shell' },
        });
        hydrateLoginShellEnvironment(file);
        expect(process.env['STUDIO_SPEC_REMEMBERED']).toBeUndefined();
      });
    });
  });
});
