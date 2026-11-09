import { TestBed } from '@angular/core/testing';
import {
  Diagnostic,
  Diagnostics,
  DiagnosticsProvider,
} from '@shared/angular/services/diagnostics/diagnostics';
import { WorkspaceProblems } from './workspace-problems';

/**
 * A workspace problem.
 * @param path The file's path.
 * @param severity Its severity.
 * @returns Returns the problem.
 */
function problem(path: string, severity: Diagnostic['severity']): Diagnostic {
  return {
    file: path.split(/[\\/]/).pop() ?? path,
    message: severity,
    severity,
    line: 1,
    column: 1,
    source: 'csharp',
    documentId: null,
    path,
    scope: 'workspace',
  };
}

describe('WorkspaceProblems (#1182 follow-up)', () => {
  it('marksEachFileWithItsSeverities_andEveryFolderAboveIt', () => {
    TestBed.configureTestingModule({ providers: [Diagnostics, WorkspaceProblems] });
    const provider: DiagnosticsProvider = {
      id: 'test',
      connect: (onChange: (diagnostics: readonly Diagnostic[]) => void): (() => void) => {
        onChange([
          problem('/ws/Core/Models/Person.cs', 'error'),
          problem('C:\\ws\\App\\Program.cs', 'warning'),
        ]);
        return (): void => undefined;
      },
    };
    TestBed.inject(Diagnostics).register(provider);
    const problems: WorkspaceProblems = TestBed.inject(WorkspaceProblems);

    expect(problems.has('/ws/Core/Models/Person.cs', 'error')).toBe(true);
    expect(problems.inFile('/ws/Core/Models/Person.cs', 'error')).toBe(true);
    expect(problems.has('/ws/Core/Models', 'error')).toBe(true);
    expect(problems.has('/ws/Core/', 'error')).toBe(true);
    expect(problems.has('/ws', 'error')).toBe(true);
    expect(problems.inFile('/ws/Core', 'error')).toBe(false);
    expect(problems.has('/ws/Services', 'error')).toBe(false);
    expect(problems.has('/ws/Core/Models/Person.cs', 'warning')).toBe(false);
    // Windows paths compare with forward slashes.
    expect(problems.has('C:/ws/App', 'warning')).toBe(true);
  });
});
