/**
 * Names the chord that opens what a row stands for. Shown beside Open as a hint: a tree opens a row
 * on Enter itself, whether or not its menu says so.
 */
export const OPEN_CHORD: string = 'Enter';

/**
 * Names the chord that renames what a row stands for, wherever a row's menu has a Rename.
 */
export const RENAME_CHORD: string = 'F2';

/**
 * Names the chord that deletes what a row stands for, wherever a row's menu has a Delete: ⌘⌫ on a
 * Mac, as its own file manager has it, and the Delete key elsewhere.
 */
export const DELETE_CHORD: string =
  typeof window !== 'undefined' && window.host?.platform === 'darwin' ? 'Mod+Backspace' : 'Delete';
