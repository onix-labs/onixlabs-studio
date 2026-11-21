// The script a served page runs to reload itself when its files change (#1062).
//
// Served from a path no file can have — a name starting with `.` is never served from the folder, and
// this is under `/__live-server/`, which the server answers itself before looking at the disk.

/**
 * The path every reserved route starts with.
 */
export const RESERVED_PREFIX: string = '/__live-server/';

/**
 * The path the reload script is served from.
 */
export const CLIENT_PATH: string = `${RESERVED_PREFIX}client.js`;

/**
 * The path a page listens for changes on, as server-sent events.
 */
export const EVENTS_PATH: string = `${RESERVED_PREFIX}events`;

/**
 * The reload script. A change to stylesheets alone refetches each same-origin stylesheet in place, so a
 * page keeps its scroll position and its state; any other change reloads the page.
 *
 * Plain ES5 in a string, because it runs in whatever browser the user chose, not in this process.
 */
export const RELOAD_CLIENT: string = `(function () {
  if (typeof EventSource === 'undefined') {
    return;
  }
  var source = new EventSource(${JSON.stringify(EVENTS_PATH)});
  function restyle() {
    var links = document.querySelectorAll('link[rel~="stylesheet"][href]');
    var stamp = String(Date.now());
    for (var i = 0; i < links.length; i++) {
      var url = new URL(links[i].href, location.href);
      if (url.origin === location.origin) {
        url.searchParams.set('live-server', stamp);
        links[i].href = url.href;
      }
    }
  }
  source.onmessage = function (event) {
    var message;
    try {
      message = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (message && message.type === 'css') {
      restyle();
    } else if (message && message.type === 'reload') {
      location.reload();
    }
  };
})();
`;

/**
 * The tag that loads the reload script into a page.
 */
const CLIENT_TAG: string = `<script src="${CLIENT_PATH}"></script>`;

/**
 * Adds the reload script to a page, just before its closing body tag, or at its end when it has none —
 * which a browser still runs.
 * @param html The page.
 * @returns Returns the page with the script added.
 */
export function withReloadClient(html: string): string {
  const close: number = html.toLowerCase().lastIndexOf('</body>');
  return close < 0
    ? `${html}\n${CLIENT_TAG}\n`
    : `${html.slice(0, close)}${CLIENT_TAG}\n${html.slice(close)}`;
}

/**
 * Says what a set of changed files asks of the pages that are open: to restyle when every one is a
 * stylesheet, and otherwise to reload.
 * @param changed The changed files, relative to the folder, with `/` separators.
 * @returns Returns the message's type.
 */
export function changeKind(changed: readonly string[]): 'css' | 'reload' {
  return changed.length > 0 &&
    changed.every((file: string): boolean => file.toLowerCase().endsWith('.css'))
    ? 'css'
    : 'reload';
}
