import type * as MonacoApi from 'monaco-editor';
import { markerSeverityOf, severityOf, toDiagnostic, toMarkerData } from './lsp-diagnostic-mapper';
import type { LspDiagnostic } from './lsp-client';

/**
 * A fake Monaco namespace exposing only the marker-severity enum the mapper reads.
 */
const monaco: typeof MonacoApi = {
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
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
});
