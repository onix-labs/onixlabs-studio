import type * as MonacoApi from 'monaco-editor';
import { describe, expect, it } from 'vitest';
import { installFileLinkOpener, linkLine } from './monaco-link-opener';

/**
 * A fake of the part of Monaco's editor API the opener registers with, recording the opener.
 */
class FakeEditorApi {
  public opener: MonacoApi.editor.ILinkOpener | null = null;

  /**
   * Records the opener.
   * @param opener The opener.
   * @returns Returns a disposable.
   */
  public registerLinkOpener(opener: MonacoApi.editor.ILinkOpener): MonacoApi.IDisposable {
    this.opener = opener;
    return { dispose: (): void => undefined };
  }
}

/**
 * Builds a link's URI as Monaco parses it, for the fields the opener reads.
 * @param scheme The scheme.
 * @param fsPath The file path.
 * @param fragment The fragment.
 * @returns Returns the URI.
 */
function uri(scheme: string, fsPath: string, fragment: string = ''): MonacoApi.Uri {
  return { scheme, fsPath, fragment } as unknown as MonacoApi.Uri;
}

describe('installFileLinkOpener (#1211)', () => {
  it('opensAFileLinkInTheWorkspace_atTheLineItNames', () => {
    const editor: FakeEditorApi = new FakeEditorApi();
    const opened: string[] = [];
    installFileLinkOpener({ editor } as unknown as typeof MonacoApi, (path: string, line: number) =>
      opened.push(`${path}:${line}`),
    );

    expect(editor.opener?.open(uri('file', '/w/styles/base.css'))).toBe(true);
    expect(editor.opener?.open(uri('file', '/w/go.mod', 'L5'))).toBe(true);

    expect(opened).toEqual(['/w/styles/base.css:1', '/w/go.mod:5']);
  });

  it('leavesWebPagesToMonaco', () => {
    const editor: FakeEditorApi = new FakeEditorApi();
    const opened: string[] = [];
    installFileLinkOpener({ editor } as unknown as typeof MonacoApi, (path: string) =>
      opened.push(path),
    );

    expect(editor.opener?.open(uri('https', '/fmt'))).toBe(false);
    expect(opened).toEqual([]);
  });

  it.each([
    ['', 1],
    ['L12', 12],
    ['12', 12],
    ['L3,5', 3],
    ['L0', 1],
    ['section', 1],
  ])('linkLine(%j) is %i', (fragment: string, line: number) => {
    expect(linkLine(fragment)).toBe(line);
  });
});
