import {
  findTerminalPaths,
  findTerminalUrls,
  resolveTerminalPath,
  TerminalPathMatch,
  TerminalUrlMatch,
} from './terminal-links';

/**
 * Finds the addresses in a line and returns only the addresses.
 * @param text The line.
 * @returns Returns the addresses.
 */
function urls(text: string): readonly string[] {
  return findTerminalUrls(text).map((match: TerminalUrlMatch): string => match.url);
}

/**
 * Finds the path candidates in a line, with no addresses in it.
 * @param text The line.
 * @returns Returns the candidates.
 */
function paths(text: string): readonly TerminalPathMatch[] {
  return findTerminalPaths(text, findTerminalUrls(text));
}

describe('terminal-links', () => {
  describe('findTerminalUrls', () => {
    it('findTerminalUrls_withADevServerBanner_findsTheLocalAddress', () => {
      const text: string = '  ➜  Local:   http://localhost:5173/';
      const [match] = findTerminalUrls(text);
      expect(match.url).toBe('http://localhost:5173/');
      expect(text.slice(match.start, match.end)).toBe('http://localhost:5173/');
    });

    it('findTerminalUrls_withABareIpAndPort_findsIt', () => {
      expect(urls('listening on https://127.0.0.1:8443/api')).toEqual([
        'https://127.0.0.1:8443/api',
      ]);
    });

    it('findTerminalUrls_withSentencePunctuation_leavesItOff', () => {
      expect(urls('See https://example.com/docs. Or https://example.com/a, then stop;')).toEqual([
        'https://example.com/docs',
        'https://example.com/a',
      ]);
    });

    it('findTerminalUrls_insideBrackets_leavesTheBracketsOff', () => {
      expect(urls('(see https://example.com/page)')).toEqual(['https://example.com/page']);
      expect(urls('[https://example.com/x]')).toEqual(['https://example.com/x']);
    });

    it('findTerminalUrls_withItsOwnBrackets_keepsThem', () => {
      expect(urls('https://en.wikipedia.org/wiki/Mercury_(planet)')).toEqual([
        'https://en.wikipedia.org/wiki/Mercury_(planet)',
      ]);
    });

    it('findTerminalUrls_inQuotes_leavesTheQuotesOff', () => {
      expect(urls(`fetch "https://example.com/a" and 'https://example.com/b'`)).toEqual([
        'https://example.com/a',
        'https://example.com/b',
      ]);
    });

    it('findTerminalUrls_beforeAnEscape_endsAtTheBackslash', () => {
      expect(urls("printf 'Local: http://localhost:5173/\\n'")).toEqual(['http://localhost:5173/']);
    });

    it('findTerminalUrls_withNoHost_findsNothing', () => {
      expect(urls('http:// is the scheme')).toEqual([]);
    });

    it('findTerminalUrls_withOtherSchemes_findsNothing', () => {
      expect(urls('ftp://example.com file:///etc/hosts javascript:alert(1)')).toEqual([]);
    });
  });

  describe('findTerminalPaths', () => {
    it('findTerminalPaths_withLineAndColumn_readsBoth', () => {
      const text: string = 'error at src/app/main.ts:42:7 - missing semicolon';
      const [match] = paths(text);
      expect(match).toEqual(
        expect.objectContaining({ path: 'src/app/main.ts', line: 42, column: 7 }),
      );
      expect(text.slice(match.start, match.end)).toBe('src/app/main.ts:42:7');
    });

    it('findTerminalPaths_withLineOnly_readsTheLine', () => {
      expect(paths('./lib/util.js:12')).toEqual([
        expect.objectContaining({ path: './lib/util.js', line: 12, column: null }),
      ]);
    });

    it('findTerminalPaths_withMsBuildPosition_readsLineAndColumn', () => {
      expect(paths('Program.cs(12,5): error CS1002: ; expected')).toEqual([
        expect.objectContaining({ path: 'Program.cs', line: 12, column: 5 }),
      ]);
    });

    it('findTerminalPaths_withAbsoluteAndWindowsPaths_findsThem', () => {
      expect(paths('/Users/me/app/index.ts:3:1').map((m: TerminalPathMatch) => m.path)).toEqual([
        '/Users/me/app/index.ts',
      ]);
      expect(paths('C:\\src\\app\\Main.java:9').map((m: TerminalPathMatch) => m.path)).toEqual([
        'C:\\src\\app\\Main.java',
      ]);
    });

    it('findTerminalPaths_withAPythonFrame_readsTheQuotedPathAndLine', () => {
      const text: string = '  File "app/views.py", line 88, in handler';
      const [match] = paths(text);
      expect(match).toEqual(
        expect.objectContaining({ path: 'app/views.py', line: 88, column: null }),
      );
      expect(text.slice(match.start, match.end)).toBe('app/views.py');
      expect(paths(text)).toHaveLength(1);
    });

    it('findTerminalPaths_withDottedNames_keepsTheWholeName', () => {
      expect(paths('FAIL src/app/main.spec.ts').map((m: TerminalPathMatch) => m.path)).toEqual([
        'src/app/main.spec.ts',
      ]);
    });

    it('findTerminalPaths_atTheEndOfASentence_leavesTheFullStopOff', () => {
      expect(paths('Wrote dist/out.json.').map((m: TerminalPathMatch) => m.path)).toEqual([
        'dist/out.json',
      ]);
    });

    it('findTerminalPaths_withVersionsAndDecimals_findsNothing', () => {
      expect(paths('node v20.11.1 took 1.25s')).toEqual([]);
    });

    it('findTerminalPaths_insideAnAddress_findsNothing', () => {
      expect(paths('open http://localhost:3000/index.html')).toEqual([]);
    });
  });

  describe('resolveTerminalPath', () => {
    it('resolveTerminalPath_withARelativePath_joinsTheWorkingDirectory', () => {
      expect(resolveTerminalPath('/ws/app', 'src/main.ts')).toBe('/ws/app/src/main.ts');
    });

    it('resolveTerminalPath_withDotSegments_collapsesThem', () => {
      expect(resolveTerminalPath('/ws/app/', './../lib/./util.ts')).toBe('/ws/lib/util.ts');
    });

    it('resolveTerminalPath_withAnAbsolutePath_ignoresTheWorkingDirectory', () => {
      expect(resolveTerminalPath('/elsewhere', '/ws/a.ts')).toBe('/ws/a.ts');
      expect(resolveTerminalPath(null, 'C:\\ws\\a.ts')).toBe('C:/ws/a.ts');
    });

    it('resolveTerminalPath_withARelativePathAndNoDirectory_returnsNull', () => {
      expect(resolveTerminalPath(null, 'src/main.ts')).toBeNull();
    });
  });
});
