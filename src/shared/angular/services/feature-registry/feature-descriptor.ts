import { Type } from '@angular/core';

/**
 * Describes the inputs every feature view component receives when the shell mounts it. A feature
 * view is rendered once per open tab of its type and must declare these inputs.
 */
export interface FeatureViewInputs {
  /**
   * Gets the identifier of the tab the view instance represents.
   */
  readonly tabId: string;

  /**
   * Gets a value indicating whether the tab is the active (visible) one. Inactive tabs stay mounted
   * but hidden, so the view keeps its state across tab switches.
   */
  readonly isActive: boolean;
}

/**
 * Describes the inputs every feature document-panel component receives when the workspace mounts it
 * in a document well. A document panel is a lean editor surface for an open document of the feature's
 * type — distinct from the full tab view — and must declare these inputs.
 */
export interface FeatureDocumentPanelInputs {
  /**
   * Gets the identifier of the document the panel instance displays (the well panel's id).
   */
  readonly documentId: string;

  /**
   * Gets a value indicating whether this document is the active one in its well, so the editor
   * relayouts and focuses. Inactive panels stay mounted but hidden.
   */
  readonly isActive: boolean;

  /**
   * Gets a value indicating whether the backing document is released when the panel is destroyed. The
   * workspace owns the document's lifecycle in the well, so it passes false: a destroy is a re-parent,
   * not a close.
   */
  readonly removeOnDestroy: boolean;
}

/**
 * Describes which chrome strips a feature shows while it is the active tab. Defaults to showing
 * both; a full-bleed feature (such as settings) opts out of one or both.
 */
export interface FeatureChrome {
  /**
   * Gets a value indicating whether the contextual ribbon strip is shown for this feature.
   */
  readonly ribbon: boolean;

  /**
   * Gets a value indicating whether the status strip is shown for this feature.
   */
  readonly status: boolean;
}

/**
 * Specifies the chrome shown for a feature that does not override it: both strips visible.
 */
export const DEFAULT_FEATURE_CHROME: FeatureChrome = { ribbon: true, status: true };

/**
 * Describes a feature's contribution to the application shell: the view the content host mounts for
 * its tab type, the optional contextual ribbon, and the chrome policy while it is active. A feature
 * contributes its descriptor through {@link provideFeature}; the shell then renders it by looking
 * the type up in the {@link FeatureRegistry}, with no hard-coded knowledge of the feature.
 */
export interface FeatureDescriptor {
  /**
   * Gets the tab-type identifier this feature owns (for example, `terminal`). It matches the open
   * tab's type and is the registry key.
   */
  readonly type: string;

  /**
   * Gets the view component mounted for each tab of this type. It must declare the
   * {@link FeatureViewInputs} inputs.
   */
  readonly view: Type<unknown>;

  /**
   * Gets the contextual ribbon component shown while a tab of this type is active, if any. It takes
   * no inputs.
   */
  readonly ribbon?: Type<unknown>;

  /**
   * Gets the status component shown in the status strip while a tab of this type is active, if any.
   * It takes no inputs, and is mounted through the active view's own injector — so it reads the
   * view's per-tab services directly. Because exactly one is mounted at a time, and it is destroyed
   * on tab switch, a feature's status can never linger over another feature's tab.
   *
   * It must compose `app-status-strip-segments` and declare `:host { display: contents; }`, so its
   * segment groups and their flexible spacer are laid out by the strip's own flex row. A host that
   * makes a box of its own traps the spacer and bunches the trailing segments — and the strip's
   * ambient region behind them — up on the left.
   */
  readonly status?: Type<unknown>;

  /**
   * Gets the panel component the workspace mounts in a document well to display an open document of
   * this feature's type, if any. It is a lean editor surface (editor, toolstrip, status) distinct
   * from the full tab {@link view}, and must declare the {@link FeatureDocumentPanelInputs} inputs.
   */
  readonly documentPanel?: Type<unknown>;

  /**
   * Gets the chrome strips shown while a tab of this type is active. Omitted fields fall back to
   * {@link DEFAULT_FEATURE_CHROME} (both strips visible).
   */
  readonly chrome?: Partial<FeatureChrome>;
}
