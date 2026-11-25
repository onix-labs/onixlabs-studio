/**
 * Specifies how a dock looks: `full` is the workspace's, with rounded groups set apart on its texture;
 * `simple` is square and flat, its groups filling the view. The two are the same structure, styled
 * differently (#1569), but that a tool group of the simple one shows no tabs while it shows one panel.
 */
export type DockAppearance = 'full' | 'simple';

/**
 * Names a button a group's title bar can show.
 */
export type DockButton = 'auto-hide' | 'float' | 'pop-out' | 'close';

/**
 * The buttons a group's title bar shows when its dock does not say.
 */
export const ALL_DOCK_BUTTONS: readonly DockButton[] = ['auto-hide', 'float', 'pop-out', 'close'];
