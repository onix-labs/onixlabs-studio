import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  _electron as electron,
  ElectronApplication,
  expect,
  Locator,
  Page,
  test,
} from '@playwright/test';
import { isModalWindow, modalWindow } from '../helpers';
import { currentPlatform } from './current-platform';
import { copyLogs, listTree, screenshotWindows } from './gate-evidence';
import type { GatePluginResult } from './gate-plugin-result';
import { GateReport } from './gate-report';
import type { InstalledStudio } from './installed-studio';
import type { ListedPlugin } from './listed-plugin';
import type { StudioPlatform } from './studio-platform';

/**
 * The install gate (#1546): installs Studio from the installer the release built, on a machine that
 * has every toolchain the plugins drive and nothing of Studio's, then does what a new user does —
 * starts it, walks the setup wizard choosing every plugin it offers, and finishes. Each plugin is
 * really downloaded, checked against its pinned hash, unpacked and started, through the plugin index
 * the build ships; nothing is seeded.
 *
 * Then it checks the end state — every plugin installed, the Plugin Manager and its status strip
 * agreeing, no toolchain reported missing, the welcome screen up — and restarts, to check that
 * nothing is installed or asked again.
 *
 * Every plugin's outcome goes into `summary.json` as it happens, with the reason when it failed or
 * was skipped, and the evidence — Studio's logs, the profile listing, screenshots — is kept whatever
 * the result.
 */

/**
 * Holds where the evidence goes.
 */
const OUTPUT: string = process.env['STUDIO_GATE_OUTPUT'] ?? path.join(__dirname, 'output', 'local');

/**
 * Holds how long one plugin may take to install. Language servers are tens of megabytes, and the npm
 * plugins resolve a whole dependency tree.
 */
const PLUGIN_TIMEOUT_MS: number = 30 * 60_000;

/**
 * Holds how long an install may sit without having started before it counts as never started.
 */
const START_TIMEOUT_MS: number = 60_000;

/**
 * Holds the summary groups whose rows the gate cannot make good: signing in to an AI provider or a
 * code host needs credentials a release gate does not hold. Their rows are reported, never failed.
 */
const CREDENTIAL_GROUPS: readonly string[] = ['AI providers', 'Code hosting'];

/**
 * One row of the wizard's summary, as the gate reads it.
 */
interface SummaryRow {
  /**
   * Gets the group the row is in.
   */
  readonly group: string;

  /**
   * Gets what the row is about.
   */
  readonly name: string;

  /**
   * Gets what was found.
   */
  readonly detail: string;

  /**
   * Gets how it turned out: ok, warn, missing, unknown or unset.
   */
  readonly status: string;
}

/**
 * Invokes a main-process channel from a window, as the application's own services do.
 * @param page A window.
 * @param channel The channel.
 * @param args The arguments.
 * @returns Returns the answer.
 */
function invoke<T>(page: Page, channel: string, ...args: readonly unknown[]): Promise<T> {
  return page.evaluate(
    ([name, rest]: readonly [string, readonly unknown[]]): Promise<T> =>
      (
        window as unknown as {
          bridge: { invoke: (channel: string, ...args: readonly unknown[]) => Promise<T> };
        }
      ).bridge.invoke(name, ...rest),
    [channel, args] as const,
  );
}

/**
 * Lists every plugin and its state.
 * @param page A window.
 * @returns Returns the plugins.
 */
function listPlugins(page: Page): Promise<readonly ListedPlugin[]> {
  return invoke<readonly ListedPlugin[]>(page, 'plugins:list');
}

/**
 * Starts the installed Studio the way a desktop launcher does, keeping its console output.
 * @param platform The platform.
 * @param installed The installation.
 * @param phase Which launch this is, for the console log's name.
 * @returns Returns the application.
 */
async function launch(
  platform: StudioPlatform,
  installed: InstalledStudio,
  phase: string,
): Promise<ElectronApplication> {
  const app: ElectronApplication = await electron.launch({
    executablePath: installed.executable,
    args: [...platform.launchArguments()],
    env: { ...platform.launchEnvironment() },
    cwd: platform.launchDirectory(),
    timeout: 120_000,
  });
  const console: fs.WriteStream = fs.createWriteStream(path.join(OUTPUT, `${phase}-console.log`));
  app.process().stdout?.on('data', (chunk: Buffer): void => void console.write(chunk));
  app.process().stderr?.on('data', (chunk: Buffer): void => void console.write(chunk));
  return app;
}

