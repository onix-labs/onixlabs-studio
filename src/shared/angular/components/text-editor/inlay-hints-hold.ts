/**
 * Watches for the modifier that shows inlay hints while held: ⌥ on macOS, Ctrl+Alt elsewhere. Monaco's
 * own `offUnlessPressed` wants Ctrl+Alt on every platform, so it cannot be used on macOS.
 * @param target The window of the editor, which may not be the main one.
 * @param onChange Receives whether the modifier is held.
 * @returns Returns a function that stops watching.
 */
export function watchInlayHintsHold(target: Window, onChange: (held: boolean) => void): () => void {
  const isMac: boolean = window.host?.platform === 'darwin';
  const read: (event: KeyboardEvent) => void = (event: KeyboardEvent): void => {
    onChange(event.altKey && (isMac || event.ctrlKey));
  };
  // A window losing focus never hears the key come up.
  const release: () => void = (): void => {
    onChange(false);
  };
  target.addEventListener('keydown', read, true);
  target.addEventListener('keyup', read, true);
  target.addEventListener('blur', release);
  return (): void => {
    target.removeEventListener('keydown', read, true);
    target.removeEventListener('keyup', read, true);
    target.removeEventListener('blur', release);
  };
}
