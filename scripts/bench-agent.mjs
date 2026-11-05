// Long-transcript benchmark: drives the built Electron app through Playwright on a throwaway profile,
// has a fake harness (`scripts/bench-fake-harness.mjs`) stream a transcript of thousands of items at the
// agent view, and prints what that costs.
//
//   ng build && npm run build:electron && node scripts/bench-agent.mjs [--tools 4000] [--subagents 20]
//                                                                      [--runs 3] [--profile <file>]
//
// The profile lives under os.tmpdir() and is removed afterwards. Nothing here reads a real profile.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const { values: options } = parseArgs({
  options: {
    tools: { type: 'string', default: '4000' },
    subagents: { type: 'string', default: '20' },
    burst: { type: 'string', default: '100' },
    every: { type: 'string', default: '16' },
    runs: { type: 'string', default: '3' },
    profile: { type: 'string' },
  },
});
const TOOLS = Number(options.tools);
const SUBAGENTS = Number(options.subagents);
const RUNS = Number(options.runs);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const HARNESS_ID = 'bench.live-harness';
const HARNESS_VERSION = '1.0.0';
const CONNECTION = {
  id: 'bench-connection',
  kind: 'bench',
  label: 'Bench',
  auth: 'none',
  harnessId: HARNESS_ID,
  models: [{ id: 'bench-model', label: 'Bench Model', contextWindow: 100_000_000 }],
  defaultModelId: 'bench-model',
};
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'studio-bench-agent-')));
const isModal = (window) => !window.isClosed() && window.url().includes('#studio-modal');

/** Files the fake harness in a profile, as an install would have. */
function seedHarness(userData) {
  const manifestDir = path.join(userData, 'plugins', HARNESS_ID);
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDir, 'plugin.json'),
    JSON.stringify({
      id: HARNESS_ID,
      name: 'Bench Live Harness',
      description: 'A harness that floods a transcript, for benchmarks.',
      version: HARNESS_VERSION,
      apiVersion: '1.17.0',
      provision: {
        kind: 'npm',
        lockfileUrl: 'https://example.invalid/never-published.lock.json',
        sha256: '0'.repeat(64),
        executablePath: 'harness.mjs',
      },
      contributes: {
        agentHarnesses: [
          {
            id: HARNESS_ID,
            displayName: 'Bench Live Harness',
            connectionAuths: ['none'],
            sessionModel: 'live-harness',
            command: { kind: 'node' },
            entryPoint: 'harness.mjs',
          },
        ],
      },
      requires: [],
    }),
  );
  const installDir = path.join(
    userData,
    'lsp-servers',
    HARNESS_ID,
    HARNESS_VERSION,
    `${process.platform}-${process.arch}`,
  );
  fs.mkdirSync(installDir, { recursive: true });
  fs.copyFileSync(path.join(HERE, 'bench-fake-harness.mjs'), path.join(installDir, 'harness.mjs'));
  fs.writeFileSync(path.join(installDir, '.studio-install-complete'), new Date(0).toISOString());
  fs.writeFileSync(
    path.join(userData, 'plugins.json'),
    JSON.stringify([
      {
        id: HARNESS_ID,
        version: HARNESS_VERSION,
        installedPath: path.join(installDir, 'harness.mjs'),
      },
    ]),
  );
}