/**
 * Resolves the main window: the one that is not a modal.
 * @param app The application.
 * @returns Returns the main window, once its shell has started.
 */
async function mainWindow(app: ElectronApplication): Promise<Page> {
  let page: Page | undefined = app
    .windows()
    .find((window: Page): boolean => !isModalWindow(window));
  page ??= await app.waitForEvent('window', {
    predicate: (window: Page): boolean => !isModalWindow(window),
  });
  await page.waitForFunction((): boolean => {
    const root: Element | null = document.querySelector('app-root');
    return root !== null && root.childElementCount > 0;
  });
  return page;
}

/**
 * Accepts the install consent, in whichever window it is asked.
 * @param app The application.
 * @param name The plugin being installed.
 */
async function acceptConsent(app: ElectronApplication, name: string): Promise<void> {
  let asking: Locator | undefined;
  await expect
    .poll(
      async (): Promise<boolean> => {
        for (const window of app.windows()) {
          if (window.isClosed()) {
            continue;
          }
          const consent: Locator = window.locator('.consent');
          if ((await consent.count().catch((): number => 0)) > 0) {
            asking = consent;
            return true;
          }
        }
        return false;
      },
      { message: `the install consent for ${name}`, timeout: 30_000 },
    )
    .toBe(true);
  if (asking === undefined) {
    throw new Error(`No consent was asked for ${name}`);
  }
  await expect(asking.locator('.consent__title')).toContainText(name);
  await asking.getByRole('button', { name: 'Install', exact: true }).click();
}

/**
 * Installs one plugin from its catalogue row, through the consent, and waits for it to settle.
 * @param app The application.
 * @param main The main window, which holds the bridge: a modal window is a document the main window
 * draws into, with no bridge of its own.
 * @param wizard The wizard window.
 * @param plugin The plugin.
 * @param step The step it is offered on.
 * @returns Returns how it fared.
 */
async function installFromRow(
  app: ElectronApplication,
  main: Page,
  wizard: Page,
  plugin: ListedPlugin,
  step: string,
): Promise<GatePluginResult> {
  const started: number = Date.now();
  const seconds: () => number = (): number => Math.round((Date.now() - started) / 1000);
  const row: Locator = wizard
    .locator('.catalogue__item')
    .filter({ has: wizard.locator('.catalogue__name').getByText(plugin.name, { exact: true }) });
  // Another row's install leaves every Install disabled until it finishes.
  const install: Locator = row.getByRole('button', { name: 'Install', exact: true });
  await expect(install).toBeEnabled({ timeout: PLUGIN_TIMEOUT_MS });
  await install.click();
  await acceptConsent(app, plugin.name);

  let state: string = plugin.state;
  let wasBusy: boolean = false;
  while (Date.now() - started < PLUGIN_TIMEOUT_MS) {
    const current: ListedPlugin | undefined = (await listPlugins(main)).find(
      (candidate: ListedPlugin): boolean => candidate.id === plugin.id,
    );
    state = current?.state ?? 'gone';
    wasBusy ||= state === 'busy';
    const error: string = (await wizard.locator('.install-error__message').allInnerTexts())
      .join(' ')
      .trim();
    if (state === 'installed') {
      return { id: plugin.id, name: plugin.name, step, outcome: 'pass', seconds: seconds() };
    }
    if (state !== 'busy' && error.length > 0) {
      return {
        id: plugin.id,
        name: plugin.name,
        step,
        outcome: 'fail',
        reason: error,
        seconds: seconds(),
      };
    }
    if (state !== 'busy' && !wasBusy && Date.now() - started > START_TIMEOUT_MS) {
      break;
    }
    if (state !== 'busy' && wasBusy) {
      return {
        id: plugin.id,
        name: plugin.name,
        step,
        outcome: 'fail',
        reason: `The install finished as '${state}' with no error shown.`,
        seconds: seconds(),
      };
    }
    await wizard.waitForTimeout(2_000);
  }
  return {
    id: plugin.id,
    name: plugin.name,
    step,
    outcome: 'fail',
    reason: wasBusy
      ? `Still installing after ${PLUGIN_TIMEOUT_MS / 60_000} minutes.`
      : `The install never started (state '${state}').`,
    seconds: seconds(),
  };
}

