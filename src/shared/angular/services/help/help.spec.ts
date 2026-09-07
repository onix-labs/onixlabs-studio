import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { HostEnv } from '@shared/api/host';
import { PLUGIN_API_VERSION } from '@shared/api/plugin-manifest';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Shell } from '@shared/angular/services/shell/shell';
import { AboutFacts, Help } from './help';

/**
 * Records the URLs a test's Help service was asked to open, standing in for the real shell.
 */
class FakeShell {
  public readonly opened: string[] = [];

  public openExternal(url: string): Promise<void> {
    this.opened.push(url);
    return Promise.resolve();
  }
}

/**
 * Stands in for the plugin service, reporting a fixed catalogue revision and counting the reads so a
 * test can prove the dialog does not ask twice.
 */
class FakePlugins {
  public reads: number = 0;

  public constructor(private readonly revision: number | null) {}

  public catalogueRevision(): Promise<number | null> {
    this.reads += 1;
    return Promise.resolve(this.revision);
  }
}

/**
 * Installs a `window.host` for the test, as the preload would.
 * @param platform The host platform.
 * @param arch The host architecture.
 */
function withHost(platform: string, arch: string): void {
  const host: HostEnv = {
    platform,
    arch,
    versions: { studio: '2026.1.0', electron: '42.4.0', chromium: '140.0.0', node: '24.16.0' },
    homeDir: '/home/test',
    display: {
      gpuRendering: { recommendReducedEffects: false, description: '' },
      graphicsAcceleration: 'auto',
      hardwareAccelerationEnabled: true,
    },
  };
  (window as unknown as { host?: HostEnv }).host = host;
}

/**
 * Builds a Help service over the fakes.
 * @param revision The catalogue revision the plugin service reports.
 * @returns Returns the service and its fakes.
 */
function build(revision: number | null = 4): {
  help: Help;
  shell: FakeShell;
  plugins: FakePlugins;
} {
  const shell: FakeShell = new FakeShell();
  const plugins: FakePlugins = new FakePlugins(revision);
  TestBed.configureTestingModule({
    providers: [
      { provide: Shell, useValue: shell },
      { provide: Plugins, useValue: plugins },
    ],
  });
  return { help: TestBed.inject(Help), shell, plugins };
}

describe('Help', () => {
  beforeEach(() => {
    withHost('darwin', 'arm64');
  });

  // `window.host` is a global on the shared jsdom window, so it has to be taken away again: left in
  // place it is not this suite's business any more, it is every later suite's. It said darwin, which
  // any service reading the platform at construction takes as the truth — so a keybinding rendered
  // itself with a Command symbol on a Linux CI runner and the keyboard-settings specs failed, three
  // files away and with nothing to point back here. The whole file getting its own environment is
  // what stops a lapse like this reaching anyone else (see `isolate` in angular.json); cleaning up
  // after ourselves is what stops it being a lapse.
  afterEach(() => {
    delete (window as unknown as { host?: HostEnv }).host;
  });

  it('facts_whenTheHostIsPresent_reportsEveryVersion', () => {
    const { help } = build();

    const facts: AboutFacts = help.facts();

    expect(facts.studio).toBe('2026.1.0');
    expect(facts.pluginApi).toBe(PLUGIN_API_VERSION);
    expect(facts.electron).toBe('42.4.0');
    expect(facts.platform).toBe('darwin arm64');
  });

  it('facts_whenTheHostIsAbsent_reportsEmptyVersionsRatherThanThrowing', () => {
    delete (window as unknown as { host?: HostEnv }).host;
    const { help } = build();

    const facts: AboutFacts = help.facts();

    expect(facts.studio).toBe('');
    expect(facts.platform).toBe('');
  });

  it('showAbout_readsTheCatalogueRevisionOnce_thenOpens', async () => {
    const { help, plugins } = build(7);

    await help.showAbout();
    help.hideAbout();
    await help.showAbout();

    expect(help.aboutOpen()).toBe(true);
    expect(help.facts().catalogueRevision).toBe(7);
    // The revision is fixed for the life of the process, so the second open must not ask again.
    expect(plugins.reads).toBe(1);
  });

  it('summary_readsAsAPasteableBlock', async () => {
    const { help } = build(4);
    await help.showAbout();

    const summary: string = help.summary();

    expect(summary).toContain('ONIXLabs Studio 2026.1.0');
    expect(summary).toContain('Catalogue revision 4');
    expect(summary).toContain('darwin arm64');
  });

  it('summary_whenTheRevisionIsUnknown_standsInADash', () => {
    const { help } = build(null);

    expect(help.summary()).toContain('Catalogue revision —');
  });

  it('openIssueReport_prefillsTheFormWithTheVersionAndPlatform', () => {
    const { help, shell } = build();

    help.openIssueReport();

    const url: URL = new URL(shell.opened[0]);
    expect(url.pathname).toBe('/onix-labs/onixlabs-studio/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('version')).toBe('2026.1.0');
    // Prefilling a dropdown only takes when the value matches one of its options exactly.
    expect(url.searchParams.get('os')).toBe('macOS (Apple Silicon)');
  });

  it('openIssueReport_onAPlatformWithoutAnArchSpecificOption_usesThePlainPlatform', () => {
    withHost('win32', 'x64');
    const { help, shell } = build();

    help.openIssueReport();

    expect(new URL(shell.opened[0]).searchParams.get('os')).toBe('Windows');
  });

  it('openDocumentation_opensTheWiki', () => {
    const { help, shell } = build();

    help.openDocumentation();

    expect(shell.opened).toEqual(['https://github.com/onix-labs/onixlabs-studio/wiki']);
  });

  it('openReleaseNotes_opensTheReleasesPage', () => {
    const { help, shell } = build();

    help.openReleaseNotes();

    expect(shell.opened).toEqual(['https://github.com/onix-labs/onixlabs-studio/releases']);
  });
});
