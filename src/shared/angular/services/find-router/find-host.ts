import { InjectionToken, Signal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';
import type { FindRequest } from '@shared/angular/components/find-panel/find-request';

/**
 * Describes a tab that answers a find with a Find panel of its own (#1007): a standalone code tab, a
 * binary tab's disassembly, an API Explorer request. The tab provides itself through
 * {@link FIND_HOST}; every text editor inside it injects the token and hands it to the
 * {@link import('./find-router').FindRouter} with its Monaco editor, so ⌘F in any of them opens the
 * tab's panel — outside a workspace, where no Search panel answers instead.
 */
export interface FindHost {
  /**
   * Opens the tab's Find panel as the request asks, over the editor the request came from.
   * @param request The find to open.
   * @param editor The editor to search, or null for the tab's main editor (a ribbon or strip Find,
   * which has no focused editor to name).
   */
  openFind(request: FindRequest, editor: MonacoApi.editor.ICodeEditor | null): void;
}

/**
 * Names the injection token a tab with its own Find panel provides itself through, so the shared text
 * editor can reach it without knowing the feature.
 */
export const FIND_HOST: InjectionToken<FindHost> = new InjectionToken<FindHost>('FIND_HOST');

/**
 * Describes the workspace's side of find: whether a workspace is active to answer it, and how to
 * reveal its Search panel. The workspace feature contributes it to the router at start-up, so the
 * shared router never imports the feature.
 */
export interface FindWorkspace {
  /**
   * Gets whether a workspace is active to answer finds.
   */
  readonly available: Signal<boolean>;

  /**
   * Reveals the active workspace's Search panel, opened as the request asks.
   * @param request The find to open.
   */
  reveal(request: FindRequest): void;
}

/**
 * Describes what the router knows about one Monaco editor beyond the editor itself.
 */
export interface FindAttachment {
  /**
   * Gets the tab whose Find panel answers the editor's finds outside a workspace, or null when the
   * editor has none (a diff, which only exists inside a workspace).
   */
  readonly host?: FindHost | null;

  /**
   * Gets the file the editor shows, for an editor whose model is not registered against one (a diff
   * shows its file through anonymous models); the editor registry answers otherwise.
   */
  readonly filePath?: () => string | null;
}