/**
 * Installs every plugin a catalogue step offers, one after another as a user would.
 * @param app The application.
 * @param main The main window, which holds the bridge.
 * @param wizard The wizard window.
 * @param step The step's label.
 * @param report The report.
 */
async function installCatalogue(
  app: ElectronApplication,
  main: Page,
  wizard: Page,
  step: string,
  report: GateReport,
): Promise<void> {
  // The catalogue fills once the index has been read; an empty step is a finding, not a pass.
  const list: Locator = wizard.locator('.catalogue__list');
  const empty: Locator = wizard.locator('.catalogue__empty');
  await expect(list.or(empty)).toBeVisible({ timeout: 60_000 });
  if (await empty.isVisible()) {
    report.finding(`${step}: the wizard offered no plugins on this machine.`);
    return;
  }
  const names: readonly string[] = (await wizard.locator('.catalogue__name').allInnerTexts()).map(
    (name: string): string => name.trim(),
  );
  for (const name of names) {
    const listed: readonly ListedPlugin[] = await listPlugins(main);
    const plugin: ListedPlugin | undefined = listed.find(
      (candidate: ListedPlugin): boolean => candidate.name === name,
    );
    if (plugin === undefined) {
      report.finding(`${step}: '${name}' is listed by the wizard but not by plugins:list.`);
      continue;
    }
    if (plugin.state === 'installed') {
      // Already there — installed alongside an earlier one, or offered on two steps.
      report.plugin({ id: plugin.id, name, step, outcome: 'pass', seconds: 0 });
      continue;
    }
    if (plugin.state === 'unavailable') {
      report.plugin({
        id: plugin.id,
        name,
        step,
        outcome: 'skipped',
        reason: `Not offered for this platform: ${plugin.detail ?? 'no build for it'}`,
        seconds: 0,
      });
      continue;
    }
    const result: GatePluginResult = await installFromRow(app, main, wizard, plugin, step);
    report.plugin(result);
    if (result.outcome === 'fail') {
      await screenshotWindows(app, path.join(OUTPUT, 'screenshots'), `install-failed-${plugin.id}`);
    }
  }
}

/**
 * Sets the commit identity a version-control step asks for, as a user would type it.
 * @param main The main window, which holds the bridge.
 * @param wizard The wizard window.
 */
async function setCommitIdentity(main: Page, wizard: Page): Promise<void> {
  await wizard.getByLabel('Commit name').fill('Studio Install Gate');
  await wizard.getByLabel('Commit email').fill('install-gate@onixlabs.invalid');
  await wizard.getByRole('button', { name: 'Save identity' }).click();
  try {
    await expect(wizard.getByText(/Saved to your global/)).toBeVisible();
  } catch (error: unknown) {
    // The step says only that it did not save; what git holds now is what the failure needs.
    const held: unknown = await invoke<unknown>(main, 'setup:get-git-identity');
    throw new Error(`Save identity did not save; git now holds ${JSON.stringify(held)}`, {
      cause: error,
    });
  }
}

/**
 * Reads the wizard's summary, once its machine checks have finished.
 * @param wizard The wizard window.
 * @returns Returns its rows.
 */
async function readSummary(wizard: Page): Promise<readonly SummaryRow[]> {
  const again: Locator = wizard.getByRole('button', { name: 'Check again' });
  if ((await again.count()) > 0) {
    await expect(again).toBeEnabled({ timeout: 120_000 });
  }
  return wizard.locator('.env__group').evaluateAll((groups: Element[]): SummaryRow[] =>
    groups.flatMap((group: Element): SummaryRow[] =>
      Array.from(group.querySelectorAll('.env__item')).map((item: Element): SummaryRow => ({
        group: group.querySelector('.env__group-title')?.textContent?.trim() ?? '',
        name: item.querySelector('.env__name')?.textContent?.trim() ?? '',
        detail: item.querySelector('.env__detail')?.textContent?.trim() ?? '',
        status:
          Array.from(item.classList)
            .find((name: string): boolean => name.startsWith('env__item--'))
            ?.slice('env__item--'.length) ?? 'unknown',
      })),
    ),
  );
}

