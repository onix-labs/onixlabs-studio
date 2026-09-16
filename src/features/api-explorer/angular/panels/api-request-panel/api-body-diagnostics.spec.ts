import { describe, expect, it } from 'vitest';
import { Diagnostic } from '@shared/angular/services/diagnostics/diagnostics';
import { ApiRequest } from '@shared/api/api-client-types';
import { diagnosticsForBody } from './api-body-diagnostics';

/**
 * Builds a request with a raw body of the given kind.
 * @param name The request name.
 * @param kind The body kind.
 * @returns Returns the request.
 */
function request(name: string, kind: ApiRequest['body']['kind']): ApiRequest {
  return {
    id: 'r1',
    parentId: 'c1',
    name,
    method: 'POST',
    url: 'https://example.test',
    params: [],
    headers: [],
    auth: { kind: 'none' },
    body: { kind, text: '', fields: [] },
    description: '',
  };
}

describe('diagnosticsForBody', () => {
  it('markers_becomeWorkspaceScopedDiagnostics_underTheRequestsName', () => {
    const diagnostics: readonly Diagnostic[] = diagnosticsForBody(request('Create order', 'json'), [
      { severity: 'error', message: 'Expected comma', line: 3, column: 8, source: 'json' },
      { severity: 'warning', message: 'Duplicate key', line: 5, column: 2, source: '' },
    ]);

    expect(diagnostics).toEqual([
      {
        file: 'Create order',
        message: 'Expected comma',
        severity: 'error',
        line: 3,
        column: 8,
        source: 'json',
        documentId: null,
        path: null,
        scope: 'workspace',
      },
      {
        file: 'Create order',
        message: 'Duplicate key',
        severity: 'warning',
        line: 5,
        column: 2,
        source: 'json',
        documentId: null,
        path: null,
        scope: 'workspace',
      },
    ]);
  });

  it('unnamedRequest_isReportedAsUntitled_andTheSourceFallsBackToTheBodyLanguage', () => {
    const diagnostics: readonly Diagnostic[] = diagnosticsForBody(request('   ', 'xml'), [
      { severity: 'error', message: 'Mismatched tag', line: 1, column: 1, source: '' },
    ]);

    expect(diagnostics[0].file).toBe('Untitled request');
    expect(diagnostics[0].source).toBe('xml');
  });

  it('noMarkers_isNoDiagnostics', () => {
    expect(diagnosticsForBody(request('Ping', 'json'), [])).toEqual([]);
  });
});
