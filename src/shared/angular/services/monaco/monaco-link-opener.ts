import type * as MonacoApi from 'monaco-editor';

/**
 * Opens a file a link in an editor names, at a line.
 */
export type FileLinkOpen = (path: string, line: number) => void;

/**
 * Reads the line a `file:` link points at from its fragment: `#L12`, `#12` or `#L12,5`, as language
 * servers write it, or the first line when it names none.
 * @param fragment The link's fragment, without the `#`.
 * @returns Returns the one-based line.
 */
export function linkLine(fragment: string): number {
  const match: RegExpExecArray | null = /^L?(\d+)/i.exec(fragment);
  const line: number = match === null ? 1 : Number(match[1]);
  return line > 0 ? line : 1;
}

/**
 * Opens the `file:` links in an editor (#1211) — an HTML `href`, a CSS `@import`, a JSON `$schema`, a
 * language server's document links — in the workspace, as Go to Definition opens a file: through the
 * workspace's file opener, which keeps its rules on what may be opened and what only read. Monaco has
 * no opener of its own for them, so they were underlined and did nothing. Other links are left to
 * Monaco, whose web pages go through the external-link policy.
 * @param monaco The loaded Monaco namespace.
 * @param open Opens the file at the line.
 * @returns Returns the disposable that removes the opener.
 */
export function installFileLinkOpener(
  monaco: typeof MonacoApi,
  open: FileLinkOpen,
): MonacoApi.IDisposable {
  return monaco.editor.registerLinkOpener({
    open: (resource: MonacoApi.Uri): boolean => {
      if (resource.scheme !== 'file') {
        return false;
      }
      open(resource.fsPath, linkLine(resource.fragment));
      return true;
    },
  });
}
