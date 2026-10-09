import { Icon } from './icon';

/**
 * Picks the icon a file is drawn with, from its name: by extension, with a hidden file (a dotfile)
 * marked as such and anything unrecognised drawn as a plain file.
 *
 * Shared by the File Explorer and the Find & Replace results, so a file reads the same in both. The
 * Solution Explorer keeps its own table, deliberately — it draws project files (`.csproj`, `.props`)
 * that a plain file tree has no special icon for.
 * @param name The file name, or a path ending in one.
 * @returns Returns the file's icon.
 */
export function fileIconFor(name: string): Icon {
  const base: string = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  const dot: number = base.lastIndexOf('.');
  switch (dot <= 0 ? '' : base.slice(dot + 1).toLowerCase()) {
    case 'ts':
      return Icon.FILE_TYPESCRIPT;
    case 'js':
    case 'mjs':
    case 'cjs':
      return Icon.FILE_JAVASCRIPT;
    case 'json':
      return Icon.FILE_JSON;
    case 'md':
      return Icon.FILE_MARKDOWN;
    case 'scss':
    case 'sass':
    case 'less':
    case 'css':
      return Icon.FILE_STYLESHEET;
    case 'html':
      return Icon.FILE_HTML;
    default:
      return base.startsWith('.') ? Icon.FILE_HIDDEN : Icon.FILE;
  }
}
