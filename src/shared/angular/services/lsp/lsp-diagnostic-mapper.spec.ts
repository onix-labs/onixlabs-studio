import type * as MonacoApi from 'monaco-editor';
import {
  isErrorListDiagnostic,
  markerSeverityOf,
  markerTagsOf,
  mergeDiagnostics,
  severityOf,
  toDiagnostic,
  toMarkerData,
} from './lsp-diagnostic-mapper';
import type { LspDiagnostic } from './lsp-client';

/**
 * A fake Monaco namespace exposing only the marker enums the mapper reads.
 */
const monaco: typeof MonacoApi = {
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  MarkerTag: { Unnecessary: 1, Deprecated: 2 },
} as unknown as typeof MonacoApi;

/**
 * A representative server diagnostic (zero-based positions).
 */
const diagnostic: LspDiagnostic = {
  range: { start: { line: 4, character: 2 }, end: { line: 4, character: 8 } },
  severity: 1,
  message: 'boom',
  source: 'typescript',
};

describe('lsp-diagnostic-mapper', () => {
  it('severityOf_mapsTheProtocolSeverities', () => {
    expect(severityOf(1)).toBe('error');
    expect(severityOf(2)).toBe('warning');
    expect(severityOf(3)).toBe('info');
    expect(severityOf(undefined)).toBe('hint');
    expect(severityOf(4)).toBe('hint');
  });

  it('markerSeverityOf_mapsToTheMonacoEnum', () => {
    expect(markerSeverityOf(monaco, 1)).toBe(8);
    expect(markerSeverityOf(monaco, 2)).toBe(4);
    expect(markerSeverityOf(monaco, 3)).toBe(2);
    expect(markerSeverityOf(monaco, undefined)).toBe(1);
  });

  it('toDiagnostic_mapsToTheProviderShapeWithOneBasedPositions', () => {
    expect(toDiagnostic(diagnostic, { uri: 'file:///a/b.ts', documentId: 'doc1' })).toEqual({
      file: 'b.ts',
      message: 'boom',
      severity: 'error',
      line: 5,
      column: 3,
      source: 'typescript',
      documentId: 'doc1',
      path: '/a/b.ts',
    });
  });

  it('toDiagnostic_defaultsAMissingSourceToEmpty', () => {
    const withoutSource: LspDiagnostic = { ...diagnostic, source: undefined };

    expect(toDiagnostic(withoutSource, { uri: 'file:///a/b.ts', documentId: 'd' }).source).toBe('');
  });

  it('toMarkerData_buildsOneBasedMarkerDataWithMappedSeverity', () => {
    expect(toMarkerData(monaco, [diagnostic])).toEqual([
      {
        severity: 8,
        message: 'boom',
        source: 'typescript',
        startLineNumber: 5,
        startColumn: 3,
        endLineNumber: 5,
        endColumn: 9,
      },
    ]);
  });

  it('toMarkerData_carriesTheDiagnosticsCode_butNotTheServersData (#1016)', () => {
    const [marker] = toMarkerData(monaco, [{ ...diagnostic, code: 2304, data: { id: 1 } }]);

    expect(marker.code).toBe('2304');
    expect('data' in marker).toBe(false);
  });

  it('toMarkerData_carriesUnnecessaryAndDeprecatedTags', () => {
    const [faded, struck] = toMarkerData(monaco, [
      { ...diagnostic, severity: 4, tags: [1] },
      { ...diagnostic, severity: 4, tags: [2] },
    ]);

    expect(faded.tags).toEqual([1]);
    expect(struck.tags).toEqual([2]);
  });

  it('toMarkerData_withNoTags_leavesTheFieldOff', () => {
    const [marker] = toMarkerData(monaco, [{ ...diagnostic, tags: [] }]);

    expect('tags' in marker).toBe(false);
  });

  it('markerTagsOf_leavesOutATagItDoesNotKnow', () => {
    expect(markerTagsOf(monaco, [1, 2, 99])).toEqual([1, 2]);
    expect(markerTagsOf(monaco, undefined)).toEqual([]);
  });

  it.each<[string, number | undefined, number[] | undefined, boolean]>([
    ['AnUntaggedHint', 4, undefined, true],
    ['AHintWithAnUnknownTag', 4, [99], true],
    ['AFadedHint', 4, [1], false],
    ['AStruckHint', 4, [2], false],
    ['ATaggedDiagnosticWithNoSeverity', undefined, [1], false],
    ['AnUnusedNameTheProjectMadeAnError', 1, [1], true],
    ['ADeprecationTheServerMadeAWarning', 2, [2], true],
    ['ATaggedInformation', 3, [1], true],
  ])(
    'isErrorListDiagnostic_with%s_answers',
    (
      _name: string,
      severity: number | undefined,
      tags: number[] | undefined,
      expected: boolean,
    ) => {
      expect(isErrorListDiagnostic({ ...diagnostic, severity, tags })).toBe(expected);
    },
  );
});

describe('mergeDiagnostics (#1210)', () => {
  const RANGE: LspDiagnostic['range'] = {
    start: { line: 1, character: 0 },
    end: { line: 1, character: 4 },
  };
  const NATIVE: LspDiagnostic = { range: RANGE, severity: 1, message: 'from the server' };
  const CHECK: LspDiagnostic = { range: RANGE, severity: 1, message: 'from cargo check' };

  it('keepsBoth_asNeitherIsTheWholePicture', () => {
    expect(mergeDiagnostics([NATIVE], [CHECK])).toEqual([NATIVE, CHECK]);
  });

  it('keepsTheOneThatIsThere_whenTheOtherHasNothing', () => {
    expect(mergeDiagnostics([], [CHECK])).toEqual([CHECK]);
    expect(mergeDiagnostics([NATIVE], [])).toEqual([NATIVE]);
  });

  it('keepsOnce_aDiagnosticBothSay', () => {
    expect(mergeDiagnostics([NATIVE], [{ ...NATIVE }])).toEqual([NATIVE]);
  });

  it('keepsBoth_thoughTheySayTheSameThing_whenTheyAreInDifferentPlaces', () => {
    const elsewhere: LspDiagnostic = {
      ...NATIVE,
      range: { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } },
    };

    expect(mergeDiagnostics([NATIVE], [elsewhere])).toEqual([NATIVE, elsewhere]);
  });
});
