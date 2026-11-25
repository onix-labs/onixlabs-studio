---
name: verify
description: Build, launch and drive ONIXLabs Studio (Electron + Angular) for runtime verification via CDP.
---

# Verifying ONIXLabs Studio at runtime

## Launch (dev, CDP-driveable)

```bash
npx ng serve --host 127.0.0.1 --port 4222 &          # wait for HTTP 200
npm run build:electron                                # dist-electron main + preload
npx cross-env ELECTRON_START_URL=http://127.0.0.1:4222 \
  electron . --remote-debugging-port=9223 &
curl -s http://127.0.0.1:9223/json                    # confirm the renderer target
```

## Drive it

`playwright-core` is already in node_modules — connect over CDP; no extra installs:

```js
const { chromium } = require('<repo>/node_modules/playwright-core');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];   // real mouse: page.mouse.move/down/up
```

## Gotchas

- **Mount-all/hide-inactive**: every open tab stays mounted, so selectors match hidden
  views. Filter by `getBoundingClientRect().width > 0` or use `:visible` locators.
- **Ribbon overflow**: on a default-size window most contextual ribbon groups collapse
  behind `button[aria-label="More ribbon groups"]`. The flyout STAYS OPEN after
  clicking a button inside it and floats over the content below — press Escape (or
  click elsewhere) before mouse-driving anything underneath.
- Tabs are created from the welcome screen (`button[aria-label="Welcome"]` reopens it):
  `text=New Markdown File`, `text=New Code File`, etc.
- The title-bar Settings gear is disabled while a Settings tab already exists; activate
  the existing Settings tab from the title strip instead.
- Tabs are NOT persisted across reload — `page.reload()` returns to the welcome screen.
- Every tab's dock layout persists in localStorage under `dock.layout.<key>`
  (workspace/markdown/code/terminal/agent/binary/…). Clear these to reset UI state
  between scenarios.
- Coordinates are CSS px (window is 1280×800 by default; screenshots are 2× DPR).

## Worth driving

- Panel drag-docking: mousedown on a group's title bar (`.dock-tab-group__title`, moves
  the panel in front) or on its tab rail (moves the group), move >5px → guides + preview
  overlay; drop on an edge of the dock or on a guide square. Verify the group's place and
  the localStorage layout. In a tab with a main group (no document well), a drop on no
  target cancels.
- Divider resize: `app-split-divider` sits in the gap between panes; drag commits one
  localStorage write on release.
- Terminal session survival: type a marker, move the panel, assert the same element
  (`window.__el === t`) and marker text survive.
