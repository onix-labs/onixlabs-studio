/**
 * Determines whether a key press belongs to an input method's composition: typing Chinese, Japanese
 * or Korean with an IME, where Enter picks a candidate and Escape abandons it. Such a press is the
 * input method's, so it must not submit a field, send a message or run a shortcut.
 *
 * `isComposing` is the standard signal. Key code 229 covers the press that starts a composition,
 * which some platforms send before `isComposing` is set.
 * @param event The key event.
 * @returns Returns true when the press is part of a composition.
 */
export function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
