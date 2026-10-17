import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The suffix that names a development build's own userData directory beside the installed one's.
 */
const DEVELOPMENT_SUFFIX: string = '-dev';

/**
 * Studio's own files in a userData directory, which a new development profile starts with. Chromium's
 * storage, caches and locks are left behind: the installed instance keeps them locked while it runs,
 * and they belong to its origin anyway. So are logs, process journals and the audit log, which record
 * the installed instance's history, and conversations. Forge credentials are left too: they are
 * encrypted under the installed app's keychain entry, which a development build cannot read.
 */
export const SEEDED_ENTRIES: readonly string[] = [
  'plugins',
  'plugins.json',
  'plugin-index.json',
  'trusted-paths.json',
  'security.json',
  'agent-permission-rules.json',
  'lsp-settings.json',
  'lsp-servers',
  'debug-adapters',
  'skills',
  'speech-models',
  'clone.json',
  'startup-preferences.json',
  'window-state.json',
];

/**
 * The outcome of choosing a development build's userData directory.
 */
export interface DevelopmentUserData {
  /**
   * The directory the development build uses.
   */
  readonly directory: string;

  /**
   * The entries copied in from the installed profile, empty unless this launch created the directory.
   */
  readonly seeded: readonly string[];
}

/**
 * Chooses a development build's own userData directory and, the first time, seeds it from the
 * installed one.
 *
 * A development build launched while an installed Studio runs used to share its userData directory.
 * The installed instance holds Chromium's storage lock there, so the development build fell back to
 * storage held in memory, and everything it saved (the setup wizard's completion among it) was lost
 * at every restart. A directory of its own keeps what it saves. Seeding it from the installed profile
 * means it starts with the plugins, trusted paths and language servers already set up, rather than
 * from nothing. After that the two never touch each other.
 *
 * Copies are copy-on-write clones where the file system allows (APFS does), so a gigabyte of language
 * servers costs nothing. Install records name what they installed by absolute path, so the copied JSON
 * files are repointed from the installed directory to the new one; otherwise the development build
 * would run the installed build's servers and plugins. An entry that fails to copy is skipped: the
 * development build can install it again.
 * @param installed The installed build's userData directory.
 * @returns Returns the directory to use, and what was seeded into it.
 */
export function useDevelopmentUserData(installed: string): DevelopmentUserData {
  const directory: string = `${installed}${DEVELOPMENT_SUFFIX}`;
  if (fs.existsSync(directory)) {
    return { directory, seeded: [] };
  }
  fs.mkdirSync(directory, { recursive: true });
  const seeded: string[] = [];
  for (const entry of SEEDED_ENTRIES) {
    const source: string = path.join(installed, entry);
    if (!fs.existsSync(source)) {
      continue;
    }
    try {
      fs.cpSync(source, path.join(directory, entry), {
        recursive: true,
        mode: fs.constants.COPYFILE_FICLONE,
        verbatimSymlinks: true,
      });
      if (entry.endsWith('.json')) {
        repoint(path.join(directory, entry), installed, directory);
      }
      seeded.push(entry);
    } catch {
      // Best effort: whatever is missing, the development build sets up again.
    }
  }
  return { directory, seeded };
}

/**
 * Rewrites every mention of one directory in a JSON file as another, so the paths it records follow
 * the files they name to their new home.
 * @param file The JSON file.
 * @param from The directory the paths are under.
 * @param to The directory they move to.
 */
function repoint(file: string, from: string, to: string): void {
  // Matched as they are written in JSON, where a Windows path's separators are escaped.
  const written: (directory: string) => string = (directory: string): string =>
    JSON.stringify(directory).slice(1, -1);
  const text: string = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.split(written(from)).join(written(to)));
}