/**
 * Walks the wizard from its first step to Finish, doing on each step what a user setting up
 * everything would: installing every plugin a catalogue offers, giving version control an identity,
 * and reading the summary.
 * @param app The application.
 * @param report The report.
 * @returns Returns the wizard window, now closing, and the summary's rows.
 */
async function walkWizard(
  app: ElectronApplication,
  report: GateReport,
): Promise<{ wizard: Page; summary: readonly SummaryRow[] }> {
  const wizard: Page = await modalWindow(app);
  await expect(wizard.locator('.setup')).toBeVisible({ timeout: 120_000 });
  const main: Page = await mainWindow(app);
  const shots: string = path.join(OUTPUT, 'screenshots');
  const walked: string[] = [];
  // The rail grows as plugins install (a step per language, per provider), so the walk is bounded
  // generously rather than by the rail's first length.
  for (let guard: number = 0; guard < 200; guard += 1) {
    const current: string = (
      await wizard.locator('.setup__step-label--current').innerText()
    ).trim();
    walked.push(current);
    const label: string = `step-${String(walked.length).padStart(2, '0')}-${current.replace(/[^a-z0-9]+/gi, '-')}`;
    if ((await wizard.locator('app-setup-step-catalogue').count()) > 0) {
      await installCatalogue(app, main, wizard, current, report);
    } else if ((await wizard.locator('app-setup-step-commit-identity').count()) > 0) {
      await setCommitIdentity(main, wizard);
    } else if ((await wizard.locator('app-setup-step-ai-provider').count()) > 0) {
      report.finding(`${current}: not signed in; the gate holds no credentials for it.`);
    }
    await wizard.screenshot({ path: path.join(shots, `${label}.png`) });
    if ((await wizard.getByRole('button', { name: 'Finish' }).count()) > 0) {
      const summary: readonly SummaryRow[] = await readSummary(wizard);
      fs.writeFileSync(path.join(OUTPUT, 'wizard-summary.json'), JSON.stringify(summary, null, 2));
      report.fact('steps', walked.join(' > '));
      await wizard.getByRole('button', { name: 'Finish' }).click();
      return { wizard, summary };
    }
    await wizard.getByRole('button', { name: 'Next' }).click();
    // Moving on is the rail's current step changing; waiting for it keeps the next read honest.
    await expect(wizard.locator('.setup__step-label--current')).not.toHaveText(current, {
      timeout: 10_000,
    });
  }
  throw new Error(`The wizard never reached Finish: ${walked.join(' > ')}`);
}

/**
 * Opens the Plugin Manager from the welcome screen.
 * @param app The application.
 * @param page The main window.
 */
async function openPluginManager(app: ElectronApplication, page: Page): Promise<void> {
  const welcome: Page = await modalWindow(app);
  await welcome.getByRole('tab', { name: 'Tools & Settings' }).click();
  await welcome.locator('.welcome__tool', { hasText: 'Plugin Manager' }).click();
  await expect(page.locator('app-plugin-manager-view')).toBeVisible();
}

/**
 * Checks the Plugin Manager against the plugins the wizard installed: each reads as Installed, and
 * the status strip's count agrees with the list.
 * @param page The main window.
 * @param report The report.
 * @param phase Which launch this is.
 */
async function checkPluginManager(page: Page, report: GateReport, phase: string): Promise<void> {
  const listed: readonly ListedPlugin[] = await listPlugins(page);
  const installed: number = listed.filter(
    (plugin: ListedPlugin): boolean => plugin.state === 'installed',
  ).length;
  await expect(page.locator('app-plugin-manager-status-strip')).toContainText(
    `${installed} of ${listed.length} installed`,
  );
  await expect(page.locator('app-plugin-manager-status-strip')).not.toContainText('Installing');
  for (const result of report.withOutcome('pass')) {
    const plugin: ListedPlugin | undefined = listed.find(
      (candidate: ListedPlugin): boolean => candidate.id === result.id,
    );
    if (plugin?.state !== 'installed') {
      report.fail(
        result.id,
        `${phase}: the Plugin Manager lists it as '${plugin?.state ?? 'absent'}'.`,
      );
      continue;
    }
    const chip: Locator = page
      .locator('tr.table-row')
      .filter({ has: page.locator('.plugin-row__name').getByText(result.name, { exact: true }) })
      .locator('.plugin-row__state');
    const text: string = (await chip.allInnerTexts()).join(' ').trim();
    if (text !== 'Installed') {
      report.fail(result.id, `${phase}: the Plugin Manager's row reads '${text}'.`);
    }
  }
}

