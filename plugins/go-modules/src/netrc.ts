// A reader for `.netrc`, where the go command finds the user and password for a private module proxy
// (`GOAUTH=netrc`, its default).
//
// The file is a run of whitespace-separated tokens: `machine <host>` starts an entry, `login` and
// `password` fill it, and `default` starts the entry used for every other host. `macdef` starts a macro
// that runs to the next blank line, which is skipped. The go command ignores `default`, and so does
// this: a catch-all password must not be sent to whatever host a proxy list names.

/**
 * One machine's credentials.
 */
export interface NetrcEntry {
  /**
   * Gets the host the credentials are for.
   */
  readonly machine: string;

  /**
   * Gets the user name.
   */
  readonly login: string;

  /**
   * Gets the password.
   */
  readonly password: string;
}

/**
 * Reads a `.netrc` into its machine entries. An entry without both a login and a password is dropped,
 * as the go command drops it.
 * @param text The file.
 * @returns Returns the entries, in file order.
 */
export function parseNetrc(text: string): readonly NetrcEntry[] {
  const entries: NetrcEntry[] = [];
  const lines: readonly string[] = text.split('\n');
  let machine: string | null = null;
  let login: string = '';
  let password: string = '';
  const flush: () => void = (): void => {
    if (machine !== null && login.length > 0 && password.length > 0) {
      entries.push({ machine, login, password });
    }
    machine = null;
    login = '';
    password = '';
  };
  let inMacro: boolean = false;
  for (const line of lines) {
    if (inMacro) {
      inMacro = line.trim().length > 0;
      continue;
    }
    const tokens: readonly string[] = line.trim().split(/\s+/).filter(Boolean);
    for (let index: number = 0; index < tokens.length; index += 1) {
      const token: string = tokens[index];
      const value: string | undefined = tokens[index + 1];
      if (token === 'machine' && value !== undefined) {
        flush();
        machine = value;
        index += 1;
      } else if (token === 'default') {
        flush();
      } else if (token === 'login' && value !== undefined) {
        login = value;
        index += 1;
      } else if (token === 'password' && value !== undefined) {
        password = value;
        index += 1;
      } else if (token === 'macdef') {
        flush();
        inMacro = true;
        break;
      }
    }
  }
  flush();
  return entries;
}

/**
 * Finds the credentials for a host. The last entry for a host wins, as the go command reads it.
 * @param entries The entries.
 * @param host The host, as a URL's `hostname` gives it.
 * @returns Returns the entry, or null when the file has none for the host.
 */
export function netrcFor(entries: readonly NetrcEntry[], host: string): NetrcEntry | null {
  let found: NetrcEntry | null = null;
  for (const entry of entries) {
    if (entry.machine.toLowerCase() === host.toLowerCase()) {
      found = entry;
    }
  }
  return found;
}
