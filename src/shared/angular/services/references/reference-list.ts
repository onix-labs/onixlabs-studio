import { InjectionToken, Signal } from '@angular/core';
import type * as MonacoApi from 'monaco-editor';

/**
 * A place in a file: a reference to a symbol, or one of its definitions.
 */
export interface CodeLocation {
  /**
   * Gets the absolute path of the file — or, for a document with no file on disk (a model only Monaco
   * knows), its model URI.
   */
  readonly path: string;

  /**
   * Gets the span, one-based as the editor counts.
   */
  readonly range: MonacoApi.IRange;
}

/**
 * A place in a file with the text of its line, as the references list shows it.
 */
export interface ReferenceItem extends CodeLocation {
  /**
   * Gets the whole text of the span's first line, or an empty string when it could not be read.
   */
  readonly preview: string;
}

/**
 * Names what a references list lists: every reference to a symbol (Find All References), the several
 * places a symbol is defined (Go to Definition or Go to Type Definition with more than one answer), or
 * the several places it is implemented (Go to Implementation, #1142).
 */
export type ReferenceListKind = 'references' | 'definitions' | 'implementations';

/**
 * Names where a references search stands: under way, answered, or impossible because nothing serves
 * the document's language.
 */
export type ReferenceListStatus = 'searching' | 'done' | 'unavailable';

/**
 * One references search, as the References panel shows it (#1014). Each search is a new list, which
 * replaces the last.
 */
export interface ReferenceList {
  /**
   * Gets what the list lists.
   */
  readonly kind: ReferenceListKind;

  /**
   * Gets the symbol searched for — the word at the caret — or an empty string when there was none.
   */
  readonly symbol: string;

  /**
   * Gets where the search stands.
   */
  readonly status: ReferenceListStatus;

  /**
   * Gets the places found, in the order they were reported; empty until the search is done.
   */
  readonly items: readonly ReferenceItem[];
}

/**
 * Describes a tab that answers a references search with a References panel of its own, outside a
 * workspace (#1014) — a standalone code tab, as {@link import('@shared/angular/services/find-router/find-host').FindHost}
 * answers a find. The tab provides itself through {@link REFERENCES_HOST}; the shared text editor
 * injects it and hands it to the {@link import('./references-router').ReferencesRouter} with its
 * Monaco editor.
 */
export interface ReferencesHost {
  /**
   * Shows the tab's References panel with a list, replacing the one it showed.
   * @param list The list.
   * @param editor The editor the search was made in.
   */
  openReferences(list: ReferenceList, editor: MonacoApi.editor.ICodeEditor): void;
}

/**
 * Names the injection token a tab with its own References panel provides itself through, so the
 * shared text editor can reach it without knowing the feature.
 */
export const REFERENCES_HOST: InjectionToken<ReferencesHost> = new InjectionToken<ReferencesHost>(
  'REFERENCES_HOST',
);

/**
 * Describes the workspace's side of references: whether a workspace is active to answer, and how to
 * show a list in its References panel. The workspace feature contributes it to the router at start-up,
 * so the shared router never imports the feature.
 */
export interface ReferencesWorkspace {
  /**
   * Gets whether a workspace is active to answer references searches.
   */
  readonly available: Signal<boolean>;

  /**
   * Shows a list in the active workspace's References panel, revealing and focusing it.
   * @param list The list.
   */
  reveal(list: ReferenceList): void;
}
