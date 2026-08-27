import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { logger } from '../logger';
import { platformKey } from './archive-provision';
import { isComplete, markComplete } from './archive-provisioner';
import { downloadTo, extractArchive, integrityOf, sha256Of } from './download';
import { LockfilePackage, LockfileProvision, parseLockfile } from './lockfile-provision';

/**
 * Installs an npm dependency tree from a pinned lockfile, for the many language servers that ship only
 * their own code and name the rest (#446).
 *
 * This is deliberately **not** an npm client. It resolves nothing, contacts no registry for metadata,
 * and never runs a lifecycle script — not as a flag that could be turned off, but because no code path
 * here executes anything a package ships. The lockfile already decided the tree; installing it is a
 * list of verified downloads unpacked to the paths that lockfile names, which is the archive
 * provisioner's job performed N times instead of once.
 *
 * The verification chain is the point. The manifest pins a hash of the lockfile, the lockfile pins one
 * per tarball, and nothing is extracted until the digest in hand matches the digest that was pinned —
 * so a fetch that returns different bytes than were promised fails rather than installs.
 */
export class LockfileProvisioner {
  /**
   * Holds the directory installs are rooted at, or null when provisioning is disabled.
   */
  private readonly root: string | null;

  /**
   * Holds the name this provisioner logs under, so a line is attributable to the side that asked.
   */
  private readonly logName: string;

  /**
   * Caches each install, so a tree is fetched at most once per session even if callers race.
   */
  private readonly installs: Map<string, Promise<string | null>> = new Map<
    string,
    Promise<string | null>
  >();

  /**
   * Initializes a new instance of the {@link LockfileProvisioner} class.
   * @param root The directory installs are rooted at, or null to disable provisioning.
   * @param logName The name to log under.
   */
  public constructor(root: string | null, logName: string) {
    this.root = root;
    this.logName = logName;
  }

  /**
   * Gets the directory a provision installs into.
   *
   * Version- and platform-scoped like an archive install. The platform matters even though one lockfile
   * describes every platform, because what is *installed* from it does not: the `os` and `cpu` filter
   * drops the packages this machine is not meant to have, so a tree reified on one architecture is not
   * the tree another wants.
   * @param provision The provisioning recipe.
   * @returns Returns the install directory, or null when provisioning is disabled.
   */
  public directoryOf(provision: LockfileProvision): string | null {
    return this.root === null
      ? null
      : path.join(this.root, provision.id, provision.version, platformKey());
  }

  /**
   * Gets the entry point a provision installs, whether or not it is installed yet.
   * @param provision The provisioning recipe.
   * @returns Returns the path, or null when provisioning is disabled.
   */
  public targetOf(provision: LockfileProvision): string | null {
    const directory: string | null = this.directoryOf(provision);
    return directory === null ? null : path.join(directory, provision.executablePath);
  }

  /**
   * Gets whether a provision is installed, **without downloading anything**. Requires both the
   * completion marker and the entry point: an install interrupted midway leaves a directory holding
   * some of a tree, which is not a working install and must never be mistaken for one.
   * @param provision The provisioning recipe.
   * @returns Returns true when it is installed.
   */
  public isInstalled(provision: LockfileProvision): boolean {
    const directory: string | null = this.directoryOf(provision);
    const target: string | null = this.targetOf(provision);
    return directory !== null && target !== null && isComplete(directory) && existsSync(target);
  }

  /**
   * Installs a provision, or reuses the cached copy.
   * @param provision The provisioning recipe.
   * @returns Returns the entry point path, or null when the install failed.
   */
  public ensure(provision: LockfileProvision): Promise<string | null> {
    const key: string = `${provision.id} ${provision.version} ${platformKey()}`;
    let install: Promise<string | null> | undefined = this.installs.get(key);
    if (install === undefined) {
      install = this.install(provision);
      this.installs.set(key, install);
    }
    return install;
  }

  /**
   * Removes a provision's version-scoped install directory.
   * @param provision The provisioning recipe.
   * @returns Returns a promise that resolves once the install is gone.
   */
  public async remove(provision: LockfileProvision): Promise<void> {
    const directory: string | null = this.directoryOf(provision);
    if (directory === null) {
      return;
    }
    logger.info(this.logName, `Removing provisioned tree ${directory}`);
    await fs.rm(directory, { recursive: true, force: true });
    // Prune the version and id directories the platform directory sat under, so uninstalling does not
    // leave a skeleton of empty folders behind. `rmdir` refuses a non-empty directory, which is exactly
    // the wanted behaviour when another platform or version is still installed.
    await fs.rmdir(path.dirname(directory)).catch((): void => undefined);
    await fs.rmdir(path.dirname(path.dirname(directory))).catch((): void => undefined);
    this.installs.delete(`${provision.id} ${provision.version} ${platformKey()}`);
  }

