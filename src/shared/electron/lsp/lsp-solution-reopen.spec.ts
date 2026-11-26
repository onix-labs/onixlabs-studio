import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LspPostInitialize } from './language-server-descriptor';
import { SolutionReopener } from './lsp-solution-reopen';

describe('SolutionReopener', () => {
  const root: string = path.resolve('/work/app');
  const solution: string = path.join(root, 'App.slnx');
  const open: readonly LspPostInitialize[] = [
    { method: 'solution/open', params: { solution: pathToFileURL(solution).href } },
  ];
  let files: Map<string, string>;

  /**
   * Reads from the fake file system.
   * @param file The absolute path.
   * @returns Returns the text, or throws when there is none.
   */
  function read(file: string): string {
    const text: string | undefined = files.get(file);
    if (text === undefined) {
      throw new Error(`ENOENT: ${file}`);
    }
    return text;
  }

  beforeEach(() => {
    files = new Map<string, string>([
      [solution, '<Solution><Project Path="A/A.csproj" /></Solution>'],
    ]);
  });

  it('aProjectAddedToTheSolution_opensItAgain', () => {
    // Roslyn does not watch the solution: without this, the added project is never loaded and its
    // files sit in miscellaneous files, every `using` they need reported unnecessary.
    const reopener: SolutionReopener = new SolutionReopener(open, read);
    files.set(
      solution,
      '<Solution><Project Path="A/A.csproj" /><Project Path="B/B.csproj" /></Solution>',
    );

    expect(reopener.reopenFor(root, ['App.slnx', 'B/B.csproj'])).toEqual(open);
    // Once opened, the same content does not reopen it again.
    expect(reopener.reopenFor(root, ['App.slnx'])).toEqual([]);
  });

  it('aSolutionRewrittenUnchanged_orNotTouched_isLeftAlone', () => {
    const reopener: SolutionReopener = new SolutionReopener(open, read);

    expect(reopener.reopenFor(root, ['App.slnx'])).toEqual([]);
    expect(reopener.reopenFor(root, ['A/Program.cs'])).toEqual([]);
  });

  it('aDeletedSolution_isNotReopened_untilItComesBackChanged', () => {
    const reopener: SolutionReopener = new SolutionReopener(open, read);
    files.delete(solution);
    expect(reopener.reopenFor(root, ['App.slnx'])).toEqual([]);

    files.set(solution, '<Solution />');
    expect(reopener.reopenFor(root, ['App.slnx'])).toEqual(open);
  });

  it('aServerToldToOpenNoSolution_isNeverReopened', () => {
    const projects: SolutionReopener = new SolutionReopener(
      [{ method: 'project/open', params: { projects: [] } }],
      read,
    );
    const none: SolutionReopener = new SolutionReopener(undefined, read);

    expect(projects.reopenFor(root, ['App.slnx'])).toEqual([]);
    expect(none.reopenFor(root, ['App.slnx'])).toEqual([]);
  });
});
