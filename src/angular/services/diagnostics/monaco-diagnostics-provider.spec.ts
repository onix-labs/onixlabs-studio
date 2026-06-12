import { Monaco } from '../monaco/monaco';
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

describe('MonacoDiagnosticsProvider', () => {
  afterEach(() => {
    setElectron(false);
  });

  it('connect_whenOutsideElectron_reportsNothing', () => {
    setElectron(false);
    const monaco: Monaco = {
      ensureLoaded: (): Promise<void> => Promise.resolve(),
      getMonaco: (): undefined => undefined,
    } as unknown as Monaco;
    const provider: MonacoDiagnosticsProvider = new MonacoDiagnosticsProvider(monaco);

    const received: Diagnostic[] = [];
    provider.connect((diagnostics: readonly Diagnostic[]): void => {
      received.push(...diagnostics);
    });

    expect(received).toHaveLength(0);
  });

  it('connect_whenMarkersPresent_mapsThemToDiagnostics', async () => {
    setElectron(true);
    const marker: unknown = {
      resource: { path: '/ws/main.ts' },
      message: 'Cannot find name',
      severity: 8,
      startLineNumber: 3,
      startColumn: 5,
      source: 'typescript',
    };
    const fakeApi: unknown = {
      MarkerSeverity: { Hint: 1, Info: 2, Warning: 4, Error: 8 },
      editor: {
        getModelMarkers: (): unknown[] => [marker],
        onDidChangeMarkers: (): { dispose: () => void } => ({ dispose: (): void => undefined }),
      },
    };
    const monaco: Monaco = {
      ensureLoaded: (): Promise<void> => Promise.resolve(),
      getMonaco: (): unknown => fakeApi,
    } as unknown as Monaco;
    const provider: MonacoDiagnosticsProvider = new MonacoDiagnosticsProvider(monaco);

    let received: readonly Diagnostic[] = [];
    provider.connect((diagnostics: readonly Diagnostic[]): void => {
      received = diagnostics;
    });
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });

    expect(received).toEqual([
      {
        file: 'main.ts',
        message: 'Cannot find name',
        severity: 'error',
        line: 3,
        column: 5,
        source: 'typescript',
      },
    ]);
  });
});