/**
 * Lists what is installed in the profile's plugin folders, with when each entry was last written, so
 * a restart can be shown to have reinstalled nothing.
 * @param userData Studio's profile.
 * @returns Returns one line per entry.
 */
function installedFingerprint(userData: string): readonly string[] {
  const roots: readonly string[] = fs
    .readdirSync(userData, { withFileTypes: true })
    .filter(
      (entry: fs.Dirent): boolean =>
        entry.isDirectory() && /plugin|server|adapter/i.test(entry.name),
    )
    .map((entry: fs.Dirent): string => path.join(userData, entry.name));
  return roots.flatMap((root: string): string[] =>
    fs.readdirSync(root).map((name: string): string => {
      const full: string = path.join(root, name);
      return `${path.relative(userData, full)} ${fs.statSync(full).mtimeMs}`;
    }),
  );
}

/**
 * Reads Studio's human-readable log.
 * @param userData Studio's profile.
 * @returns Returns its lines, or none when it has not been written.
 */
function studioLog(userData: string): readonly string[] {
  const file: string = path.join(userData, 'logs', 'studio.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n') : [];
}

/**
 * Checks that what each installed plugin starts from is on disk, and that Studio logged no error
 * about it. Whether a language server then answers, or a debugger stops, is #656's to prove.
 * @param userData Studio's profile.
 * @param report The report.
 */
function checkInstalledPayloads(userData: string, report: GateReport): void {
  const lines: readonly string[] = studioLog(userData);
  const entryPoints: Map<string, string> = new Map<string, string>();
  for (const line of lines) {
    const installed: RegExpExecArray | null = /PluginManager: Installed (\S+) at (.+)$/.exec(line);
    if (installed?.[1] !== undefined && installed[2] !== undefined) {
      entryPoints.set(installed[1], installed[2].trim());
    }
  }
  for (const result of report.withOutcome('pass')) {
    const entryPoint: string | undefined = entryPoints.get(result.id);
    if (entryPoint === undefined) {
      report.fail(result.id, 'Studio logged no install for it.');
    } else if (!fs.existsSync(entryPoint)) {
      report.fail(result.id, `What it starts from, ${entryPoint}, is not on disk.`);
    }
    const error: string | undefined = lines.find(
      (line: string): boolean => line.includes(':error]') && line.includes(result.id),
    );
    if (error !== undefined) {
      report.fail(result.id, `Studio logged an error for it: ${error}`);
    }
  }
}

/**
 * Prints what a login shell on this machine finds, for the record.
 * @returns Returns the report.
 */
function toolchainReport(): string {
  try {
    return execFileSync('bash', ['-l', '/usr/local/lib/studio-gate/toolchains.sh', 'report'], {
      encoding: 'utf8',
    });
  } catch (error: unknown) {
    return `The toolchain report failed: ${String(error)}`;
  }
}

