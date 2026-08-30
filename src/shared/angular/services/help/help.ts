import { inject, Service, signal, Signal, WritableSignal } from '@angular/core';
import { PLUGIN_API_VERSION } from '@shared/api/plugin-manifest';
import { HostVersions } from '@shared/api/host';
import { Log } from '@shared/angular/services/log/log';
import { Plugins } from '@shared/angular/services/plugins/plugins';
import { Shell } from '@shared/angular/services/shell/shell';

/**
 * Where the Help menu sends a user who wants more than the application itself can tell them. Kept
 * together (and not spread across call sites) because these are published locations: moving the
 * documentation means changing one constant here.
 */
const WIKI_URL: string = 'https://github.com/onix-labs/onixlabs-studio/wiki';

/**
 * The releases page, where a user checks what they are running against what has shipped.
 */
const RELEASES_URL: string = 'https://github.com/onix-labs/onixlabs-studio/releases';

/**
 * The bug form. The version and platform ride in the query string so a report arrives carrying the
 * facts the About dialog shows, rather than depending on the reporter to transcribe them.
 */
const ISSUE_FORM_URL: string = 'https://github.com/onix-labs/onixlabs-studio/issues/new';

/**
 * The platform labels the bug form's Operating system dropdown offers. A prefill only takes when it
 * matches an option exactly, so these are copied from `.github/ISSUE_TEMPLATE/bug_report.yml`.
 */
const OS_OPTIONS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'macOS (Apple Silicon)',
  'darwin-x64': 'macOS (Intel)',
  win32: 'Windows',
  linux: 'Linux',
};

/**
 * Describes what the running build is, as the About dialog shows it and a bug report quotes it.
 */
export interface AboutFacts {
  /**
   * Gets Studio's own version.
   */
  readonly studio: string;

  /**
   * Gets the plugin API version this build implements.
   */
  readonly pluginApi: string;

  /**
   * Gets the curated catalogue revision in force this launch, or null when it is not yet known.
   */
  readonly catalogueRevision: number | null;

  /**
   * Gets the Electron version.
   */
  readonly electron: string;

  /**
   * Gets the Chromium version.
   */
  readonly chromium: string;

  /**
   * Gets the Node version.
   */
  readonly node: string;

  /**
   * Gets the platform and architecture, as `darwin arm64`.
   */
  readonly platform: string;
}

/**
 * What the Help menu can do: state the About dialog's visibility, the facts it shows, and the places
 * it sends a user.
 *
 * A service rather than menu-local state because the menu lives in the main process's native bar: an
 * entry there can only call back into the renderer, so something in the renderer has to hold whether
 * the dialog is open, and the dialog itself is mounted once at the root.
 */
@Service()
export class Help {
  /**
   * Holds the external-link opener.
   */
  private readonly shell: Shell = inject(Shell);

  /**
   * Holds the plugin service, for the catalogue revision.
   */
  private readonly plugins: Plugins = inject(Plugins);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Holds whether the About dialog is open.
   */
  private readonly aboutVisible: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds the catalogue revision once read, so the dialog does not go to the main process each time it
   * opens.
   */
  private readonly revision: WritableSignal<number | null> = signal<number | null>(null);

  /**
   * Gets whether the About dialog is open.
   */
  public readonly aboutOpen: Signal<boolean> = this.aboutVisible.asReadonly();

  /**
   * Gets what the running build is.
   * @returns Returns the facts, reading unknown runtime versions as empty strings outside Electron.
   */
  public facts(): AboutFacts {
    const versions: HostVersions | undefined = window.host?.versions;
    return {
      studio: versions?.studio ?? '',
      pluginApi: PLUGIN_API_VERSION,
      catalogueRevision: this.revision(),
      electron: versions?.electron ?? '',
      chromium: versions?.chromium ?? '',
      node: versions?.node ?? '',
      platform: this.platform(),
    };
  }

  /**
   * Opens the About dialog, reading the catalogue revision first so the dialog opens complete rather
   * than filling in a moment later.
   * @returns Returns a promise that resolves once the dialog has been opened.
   */
  public async showAbout(): Promise<void> {
    if (this.revision() === null) {
      this.revision.set(await this.plugins.catalogueRevision());
    }
    this.aboutVisible.set(true);
  }

  /**
   * Closes the About dialog.
   */
  public hideAbout(): void {
    this.aboutVisible.set(false);
  }

  /**
   * Renders the running build as the block a bug report quotes.
   * @returns Returns the summary, one fact per line.
   */
  public summary(): string {
    const facts: AboutFacts = this.facts();
    const revision: string = facts.catalogueRevision === null ? '—' : `${facts.catalogueRevision}`;
    return [
      `ONIXLabs Studio ${facts.studio}`,
      `Plugin API ${facts.pluginApi}`,
      `Catalogue revision ${revision}`,
      `Electron ${facts.electron} · Chromium ${facts.chromium} · Node ${facts.node}`,
      facts.platform,
    ].join('\n');
  }

  /**
   * Copies the running build's summary to the clipboard, so a reporter pastes it rather than
   * transcribing it.
   * @returns Returns a promise that resolves to true when the clipboard accepted the text.
   */
  public async copySummary(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(this.summary());
      return true;
    } catch (error: unknown) {
      this.log.warn('Help', 'Could not copy the version summary to the clipboard', error);
      return false;
    }
  }

  /**
   * Opens the documentation wiki.
   */
  public openDocumentation(): void {
    void this.shell.openExternal(WIKI_URL);
  }

  /**
   * Opens the releases page.
   */
  public openReleaseNotes(): void {
    void this.shell.openExternal(RELEASES_URL);
  }

  /**
   * Opens the bug form with the running build's version and platform already filled in.
   */
  public openIssueReport(): void {
    const facts: AboutFacts = this.facts();
    const query: URLSearchParams = new URLSearchParams({
      template: 'bug_report.yml',
      labels: 'bug',
      version: facts.studio.length > 0 ? facts.studio : 'unknown',
    });
    const os: string | undefined = this.osOption();
    if (os !== undefined) {
      query.set('os', os);
    }
    void this.shell.openExternal(`${ISSUE_FORM_URL}?${query.toString()}`);
  }

  /**
   * Renders the platform and architecture for display.
   * @returns Returns the platform, or an empty string outside Electron.
   */
  private platform(): string {
    const platform: string | undefined = window.host?.platform;
    const arch: string | undefined = window.host?.arch;
    if (platform === undefined) {
      return '';
    }
    return arch === undefined ? platform : `${platform} ${arch}`;
  }

  /**
   * Maps the host platform onto the bug form's dropdown option.
   * @returns Returns the option label, or undefined when the platform is not one the form offers.
   */
  private osOption(): string | undefined {
    const platform: string | undefined = window.host?.platform;
    if (platform === undefined) {
      return undefined;
    }
    return OS_OPTIONS[`${platform}-${window.host?.arch ?? ''}`] ?? OS_OPTIONS[platform];
  }
}