/** Launches the app on a fresh profile with the harness installed, past the welcome screen. */
async function launchAgent() {
  const userData = fs.mkdtempSync(path.join(scratch, 'profile-'));
  seedHarness(userData);
  // A session hosted by Studio inherits ELECTRON_RUN_AS_NODE, which would start Electron as plain Node.
  const { ELECTRON_RUN_AS_NODE: _ignored, ...environment } = process.env;
  const app = await electron.launch({
    args: ['.'],
    cwd: ROOT,
    env: { ...environment, STUDIO_USER_DATA_DIR: userData, STUDIO_SKIP_SETUP: '1' },
  });
  let page = await app.firstWindow();
  while (isModal(page)) {
    page = await app.waitForEvent('window', { predicate: (window) => !isModal(window) });
  }
  await page.waitForLoadState('domcontentloaded');
  const welcome =
    app.windows().find(isModal) ?? (await app.waitForEvent('window', { predicate: isModal }));
  // From the welcome window: the main window follows it live, and a reload would close Welcome.
  await welcome.evaluate((connection) => {
    localStorage.setItem(
      'settings',
      JSON.stringify({
        'ai.connections': [connection],
        'ai.activeConnectionId': connection.id,
        'ai.connectionsFormat': 2,
      }),
    );
  }, CONNECTION);
  await welcome.getByText('New Agent').click();
  await page.locator('app-agent-chat').waitFor();
  return { app, page, userData };
}

/** Quits the app, answering any native prompt, which Playwright cannot reach. */
async function quit(app) {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = () => Promise.resolve({ response: 0, checkboxChecked: false });
  });
  await app.close();
}

/** Installs a long-task counter and a frame recorder in the page. */
const instrument = (page) =>
  page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__long.push(entry.duration);
    }).observe({ type: 'longtask', buffered: false });
    window.__frames = { on: false, last: 0, deltas: [] };
    const tick = (now) => {
      const frames = window.__frames;
      if (frames.on && frames.last > 0) frames.deltas.push(now - frames.last);
      frames.last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

/** Reads what the page costs now, forcing a collection first when the page allows it. */
const footprint = (page) =>
  page.evaluate(() => {
    const long = window.__long ?? [];
    return {
      heapMb: Math.round(performance.memory.usedJSHeapSize / 1e5) / 10,
      domNodes: document.getElementsByTagName('*').length,
      railRows: document.querySelectorAll('app-agent-chat .agent__row').length,
      longTasks: long.length,
      longestTaskMs: Math.round(Math.max(0, ...long)),
      totalLongMs: Math.round(long.reduce((sum, ms) => sum + ms, 0)),
    };
  });

const percentile = (values, share) =>
  values.length === 0
    ? 0
    : [...values].sort((a, b) => a - b)[
        Math.min(values.length - 1, Math.floor(values.length * share))
      ];
const median = (values) => percentile(values, 0.5);

/** Times one keystroke in the composer, to the frame that shows it. */
async function keystroke(page) {
  const before = performance.now();
  // The keyboard rather than a locator: resolving a role walks the whole DOM, which is the test's cost.
  await page.keyboard.press('x');
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  return performance.now() - before;
}

/** Records keystrokes until the run ends, spaced so the page has time to do anything else. */
async function typeWhileRunning(page) {
  const samples = [];
  const running = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('app-agent-chat .agent__composer-actions button')].some(
        (button) => button.textContent.includes('Stop'),
      ),
    );
  while (await running()) {
    samples.push(await keystroke(page));
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  return samples;
}

/** Scrolls the transcript with the wheel and reads the frame times. */
async function scrollFrames(page) {
  const box = await page.locator('app-agent-chat .agent__messages').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => {
    window.__frames.deltas = [];
    window.__frames.on = true;
  });
  for (let step = 0; step < 60; step += 1) {
    await page.mouse.wheel(0, step < 40 ? -400 : 400);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
  }
  const deltas = await page.evaluate(() => {
    window.__frames.on = false;
    return window.__frames.deltas;
  });
  return {
    scrollFrameMs: Math.round(median(deltas) * 10) / 10,
    scrollP95Ms: Math.round(percentile(deltas, 0.95) * 10) / 10,
    scrollMaxMs: Math.round(Math.max(0, ...deltas)),
  };
}

