/**
 * Writes one device pixel of a window, as a CSS length, to its root's `--device-pixel` property — the
 * length the `--hairline` token (see `styles/_variables.scss`) is built from. CSS has no unit for a
 * device pixel, so it is stated from script.
 * @param view The window whose device pixel to state.
 */
export function applyDevicePixel(view: Window): void {
  view.document.documentElement.style.setProperty(
    '--device-pixel',
    `${1 / view.devicePixelRatio}px`,
  );
}

/**
 * States a window's device pixel and keeps it current as the window's scale changes — the user
 * changing the display scale, or dragging the window to a display with a different one.
 *
 * A resolution query matches one exact ratio, so it is re-armed for the new ratio each time it fires.
 * @param view The window to track.
 */
export function trackDevicePixel(view: Window): void {
  applyDevicePixel(view);
  view
    .matchMedia(`(resolution: ${view.devicePixelRatio}dppx)`)
    .addEventListener('change', (): void => trackDevicePixel(view), { once: true });
}
