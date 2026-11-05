// Whole-app macro benchmark: drives the built Electron app through Playwright on a throwaway profile
// and generated fixtures, and prints timings, heap and DOM size per scenario.
//
//   ng build && npm run build:electron && node scripts/bench-app.mjs [--runs 5] [--files 20000]
//
// The profile and fixtures live under os.tmpdir() and are removed afterwards. Run from a checkout that
// has been built; nothing here reads a real profile.
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

const { values: options } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    files: { type: 'string', default: '20000' },
    only: { type: 'string' },
  },
});
const only = options.only;
const RUNS = Number(options.runs);
const FILES = Number(options.files);
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bench-')));

/** Generates a git repository of the requested size, shaped like a real source tree. */
function makeRepository(root, count) {
  for (let i = 0; i < count; i += 1) {
    const folder = path.join(root, 'src', `area-${i % 40}`, `module-${i % 400}`);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, `file-${i}.ts`), `export const value${i} = ${i};\n`);
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  git('init', '-q');
  git('add', '-A');
  git(
    '-c',
    'user.name=bench',
    '-c',
    'user.email=bench@example.invalid',
    'commit',
    '-qm',
    'fixture',
  );
}

/** Generates a TypeScript file of about the requested size. */
function makeCodeFile(file, bytes) {
  const line = 'export function compute(value: number): number { return value * 2 + 1; }\n';
  fs.writeFileSync(file, line.repeat(Math.ceil(bytes / line.length)));
}

/** Launches the app on a fresh profile. */
async function launch(trusted, files = []) {
  const userData = fs.mkdtempSync(path.join(scratch, 'profile-'));
  fs.writeFileSync(path.join(userData, 'trusted-paths.json'), JSON.stringify(trusted));
  // A session hosted by Studio inherits ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const started = performance.now();
  const app = await electron.launch({
    args: ['.', ...files],
    env: { ...environment, STUDIO_USER_DATA_DIR: userData, STUDIO_SKIP_SETUP: '1' },
  });
  return { app, started, userData };
}

/** Resolves the main window, which is not the modal holding the welcome screen. */
async function mainWindow(app) {
  const isModal = (window) => window.url().includes('#studio-modal');
  let page = await app.firstWindow();
  while (isModal(page)) {
    page = await app.waitForEvent('window', { predicate: (window) => !isModal(window) });
  }
  await page.waitForLoadState('domcontentloaded');
  return page;
}

/** Installs a long-task counter in a page. */
const watchLongTasks = (page) =>
  page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__long.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  });

/** Reads what the page currently costs. */
const footprint = (page) =>
  page.evaluate(() => ({
    heapMb: Math.round(performance.memory.usedJSHeapSize / 1e5) / 10,
    domNodes: document.getElementsByTagName('*').length,
    longTasks: window.__long?.length ?? 0,
    longestTaskMs: Math.round(Math.max(0, ...(window.__long ?? []))),
    totalLongMs: Math.round((window.__long ?? []).reduce((sum, ms) => sum + ms, 0)),
  }));

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summarise = (name, rows) => {
  const out = {};
  for (const key of Object.keys(rows[0])) out[key] = median(rows.map((row) => row[key]));
  console.log(name.padEnd(30), JSON.stringify(out));
  return out;
};

async function coldStart() {
  const rows = [];
  for (let i = 0; i < RUNS; i += 1) {
    const { app, started } = await launch([]);
    const page = await mainWindow(app);
    await watchLongTasks(page);
    const isModal = (window) => !window.isClosed() && window.url().includes('#studio-modal');
    const welcome =
      app.windows().find(isModal) ?? (await app.waitForEvent('window', { predicate: isModal }));
    await welcome.getByText('New Markdown File').waitFor({ timeout: 30_000 });
    const welcomeMs = Math.round(performance.now() - started);
    const nav = await page.evaluate(() => {
      const entry = performance.getEntriesByType('navigation')[0];
      return {
        domReady: Math.round(entry.domContentLoadedEventEnd),
        load: Math.round(entry.loadEventEnd),
        resources: performance.getEntriesByType('resource').length,
      };
    });
    await page.waitForTimeout(2000);
    rows.push({ welcomeMs, ...nav, ...(await footprint(page)) });
    await app.close();
  }
  return summarise('cold start', rows);
}

