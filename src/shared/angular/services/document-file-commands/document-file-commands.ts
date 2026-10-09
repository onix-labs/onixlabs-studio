import { inject } from '@angular/core';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Icon } from '@shared/angular/icons/icon';
import { DockReveal } from '@shared/angular/services/dock-layout/dock-reveal';
import { Shell } from '@shared/angular/services/shell/shell';
import { OPEN_IN_FILE_SYSTEM_LABEL } from '@shared/angular/services/shell/shell-labels';
import { Workspace } from '@shared/angular/services/workspace/workspace';

/**
 * Identifies the Copy Path command on a document strip's menu.
 */
export const COPY_PATH: string = 'document.copyPath';

/**
 * Identifies the Select in File Explorer command on a document strip's menu.
 */
export const SELECT_IN_FILE_EXPLORER: string = 'document.selectInFileExplorer';

/**
 * Identifies the Open in File System command on a document strip's menu.
 */
export const OPEN_IN_FILE_SYSTEM: string = 'document.openInFileSystem';

/**
 * The File Explorer's panel identifier, brought forward by Select in File Explorer.
 */
const FILES_PANEL_ID: string = 'files';

/**
 * The file commands every document strip's menu ends with (#882) — the same three, in the same words,
 * on a code file's strip and a markdown file's.
 */
export interface DocumentFileCommands {
  /**
   * Builds the menu items for a document's file.
   * @param path The document's path, or null while it is untitled — when the commands, having no file
   * to act on, are disabled.
   * @returns Returns Copy Path, Select in File Explorer and Open in File System.
   */
  items(path: string | null): readonly MenuItem[];

  /**
   * Runs one of the file commands, when the identifier is one of them.
   * @param id The chosen item's identifier.
   * @param path The document's path, or null while it is untitled.
   * @returns Returns true when the identifier was a file command, so the caller need look no further.
   */
  run(id: string, path: string | null): boolean;
}

/**
 * Builds the file commands for a document strip, from the injection context it is called in — so
 * Select in File Explorer reaches the File Explorer of the workspace the document is open in.
 * @returns Returns the file commands.
 */
export function injectDocumentFileCommands(): DocumentFileCommands {
  const workspace: Workspace | null = inject(Workspace, { optional: true });
  const dockReveal: DockReveal | null = inject(DockReveal, { optional: true });
  const shell: Shell = inject(Shell);
  return {
    items: (path: string | null): readonly MenuItem[] => [
      { id: COPY_PATH, label: 'Copy Path', icon: Icon.COPY, disabled: path === null },
      {
        id: SELECT_IN_FILE_EXPLORER,
        label: 'Select in File Explorer',
        icon: Icon.FOLDER_OPEN,
        disabled: path === null || workspace === null,
      },
      {
        id: OPEN_IN_FILE_SYSTEM,
        label: OPEN_IN_FILE_SYSTEM_LABEL,
        icon: Icon.OPEN_EXTERNAL,
        disabled: path === null,
      },
    ],
    run: (id: string, path: string | null): boolean => {
      switch (id) {
        case COPY_PATH:
          if (path !== null) {
            void navigator.clipboard.writeText(path).catch((): void => undefined);
          }
          return true;
        case SELECT_IN_FILE_EXPLORER:
          if (path !== null) {
            dockReveal?.reveal(FILES_PANEL_ID);
            void workspace?.revealPath(path);
          }
          return true;
        case OPEN_IN_FILE_SYSTEM:
          if (path !== null) {
            void shell.revealPath(path);
          }
          return true;
        default:
          return false;
      }
    },
  };
}
