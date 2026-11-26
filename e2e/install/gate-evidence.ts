import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';

/**
 * Lists a directory tree, one entry per line with its size, into a file — what a plugin install
 * folder held when a run ended, which is the first thing to read when an install went wrong.
 * @param root The directory.
 * @param file The listing to write.
 */
export function listTree(root: string, file: string): void {
  const lines: string[] = [];
  const walk: (directory: string) => void = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error: unknown) {
      lines.push(`${path.relative(root, directory)}/  (unreadable: ${String(error)})`);
      return;
    }
    for (const entry of entries.sort((left: fs.Dirent, right: fs.Dirent): number =>
      left.name.localeCompare(right.name),
    )) {
      const full: string = path.join(directory, entry.name);
      const relative: string = path.relative(root, full);
      if (entry.isSymbolicLink()) {
        lines.push(`${relative} -> ${fs.readlinkSync(full)}`);
      } else if (entry.isDirectory()) {
        lines.push(`${relative}/`);
        walk(full);
      } else {
        lines.push(`${relative}  ${fs.statSync(full).size}`);
      }
    }
  };
  if (fs.existsSync(root)) {
    walk(root);
  } else {
    lines.push(`${root} does not exist`);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
}

/**
 * Copies every log Studio wrote under its profile — its own log archive and whatever a plugin or a
 * provisioner left — keeping their paths.
 * @param userData Studio's profile.
 * @param target The directory to copy into.
 */
export function copyLogs(userData: string, target: string): void {
  const walk: (directory: string) => void = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full: string = path.join(directory, entry.name);
      // node_modules holds packages' own changelogs and fixtures, not anything Studio logged.
      if (entry.isDirectory() && entry.name !== 'node_modules') {
        walk(full);
      } else if (entry.isFile() && /\.log(\.\d+)?$|\.jsonl$/.test(entry.name)) {
        const copy: string = path.join(target, path.relative(userData, full));
        fs.mkdirSync(path.dirname(copy), { recursive: true });
        fs.copyFileSync(full, copy);
      }
    }
  };
  walk(userData);
}

/**
 * Screenshots every window the application has open.
 * @param app The application.
 * @param directory Where to write them.
 * @param label What the moment is, for the file names.
 */
export async function screenshotWindows(
  app: ElectronApplication,
  directory: string,
  label: string,
): Promise<void> {
  fs.mkdirSync(directory, { recursive: true });
  const windows: readonly Page[] = app
    .windows()
    .filter((window: Page): boolean => !window.isClosed());
  await Promise.all(
    windows.map(async (window: Page, index: number): Promise<void> => {
      try {
        await window.screenshot({ path: path.join(directory, `${label}-${index}.png`) });
      } catch {
        // A window can close while it is being photographed; the others are still worth having.
      }
    }),
  );
}