/** Opens the conversation again from the history, and times it. */
async function reopen(page) {
  const chat = page.locator('app-agent-chat');
  await page.getByRole('button', { name: 'New Chat', exact: true }).click();
  await chat.locator('.agent__empty').waitFor();
  const history = page.locator('app-agent-conversation-list');
  if (!(await history.isVisible())) {
    await page.getByRole('button', { name: 'History', exact: true }).click();
  }
  const leaf = history.locator('.history__leaf').first();
  await leaf.waitFor();
  const before = performance.now();
  await leaf.click();
  await chat.locator('.agent__row').first().waitFor({ timeout: 60_000 });
  await page.evaluate(
    () =>
      new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  return Math.round(performance.now() - before);
}

/** Measures one flood from the prompt to a reopened conversation. */
async function runOnce(profilePath) {
  const { app, page, userData } = await launchAgent();
  await instrument(page);
  const chat = page.locator('app-agent-chat');
  const composer = chat.getByRole('textbox', { name: 'Message the agent' });
  const stop = chat.getByRole('button', { name: 'Stop' });
  const idleTyping = [];
  await composer.click();
  for (let i = 0; i < 20; i += 1) idleTyping.push(await keystroke(page));
  await composer.fill(`flood ${TOOLS} ${SUBAGENTS} ${options.burst} ${options.every}`);
  const cdp = profilePath === undefined ? null : await page.context().newCDPSession(page);
  if (cdp !== null) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 500 });
    await cdp.send('Profiler.start');
  }
  const started = performance.now();
  await chat.getByRole('button', { name: 'Send', exact: true }).click();
  await stop.waitFor();
  await composer.focus();
  const duringTyping = await typeWhileRunning(page);
  const stoppedAt = performance.now();
  await page.evaluate(
    () => new Promise((resolve) => requestIdleCallback(() => resolve(), { timeout: 30_000 })),
  );
  const settleMs = Math.round(performance.now() - started);
  const runMs = Math.round(stoppedAt - started);
  if (cdp !== null) {
    const { profile } = await cdp.send('Profiler.stop');
    fs.writeFileSync(profilePath, JSON.stringify(profile));
  }
  await composer.fill('');
  const settled = await footprint(page);
  const afterTyping = [];
  await composer.click();
  for (let i = 0; i < 30; i += 1) afterTyping.push(await keystroke(page));
  await composer.fill('');
  const scroll = await scrollFrames(page);
  // The conversation reaches the disk on a debounce, and the size is reported with the reopen.
  const store = path.join(userData, 'agent-conversations');
  let storedKb = 0;
  for (let i = 0; i < 300 && storedKb === 0; i += 1) {
    const file = fs.existsSync(store)
      ? fs.readdirSync(store).find((name) => name !== 'index.json' && name.endsWith('.json'))
      : undefined;
    if (file !== undefined) storedKb = Math.round(fs.statSync(path.join(store, file)).size / 1024);
    else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const reopenMs = await reopen(page);
  const reopened = await footprint(page);
  const afterReopen = [];
  await composer.click();
  for (let i = 0; i < 15; i += 1) afterReopen.push(await keystroke(page));
  await composer.fill('');
  await quit(app);
  return {
    runMs,
    settleMs,
    idleKeyMs: Math.round(median(idleTyping)),
    duringKeyMs: Math.round(median(duringTyping)),
    duringKeyP95Ms: Math.round(percentile(duringTyping, 0.95)),
    duringKeyMaxMs: Math.round(Math.max(0, ...duringTyping)),
    duringKeySamples: duringTyping.length,
    afterKeyMs: Math.round(median(afterTyping)),
    afterKeyMaxMs: Math.round(Math.max(...afterTyping)),
    ...settled,
    ...scroll,
    storedKb,
    reopenMs,
    reopenRailRows: reopened.railRows,
    reopenHeapMb: reopened.heapMb,
    reopenKeyMs: Math.round(median(afterReopen)),
  };
}

const rows = [];
try {
  for (let run = 0; run < RUNS; run += 1) {
    const row = await runOnce(run === 0 ? options.profile : undefined);
    console.log(`run ${run + 1}`, JSON.stringify(row));
    rows.push(row);
  }
  const out = {};
  for (const key of Object.keys(rows[0])) out[key] = median(rows.map((row) => row[key]));
  console.log('median', JSON.stringify(out));
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
