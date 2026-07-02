import { TestBed } from '@angular/core/testing';
import { Documents } from '@shared/angular/services/documents/documents';

import { Diagnostic, Diagnostics, DiagnosticsProvider } from './diagnostics';

/**
 * A diagnostics provider whose contributions the test pushes manually.
 */
class FakeProvider implements DiagnosticsProvider {
  public readonly id: string = 'fake';

  private emit: ((diagnostics: readonly Diagnostic[]) => void) | null = null;

  public connect(onChange: (diagnostics: readonly Diagnostic[]) => void): () => void {
    this.emit = onChange;
    return (): void => {
      this.emit = null;
    };
  }

  public push(diagnostics: readonly Diagnostic[]): void {
    this.emit?.(diagnostics);
  }
}

/**
 * Builds a diagnostic with sensible defaults.
 */
function diagnostic(partial: Partial<Diagnostic>): Diagnostic {
  return {
    file: 'main.ts',
    message: 'problem',
    severity: 'error',
    line: 1,
    column: 1,
    source: 'typescript',
    documentId: 'doc-1',
    path: null,
    ...partial,
  };
}

describe('Diagnostics', () => {
  let diagnostics: Diagnostics;
  let documents: Documents;
  let provider: FakeProvider;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    diagnostics = TestBed.inject(Diagnostics);
    documents = TestBed.inject(Documents);
    // The aggregate only keeps diagnostics for documents this workspace owns.
    documents.ensure('doc-1');
    provider = new FakeProvider();
  });

  it('all_whenNoProviderReported_isEmpty', () => {
    expect(diagnostics.all()).toHaveLength(0);
  });

  it('register_whenProviderReports_mergesAndCountsBySeverity', () => {
    diagnostics.register(provider);
    provider.push([
      diagnostic({ severity: 'error' }),
      diagnostic({ severity: 'warning' }),
      diagnostic({ severity: 'warning' }),
    ]);
    expect(diagnostics.all()).toHaveLength(3);
    expect(diagnostics.errorCount()).toBe(1);
    expect(diagnostics.warningCount()).toBe(2);
  });

  it('register_whenMixedSeverities_sortsErrorsFirst', () => {
    diagnostics.register(provider);
    provider.push([
      diagnostic({ severity: 'warning', message: 'w' }),
      diagnostic({ severity: 'error', message: 'e' }),
    ]);
    expect(diagnostics.all()[0].severity).toBe('error');
  });

  it('register_whenUnregistered_dropsTheProvidersDiagnostics', () => {
    const unregister: () => void = diagnostics.register(provider);
    provider.push([diagnostic({})]);
    expect(diagnostics.all()).toHaveLength(1);
    unregister();
    expect(diagnostics.all()).toHaveLength(0);
  });

  it('register_whenDiagnosticForAForeignDocument_isFilteredOut', () => {
    diagnostics.register(provider);
    provider.push([
      diagnostic({ documentId: 'doc-1' }),
      diagnostic({ documentId: 'other-workspace-doc' }),
      diagnostic({ documentId: null }),
    ]);
    expect(diagnostics.all()).toHaveLength(1);
    expect(diagnostics.all()[0].documentId).toBe('doc-1');
  });
});
