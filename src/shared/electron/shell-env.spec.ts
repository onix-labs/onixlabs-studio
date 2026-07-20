import {
  applyCapturedEnvironment,
  captureShellEnvironment,
  captureShellEnvironmentCached,
  ENV_DELIMITER,
  hydrateLoginShellEnvironment,
  mergePath,
  parseEnvironment,
  sanitizeAgentShell,
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
});
