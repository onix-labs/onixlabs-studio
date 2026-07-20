import { ENV_DELIMITER, mergePath, parseEnvironment, sanitizeAgentShell } from './shell-env';

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