async function openFile(name, file) {
  const rows = [];
  for (let i = 0; i < Math.min(RUNS, 3); i += 1) {
    const { app, started } = await launch([file], [file]);
    const page = await mainWindow(app);
    await watchLongTasks(page);
    await page.locator('.monaco-editor .view-line').first().waitFor({ timeout: 60_000 });
    const firstLineMs = Math.round(performance.now() - started);
    await page.waitForTimeout(1500);
    // Type a few characters and time how long the next frame takes after each.
    await page.locator('.monaco-editor textarea').first().focus();
    const typing = [];
    for (let k = 0; k < 10; k += 1) {
      const before = performance.now();
      await page.keyboard.type('x');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      typing.push(performance.now() - before);
    }
    rows.push({
      firstLineMs,
      typingMs: Math.round(median(typing)),
      typingMaxMs: Math.round(Math.max(...typing)),
      ...(await footprint(page)),
    });
    await app.close();
  }
  return summarise(name, rows);
}

async function openMarkdown(name, file) {
  const rows = [];
  for (let i = 0; i < Math.min(RUNS, 3); i += 1) {
    const { app, started } = await launch([file], [file]);
    const page = await mainWindow(app);
    await watchLongTasks(page);
    await page.locator('.ProseMirror').first().waitFor({ timeout: 60_000 });
    const firstPaintMs = Math.round(performance.now() - started);
    await page.waitForTimeout(1500);
    await page.locator('.ProseMirror').first().click();
    const typing = [];
    for (let k = 0; k < 10; k += 1) {
      const before = performance.now();
      await page.keyboard.press(k % 2 === 0 ? 'ArrowDown' : 'ArrowRight');
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      typing.push(performance.now() - before);
    }
    rows.push({
      firstPaintMs,
      caretMs: Math.round(median(typing)),
      caretMaxMs: Math.round(Math.max(...typing)),
      ...(await footprint(page)),
    });
    await app.close();
  }
  return summarise(name, rows);
}

async function manyTabs(count) {
  const files = [];
  for (let i = 0; i < count; i += 1) {
    const file = path.join(scratch, `tab-${i}.ts`);
    makeCodeFile(file, 100_000);
    files.push(file);
  }
  const rows = [];
  for (let i = 0; i < Math.min(RUNS, 2); i += 1) {
    const { app, started } = await launch(files, files);
    const page = await mainWindow(app);
    await watchLongTasks(page);
    const tabs = page.locator('[role="tab"]');
    await page.waitForFunction(
      (want) => document.querySelectorAll('[role="tab"]').length >= want,
      count,
      { timeout: 120_000 },
    );
    const openMs = Math.round(performance.now() - started);
    await page.waitForTimeout(3000);
    const idleBefore = await footprint(page);
    const switches = [];
    for (let k = 0; k < 12; k += 1) {
      const before = performance.now();
      await tabs.nth(k * 2).click();
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))),
      );
      switches.push(performance.now() - before);
    }
    rows.push({
      openMs,
      switchMs: Math.round(median(switches)),
      switchMaxMs: Math.round(Math.max(...switches)),
      ...(await footprint(page)),
      idleLongTasks: idleBefore.longTasks,
      tabs: await tabs.count(),
    });
    await app.close();
  }
  return summarise(`${count} code tabs`, rows);
}

