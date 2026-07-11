import { InjectionToken } from '@angular/core';
import { Tab } from '@shared/angular/services/tabs/tab';

/**
 * Describes the editor that accepts files no text editor can open — the `kind: 'binary'`
 * classification the main process already assigns. The binary feature contributes its document
 * registry through {@link BINARY_FILE_OPENER}; the shared {@link
 * import('./file-opener').FileOpener} routes binary files through the token, so it names the
 * classification without importing the feature. When no implementation is contributed (the feature
 * is absent), binary files are skipped as they were before the editor existed.
 */
export interface BinaryFileOpener {
  /**
   * Opens a file in a binary tab, reusing an existing tab for the same path.
   * @param path The absolute path of the file to open.
   * @returns Returns the opened, or re-activated, tab.
   */
  open(path: string): Tab;
}

/**
 * Names the injection token the binary feature contributes its file opener through.
 */
export const BINARY_FILE_OPENER: InjectionToken<BinaryFileOpener> =
  new InjectionToken<BinaryFileOpener>('BINARY_FILE_OPENER');