test('a fresh install completes a full setup, and a restart keeps it', async () => {
  const installer: string | undefined = process.env['STUDIO_GATE_INSTALLER'];
  if (installer === undefined) {
    throw new Error('STUDIO_GATE_INSTALLER must name the installer to test.');
  }
  fs.mkdirSync(OUTPUT, { recursive: true });
  const report: GateReport = new GateReport(path.join(OUTPUT, 'summary.json'));
  const platform: StudioPlatform = currentPlatform();
  report.fact('distribution', process.env['STUDIO_GATE_DISTRO'] ?? platform.name);
  report.fact('installer', path.basename(installer));
  fs.writeFileSync(path.join(OUTPUT, 'toolchains.txt'), toolchainReport());

  let app: ElectronApplication | undefined;
  let userData: string | undefined;
  let installed: InstalledStudio | undefined;
  try {
    installed =
      await test.step('install Studio as a user would', async (): Promise<InstalledStudio> =>
        platform.install(installer));

    app = await launch(platform, installed, 'first-launch');
    const launched: ElectronApplication = app;
    userData = await launched.evaluate(({ app: electronApp }): string =>
      electronApp.getPath('userData'),
    );
    report.fact(
      'version',
      await launched.evaluate(({ app: electronApp }): string => electronApp.getVersion()),
    );

    const { wizard, summary } =
      await test.step('complete the setup wizard, installing everything', () =>
        walkWizard(launched, report));
    report.setupFinished();

    // Each plugin's own failure is asserted once, at the end, with whatever else befell it; here the
    // run only stops when there was nothing to install at all.
    expect(report.all().length, 'the wizard offered no plugins at all').toBeGreaterThan(0);

    await test.step('no toolchain or plugin reports a missing requirement', (): void => {
      for (const row of summary) {
        if (row.status === 'missing' || row.status === 'warn') {
          report.finding(`Summary: ${row.group} / ${row.name} is ${row.status}: ${row.detail}`);
          if (!CREDENTIAL_GROUPS.includes(row.group)) {
            expect.soft(row.status, `${row.group} / ${row.name}: ${row.detail}`).toBe('ok');
          }
        }
      }
    });

    const page: Page = await test.step('the welcome screen opens', async (): Promise<Page> => {
      const welcome: Page = await modalWindow(launched, [wizard]);
      await expect(welcome.locator('.welcome__title')).toContainText('ONIXLabs Studio');
      return mainWindow(launched);
    });

    await test.step('the Plugin Manager and its status strip agree', async (): Promise<void> => {
      await openPluginManager(launched, page);
      await checkPluginManager(page, report, 'After setup');
      await screenshotWindows(
        launched,
        path.join(OUTPUT, 'screenshots'),
        'plugin-manager-after-setup',
      );
    });

    await test.step('every installed plugin has what it starts from', (): void => {
      checkInstalledPayloads(userData ?? '', report);
    });

    const logged: number = studioLog(userData).length;
    const before: readonly string[] = installedFingerprint(userData);
    fs.writeFileSync(path.join(OUTPUT, 'installed-before-restart.txt'), before.join('\n'));
    await launched.close();
    app = undefined;

    app = await test.step('restart', (): Promise<ElectronApplication> =>
      launch(platform, installed ?? { executable: '', installRoot: '' }, 'second-launch'));
    const relaunched: ElectronApplication = app;

    await test.step('nothing is asked again', async (): Promise<void> => {
      const welcome: Page = await modalWindow(relaunched);
      await expect(welcome.locator('.welcome__title')).toContainText('ONIXLabs Studio', {
        timeout: 120_000,
      });
      for (const window of relaunched.windows()) {
        await expect(window.locator('.setup')).toHaveCount(0);
      }
    });

    await test.step('nothing is installed again', async (): Promise<void> => {
      const page2: Page = await mainWindow(relaunched);
      await openPluginManager(relaunched, page2);
      await checkPluginManager(page2, report, 'After restart');
      await screenshotWindows(
        relaunched,
        path.join(OUTPUT, 'screenshots'),
        'plugin-manager-after-restart',
      );
      const after: readonly string[] = installedFingerprint(userData ?? '');
      fs.writeFileSync(path.join(OUTPUT, 'installed-after-restart.txt'), after.join('\n'));
      expect(after, 'the plugin folders changed across a restart').toEqual(before);
      const reinstalled: readonly string[] = studioLog(userData ?? '')
        .slice(logged)
        .filter((line: string): boolean => line.includes('PluginManager: Installing '));
      expect(reinstalled, 'plugins were installed again on the restart').toEqual([]);
    });

    await test.step('every plugin passed', (): void => {
      for (const result of report.withOutcome('fail')) {
        expect.soft(result.reason, `${result.name} (${result.id})`).toBeUndefined();
      }
    });
  } catch (error: unknown) {
    if (app !== undefined) {
      await screenshotWindows(app, path.join(OUTPUT, 'screenshots'), 'failure');
    }
    // Playwright colours its messages; the summary is read as plain text.
    const message: string = (error instanceof Error ? error.message : String(error))
      .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
      .split('\n')
      .slice(0, 3)
      .join(' ');
    report.finding(`The run stopped: ${message}`);
    throw error;
  } finally {
    await app?.close().catch((): void => undefined);
    if (userData !== undefined) {
      copyLogs(userData, path.join(OUTPUT, 'logs'));
      listTree(userData, path.join(OUTPUT, 'profile-listing.txt'));
    }
    if (installed !== undefined) {
      listTree(installed.installRoot, path.join(OUTPUT, 'install-listing.txt'));
    }
    report.write();
  }
});
