import type { InstalledStudio } from './installed-studio';

/**
 * What the install gate needs to know about one operating system: how a user installs Studio there,
 * and how they start it. Everything else the gate does — the wizard, the plugins, the restart — is the
 * same on every platform, so this is the only part that is written per platform.
 *
 * Only Linux is implemented. macOS (mount the DMG, copy the app to Applications) and Windows (run the
 * NSIS installer silently) follow when the gate moves into release.yml (#1546).
 */
export interface StudioPlatform {
  /**
   * Gets the platform's name, for the report.
   */
  readonly name: string;

  /**
   * Installs Studio from the installer the release built, the way a user would.
   * @param installer The installer's path.
   * @returns Returns how to start what was installed.
   */
  install(installer: string): Promise<InstalledStudio>;

  /**
   * Gets the arguments the gate's machine needs Studio started with, beyond what a user passes.
   * @returns Returns the arguments.
   */
  launchArguments(): readonly string[];

  /**
   * Gets the environment Studio is started with: what a desktop session hands an application it
   * launches, rather than the test runner's own. A launcher does not source the user's profile, so
   * starting Studio this way is what proves it finds the toolchains the way it would for a user.
   * @returns Returns the environment.
   */
  launchEnvironment(): Readonly<Record<string, string>>;

  /**
   * Gets the directory Studio is started in: where a desktop launcher starts an application, not
   * wherever the test runner happens to be.
   * @returns Returns the directory.
   */
  launchDirectory(): string;
}
