import { Editors } from '@shared/angular/services/editors/editors';
import { Monaco } from '@shared/angular/services/monaco/monaco';
import { Diagnostic } from './diagnostics';
import { MonacoDiagnosticsProvider } from './monaco-diagnostics-provider';

/**
 * Sets or clears the Electron bridge marker the provider gates on.
 */
function setElectron(present: boolean): void {
  if (present) {
    (window as unknown as { studio?: unknown }).studio = {};
  } else {
    delete (window as unknown as { studio?: unknown }).studio;
  }
}

/**
 * Builds a fake Monaco namespace that reports the given markers.
 * @param markers The markers to report.
 * @returns Returns the fake Monaco service.
 */
function fakeMonaco(markers: readonly unknown[]): Monaco {
  const fakeApi: unknown = {
    MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
    editor: {
      getModelMarkers: (): readonly unknown[] => markers,
      onDidChangeMarkers: (): { dispose: () => void } => ({ dispose: (): void => undefined }),
    },
  };
  return {
    ensureLoaded: (): Promise<void> => Promise.resolve(),
    getMonaco: (): unknown => fakeApi,
  } as unknown as Monaco;
}

/**
 * Awaits a macrotask so the provider's deferred initial emit runs.
 * @returns Returns a promise that resolves on the next tick.
 */
function tick(): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
}

describe('MonacoDiagnosticsProvider', () => {
  let editors: Editors;

  beforeEach(() => {
    editors = new Editors();
  });

  afterEach(() => {
    setElectron(false);
  });

  it('connect_whenOutsideElectron_reportsNothing', () => {
    setElectron(false);
    const monaco: Monaco = {
      ensureLoaded: (): Promise<void> => Promise.resolve(),
      getMonaco: (): undefined => undefined,
    } as unknown as Monaco;
    const provider: MonacoDiagnosticsProvider = new MonacoDiagnosticsProvider(monaco, editors);

    const received: Diagnostic[] = [];
    provider.connect((diagnostics: readonly Diagnostic[]): void => {
      received.push(...diagnostics);
    });

    expect(received).toHaveLength(0);
  });

  it('connect_whenMarkerResourceUnregistered_fallsBackToTheBasename', async () => {
    setElectron(true);
    const marker: unknown = {
      resource: { path: '/ws/main.ts', toString: (): string => 'inmemory://model/1' },
      message: 'Cannot find name',
      severity: 8,
      startLineNumber: 3,
      startColumn: 5,
      source: 'typescript',
    };
    const provider: MonacoDiagnosticsProvider = new MonacoDiagnosticsProvider(
      fakeMonaco([marker]),
      editors,
    );

    let received: readonly Diagnostic[] = [];
    provider.connect((diagnostics: readonly Diagnostic[]): void => {
      received = diagnostics;
    });
    await tick();

    expect(received).toEqual([
      {
        file: 'main.ts',
        message: 'Cannot find name',
        severity: 'error',
        line: 3,
        column: 5,
        source: 'typescript',
        documentId: null,
        path: null,
      },
    ]);
  });

  it('connect_whenMarkerResourceRegistered_resolvesTheDocument', async () => {
    setElectron(true);
    editors.register('inmemory://model/7', {
      documentId: 'doc-7',
      path: '/ws/main.ts',
      name: 'main.ts',
    });
    const marker: unknown = {
      resource: { path: '/7', toString: (): string => 'inmemory://model/7' },
      message: 'Unused variable',
      severity: 4,
      startLineNumber: 10,
      startColumn: 2,
      source: 'typescript',
    };
    const provider: MonacoDiagnosticsProvider = new MonacoDiagnosticsProvider(
      fakeMonaco([marker]),
      editors,
    );

    let received: readonly Diagnostic[] = [];
    provider.connect((diagnostics: readonly Diagnostic[]): void => {
      received = diagnostics;
    });
    await tick();

    expect(received).toEqual([
      {
        file: 'main.ts',
        message: 'Unused variable',
        severity: 'warning',
        line: 10,
        column: 2,
        source: 'typescript',
        documentId: 'doc-7',
        path: '/ws/main.ts',
      },
    ]);
  });
});
