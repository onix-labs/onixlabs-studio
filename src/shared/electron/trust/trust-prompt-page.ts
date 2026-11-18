/**
 * The trust prompt's page (#1504). It holds no script and no folder details: its preload fills in the
 * folder, which it fetches from the main process, as text, and wires the buttons. The content
 * security policy allows nothing but the inline styles, so the page can load nothing and run nothing.
 */
const PAGE: string = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>Do you trust this folder?</title>
<style>
  :root {
    color-scheme: light dark;
    --background: #f6f6f7;
    --foreground: #1d1d1f;
    --muted: #5f6368;
    --border: #d4d4d8;
    --facts: #ffffff;
    --accent: #0a64d8;
    --accent-foreground: #ffffff;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #1f1f22;
      --foreground: #ececee;
      --muted: #a1a1aa;
      --border: #3f3f46;
      --facts: #27272a;
      --accent: #3b82f6;
    }
  }
  html, body {
    margin: 0;
    background: var(--background);
    color: var(--foreground);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    user-select: none;
  }
  main {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 20px 22px 18px;
  }
  h1 {
    margin: 0;
    font-size: 16px;
  }
  p {
    margin: 0;
    color: var(--muted);
  }
  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 12px;
    margin: 0;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--facts);
    font-size: 12px;
  }
  dt {
    color: var(--muted);
  }
  dd {
    margin: 0;
    overflow-wrap: anywhere;
    user-select: text;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }
  button {
    min-width: 96px;
    padding: 6px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: transparent;
    color: var(--foreground);
    font: inherit;
  }
  button.primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-foreground);
  }
  button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
</head>
<body>
<main>
  <h1>Do you trust this folder?</h1>
  <p>
    A folder can hold code that runs on this computer as soon as an editor works with it: build
    scripts, project files, the tools its language uses. Trust it only if you know where it came
    from.
  </p>
  <p>
    Until you trust it, Studio shows its files and runs nothing from it. You can trust it later from
    the status bar.
  </p>
  <dl>
    <dt>Folder</dt>
    <dd id="name"></dd>
    <dt>Location</dt>
    <dd id="folder"></dd>
  </dl>
  <div class="actions">
    <button id="restrict" type="button">Don't Trust</button>
    <button id="trust" type="button" class="primary">Trust</button>
  </div>
</main>
</body>
</html>`;

/**
 * Gets the trust prompt's page as a URL a window can load.
 * @returns Returns the page's `data:` URL.
 */
export function trustPromptUrl(): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`;
}
