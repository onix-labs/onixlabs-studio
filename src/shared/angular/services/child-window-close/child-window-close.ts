/**
 * Holds how often (ms) an open child window is polled for having closed. It is the belt for paths
 * where `pagehide` is not delivered at all (an OS-forced close), and the braces for the confirmation
 * below, so a close is noticed promptly however it happened.
 */
const CLOSE_POLL_INTERVAL_MS: number = 250;

/**
 * Watches a same-renderer child window for having closed, and notifies once.
 *
 * The obvious signal — `pagehide` — is not on its own trustworthy: the child is opened on
 * `about:blank` and scripted immediately, and the commit of that initial load fires `pagehide` too.
 * Taken at face value it reads as the window closing the instant it opened. Every notification is
 * therefore confirmed against `window.closed` on the next turn of the event loop, which is only ever
 * true for a genuine close.
 * @param child The child window to watch.
 * @param listener The listener invoked once, when the window has closed.
 * @returns Returns the disposer that stops watching.
 */
export function watchChildWindowClosed(child: Window, listener: () => void): () => void {
  let notified: boolean = false;

  const stop: () => void = (): void => {
    clearInterval(poll);
    child.removeEventListener('pagehide', onPageHide);
  };

  const notify: () => void = (): void => {
    if (notified) {
      return;
    }
    notified = true;
    stop();
    listener();
  };

  const confirm: () => void = (): void => {
    setTimeout((): void => {
      if (child.closed) {
        notify();
      }
    }, 0);
  };

  function onPageHide(): void {
    confirm();
  }

  child.addEventListener('pagehide', onPageHide);
  const poll: ReturnType<typeof setInterval> = setInterval((): void => {
    if (child.closed) {
      notify();
    }
  }, CLOSE_POLL_INTERVAL_MS);

  return stop;
}
