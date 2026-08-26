/**
 * The label for revealing a path in the operating system's file manager, named for the platform so it
 * matches what the user's own menus call it.
 *
 * Shared rather than restated per panel: every surface that can point at a path offers this command,
 * and three panels each spelling out their own platform ladder is three chances for one of them to
 * call it something the platform does not.
 */
export const REVEAL_LABEL: string = navigator.userAgent.includes('Mac')
  ? 'Reveal in Finder'
  : navigator.userAgent.includes('Windows')
    ? 'Show in File Explorer'
    : 'Show in File Manager';

/**
 * The label for opening a folder in the operating system's file manager.
 *
 * Deliberately "open" rather than the rows' "reveal": revealing selects an item inside its parent
 * folder, which for a root would show it sitting in whatever directory happens to contain it. Opening
 * shows the folder's own contents, which is what is wanted of it.
 */
export const OPEN_FOLDER_LABEL: string = navigator.userAgent.includes('Mac')
  ? 'Open in Finder'
  : navigator.userAgent.includes('Windows')
    ? 'Open in File Explorer'
    : 'Open in File Manager';