  /**
   * Fetches and verifies the lockfile, then installs every package it names.
   *
   * Fails **atomically**: any package that cannot be verified fails the whole install and takes the
   * directory with it. A tree missing one package is not a smaller tree, it is a broken one, and
   * reporting success for it would hand the caller something that fails later and further away.
   * @param provision The provisioning recipe.
   * @returns Returns the entry point path, or null on any failure.
   */
  private async install(provision: LockfileProvision): Promise<string | null> {
    const directory: string | null = this.directoryOf(provision);
    const target: string | null = this.targetOf(provision);
    if (directory === null || target === null) {
      logger.warn(this.logName, `Cannot provision ${provision.id}: provisioning disabled`);
      return null;
    }
    if (this.isInstalled(provision)) {
      return target;
    }
    try {
      // Start clean: a previous attempt may have left a partial tree behind.
      await fs.rm(directory, { recursive: true, force: true });
      await fs.mkdir(directory, { recursive: true });
      const packages: readonly LockfilePackage[] | null = await this.readLockfile(
        provision,
        directory,
      );
      if (packages === null) {
        await fs.rm(directory, { recursive: true, force: true });
        return null;
      }
      logger.info(
        this.logName,
        `Installing ${provision.id} ${provision.version}: ${packages.length} packages`,
      );
      for (const entry of packages) {
        if (!(await this.installPackage(entry, directory, provision.id))) {
          await fs.rm(directory, { recursive: true, force: true });
          return null;
        }
      }
      if (!existsSync(target)) {
        logger.warn(this.logName, `Installed ${provision.id} but its entry point is missing`);
        await fs.rm(directory, { recursive: true, force: true });
        return null;
      }
      await markComplete(directory);
      logger.info(this.logName, `Installed ${provision.id} at ${target}`);
      return target;
    } catch (error: unknown) {
      logger.error(this.logName, `Failed to provision ${provision.id}`, error);
      await fs.rm(directory, { recursive: true, force: true }).catch((): void => undefined);
      return null;
    }
  }

  /**
   * Downloads the lockfile, verifies it against its pinned hash, and reads it.
   *
   * The lockfile is itself a downloaded artefact and gets no more trust than one: it decides which
   * tarballs are fetched, so it is hashed before it is parsed, not after.
   * @param provision The provisioning recipe.
   * @param directory The install directory, used as scratch space.
   * @returns Returns the packages to install, or null when the lockfile is wrong or unreadable.
   */
  private async readLockfile(
    provision: LockfileProvision,
    directory: string,
  ): Promise<readonly LockfilePackage[] | null> {
    const file: string = path.join(directory, '.lockfile.json');
    await downloadTo(provision.lockfileUrl, file);
    const digest: string = await sha256Of(file);
    if (digest !== provision.sha256) {
      logger.error(
        this.logName,
        `Lockfile checksum mismatch for ${provision.id}: expected ${provision.sha256}, got ${digest}`,
      );
      return null;
    }
    const packages: readonly LockfilePackage[] | null = parseLockfile(
      await fs.readFile(file, 'utf8'),
    );
    await fs.rm(file, { force: true });
    if (packages === null) {
      logger.error(this.logName, `Lockfile for ${provision.id} is not one this can honour`);
      return null;
    }
    return packages;
  }

  /**
   * Downloads one package, verifies its integrity, and unpacks it to the path the lockfile named.
   * @param entry The package to install.
   * @param directory The install root.
   * @param id The plugin identifier, for logging.
   * @returns Returns true when the package was verified and extracted.
   */
  private async installPackage(
    entry: LockfilePackage,
    directory: string,
    id: string,
  ): Promise<boolean> {
    const destination: string = path.join(directory, entry.path);
    await fs.mkdir(destination, { recursive: true });
    const tarball: string = path.join(destination, '.package.tgz');
    await downloadTo(entry.url, tarball);
    const actual: string = await integrityOf(tarball, entry.algorithm);
    if (actual !== entry.integrity) {
      logger.error(
        this.logName,
        `Integrity mismatch installing ${id}: ${entry.path} expected ${entry.integrity}, got ${actual}`,
      );
      return false;
    }
    // npm tarballs are rooted at `package/`, and the lockfile's paths assume that root is gone.
    await extractArchive(tarball, destination, 'tar.gz', 1);
    await fs.rm(tarball, { force: true });
    return true;
  }
}