async function terminalFlood() {
  const rows = [];
  for (let i = 0; i < Math.min(RUNS, 3); i += 1) {
    const { app } = await launch([]);
    const page = await mainWindow(app);
    const isModal = (window) => !window.isClosed() && window.url().includes('#studio-modal');
    const welcome =
      app.windows().find(isModal) ?? (await app.waitForEvent('window', { predicate: isModal }));
    await welcome.getByText('New Terminal').click();
    await page.locator('.xterm').first().waitFor({ timeout: 30_000 });
    await page.waitForTimeout(1500);
    await watchLongTasks(page);
    await page.locator('.xterm-helper-textarea').first().focus();
    // xterm paints to a canvas, so the end of the flood is signalled through a file.
    const marker = path.join(scratch, `flood-${i}`);
    await page.keyboard.type(`yes | head -n 2000000; touch ${marker}\n`);
    const started = performance.now();
    await page.evaluate(() => {
      window.__frames = [];
      let last = performance.now();
      const tick = (now) => {
        window.__frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    while (!fs.existsSync(marker) && performance.now() - started < 120_000) {
      await page.waitForTimeout(100);
    }
    const floodMs = Math.round(performance.now() - started);
    const worstFrameMs = Math.round(await page.evaluate(() => Math.max(...window.__frames)));
    const before = performance.now();
    await page.keyboard.type('x');
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    rows.push({
      floodMs,
      worstFrameMs,
      echoMs: Math.round(performance.now() - before),
      ...(await footprint(page)),
    });
    await app.close();
  }
  return summarise('terminal 2M lines', rows);
}

async function openWorkspace(name, folder) {
  const rows = [];
  for (let i = 0; i < Math.min(RUNS, 3); i += 1) {
    const { app } = await launch([folder]);
    const page = await mainWindow(app);
    const isModal = (window) => !window.isClosed() && window.url().includes('#studio-modal');
    const first =
      app.windows().find(isModal) ?? (await app.waitForEvent('window', { predicate: isModal }));
    await page.evaluate((target) => {
      localStorage.setItem(
        'welcome.recentItems',
        JSON.stringify([
          { path: target, name: 'bench', kind: 'directory', openedAt: Date.now(), pinned: false },
        ]),
      );
    }, folder);
    const isFresh = (window) => isModal(window) && window !== first;
    const reopened = app.waitForEvent('window', { predicate: isFresh });
    await page.reload();
    const fresh = await reopened;
    await watchLongTasks(page);
    const started = performance.now();
    await fresh.getByText('bench', { exact: false }).first().click();
    await page.getByText('src', { exact: true }).first().waitFor({ timeout: 60_000 });
    const treeMs = Math.round(performance.now() - started);
    await page.waitForTimeout(5000);
    rows.push({ treeMs, ...(await footprint(page)) });
    await app.close();
  }
  return summarise(name, rows);
}

try {
  const results = {};
  if (only === undefined || only === 'start') results.coldStart = await coldStart();
  const small = path.join(scratch, 'small.ts');
  const medium = path.join(scratch, 'medium.ts');
  const large = path.join(scratch, 'large.ts');
  makeCodeFile(small, 50_000);
  makeCodeFile(medium, 1_000_000);
  makeCodeFile(large, 8_000_000);
  const csharp = path.join(scratch, 'heuristic.cs');
  makeCodeFile(csharp, 800_000);
  const csharpLarge = path.join(scratch, 'heuristic-large.cs');
  makeCodeFile(csharpLarge, 4_000_000);
  if (only === undefined || only === 'file') {
    results.file50k = await openFile('open + type 50 kB file', small);
    results.file1m = await openFile('open + type 1 MB file', medium);
    results.file8m = await openFile('open + type 8 MB file', large);
    results.csharp = await openFile('open + type 800 kB C#', csharp);
    results.csharpLarge = await openFile('open + type 4 MB C#', csharpLarge);
  }
  if (only === undefined || only === 'markdown') {
    const doc = path.join(scratch, 'large.md');
    const paragraph =
      '## Heading\n\nA paragraph with **bold**, _italic_ and `code` to give the editor real work.\n\n- one\n- two\n\n';
    fs.writeFileSync(doc, paragraph.repeat(Math.ceil(1_000_000 / paragraph.length)));
    results.markdown = await openMarkdown('open + caret 1 MB markdown', doc);
  }
  if (only === undefined || only === 'terminal') results.terminal = await terminalFlood();
  if (only === undefined || only === 'tabs') results.tabs = await manyTabs(30);
  const repository = path.join(scratch, 'repository');
  fs.mkdirSync(repository);
  if (only === undefined || only === 'workspace') makeRepository(repository, FILES);
  if (only === undefined || only === 'workspace')
    results.workspace = await openWorkspace(`open ${FILES} file workspace`, repository);
  console.log(JSON.stringify(results));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
