import type { RunContainerRequest } from '@shared/api/container-types';

/**
 * What the Run dialog's fields hold, as typed.
 */
export interface RunForm {
  /**
   * Gets the image reference.
   */
  readonly image: string;

  /**
   * Gets the container's name, or empty for one the engine chooses.
   */
  readonly name: string;

  /**
   * Gets the ports to publish, as `host:container` pairs separated by commas or spaces, each
   * optionally followed by `/udp` — `8080:80, 5353:53/udp`.
   */
  readonly ports: string;

  /**
   * Gets the environment, one `KEY=value` per line.
   */
  readonly env: string;

  /**
   * Gets the mounts, as `source:target` separated by commas or new lines, each optionally followed by
   * `:ro` — `data:/var/lib/postgresql/data, /Users/me/site:/usr/share/nginx/html:ro`.
   */
  readonly volumes: string;
}

/**
 * Reads a run form into a request, or says what in it cannot be read (#974).
 * @param form The form as typed.
 * @returns Returns the request, or the problems, one per bad entry.
 */
export function readRunForm(
  form: RunForm,
): { readonly request: RunContainerRequest } | { readonly problems: readonly string[] } {
  const problems: string[] = [];
  const image: string = form.image.trim();
  if (image.length === 0) {
    problems.push('Name the image to run.');
  }
  const name: string = form.name.trim();
  if (name.length > 0 && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
    problems.push(`"${name}" is not a container name: use letters, digits, '_', '.' and '-'.`);
  }
  const ports: { host: number; container: number; protocol: 'tcp' | 'udp' }[] = [];
  for (const entry of split(form.ports, /[\s,]+/)) {
    const match: RegExpExecArray | null = /^(\d{1,5}):(\d{1,5})(?:\/(tcp|udp))?$/i.exec(entry);
    const host: number = Number(match?.[1]);
    const container: number = Number(match?.[2]);
    if (match === null || !isPort(host) || !isPort(container)) {
      problems.push(`"${entry}" is not a port mapping: write host:container, as in 8080:80.`);
      continue;
    }
    ports.push({ host, container, protocol: match[3]?.toLowerCase() === 'udp' ? 'udp' : 'tcp' });
  }
  const env: Record<string, string> = {};
  for (const line of split(form.env, /\r?\n/)) {
    const equals: number = line.indexOf('=');
    const key: string = equals === -1 ? '' : line.slice(0, equals).trim();
    if (key.length === 0 || /\s/.test(key)) {
      problems.push(`"${line}" is not a variable: write KEY=value.`);
      continue;
    }
    env[key] = line.slice(equals + 1);
  }
  const volumes: { source: string; target: string; readOnly: boolean }[] = [];
  for (const entry of split(form.volumes, /[\n,]+/)) {
    const readOnly: boolean = entry.endsWith(':ro');
    const mount: string = readOnly ? entry.slice(0, -3) : entry;
    const colon: number = mount.indexOf(':', mount.startsWith('/') ? 1 : 0);
    const source: string = colon === -1 ? '' : mount.slice(0, colon);
    const target: string = colon === -1 ? '' : mount.slice(colon + 1);
    if (source.length === 0 || !target.startsWith('/')) {
      problems.push(`"${entry}" is not a mount: write source:/path, as in data:/var/lib/data.`);
      continue;
    }
    volumes.push({ source, target, readOnly });
  }
  return problems.length > 0
    ? { problems }
    : {
        request: {
          image,
          ...(name.length === 0 ? {} : { name }),
          ports,
          env,
          volumes,
        },
      };
}

/**
 * Splits text into its non-empty, trimmed entries.
 * @param text The text.
 * @param separator What separates entries.
 * @returns Returns the entries.
 */
function split(text: string, separator: RegExp): string[] {
  return text
    .split(separator)
    .map((entry: string): string => entry.trim())
    .filter((entry: string): boolean => entry.length > 0);
}

/**
 * Determines whether a number is a usable port.
 * @param value The number.
 * @returns Returns true when it is between 1 and 65535.
 */
function isPort(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value < 65_536;
}
