import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  app,
  HeadersReceivedResponse,
  ipcMain,
  IpcMainInvokeEvent,
  OnHeadersReceivedListenerDetails,
  session,
} from 'electron';
import { ImageSourcePolicy, SecurityChannel } from '@shared/api/security-channels';
import { MEDIA_SCHEME } from './media-protocol';

/**
 * The image-source policies accepted from the renderer, used to validate untrusted input.
 */
const POLICIES: readonly ImageSourcePolicy[] = ['local', 'https', 'all'];

/**
 * Owns the application's runtime security policy in the main process: it sets a strict
 * Content-Security-Policy header on every response and lets the user choose how permissive the
 * `img-src` directive is. The policy is persisted in the user-data directory so the correct CSP is in
 * place before the window first paints (the renderer cannot supply it in time); a change takes effect
 * the next time the window loads.
 */
export class SecurityManager {
  /**
   * Holds a value indicating whether the app is loaded from the dev server (which needs the CSP
   * relaxed for hot-module-reload websockets and origin).
   */
  private readonly isDev: boolean = process.env['ELECTRON_START_URL'] !== undefined;

  /**
   * Holds the active image-source policy. Defaults to allowing `https:` images (in addition to the
   * always-permitted local, data and blob sources) so the markdown editor shows remote images out of
   * the box; plain `http:` stays blocked until the user opts into it.
   */
  private policy: ImageSourcePolicy = 'https';

  /**
   * Restores the persisted policy, installs the CSP response-header listener, and registers the
   * policy IPC handlers. Must run before the window loads so the header is in place for the first load.
   */
  public register(): void {
    this.policy = this.load();

    session.defaultSession.webRequest.onHeadersReceived(
      (
        details: OnHeadersReceivedListenerDetails,
        callback: (response: HeadersReceivedResponse) => void,
      ): void => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [this.buildContentSecurityPolicy()],
          },
        });
      },
    );

    ipcMain.handle(SecurityChannel.GetImagePolicy, (): ImageSourcePolicy => this.policy);
    ipcMain.handle(
      SecurityChannel.SetImagePolicy,
      (_event: IpcMainInvokeEvent, value: unknown): ImageSourcePolicy => this.setImagePolicy(value),
    );
  }

  /**
   * Builds the Content-Security-Policy header value. Scripts, styles, fonts and workers are locked to
   * the app and the few schemes Monaco/Milkdown require; remote connections are forbidden in
   * production (relaxed only for the dev server). The `img-src` directive follows the user's policy.
   * @returns Returns the CSP header value.
   */
  private buildContentSecurityPolicy(): string {
    const connectSrc: string = this.isDev ? "'self' ws: wss: http: https:" : "'self'";
    return [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' blob:",
      "style-src 'self' 'unsafe-inline'",
      `img-src ${this.imageSources()}`,
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      `connect-src ${connectSrc}`,
      "object-src 'none'",
      "base-uri 'self'",
      "frame-src 'none'",
    ].join('; ');
  }

  /**
   * Builds the `img-src` source list for the active policy.
   * @returns Returns the space-separated image sources.
   */
  private imageSources(): string {
    // The custom media scheme is always permitted: it is the main process's own loader for the local
    // image files the markdown editor references, serving them in place of the forbidden `file:` scheme.
    const base: string = `'self' data: blob: ${MEDIA_SCHEME}:`;
    if (this.policy === 'https') {
      return `${base} https:`;
    }
    if (this.policy === 'all') {
      return `${base} https: http:`;
    }
    return base;
  }

  /**
   * Validates and stores a new image-source policy, persisting it for subsequent launches.
   * @param value The candidate policy from the renderer.
   * @returns Returns the stored policy (unchanged when the candidate is invalid).
   */
  private setImagePolicy(value: unknown): ImageSourcePolicy {
    if (this.isPolicy(value)) {
      this.policy = value;
      this.save();
    }
    return this.policy;
  }

  /**
   * Restores the persisted policy from the user-data directory, defaulting to the `https` policy when
   * none has been saved.
   * @returns Returns the restored policy.
   */
  private load(): ImageSourcePolicy {
    try {
      const file: string = this.storeFile();
      if (existsSync(file)) {
        const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
        const candidate: unknown = (parsed as { imagePolicy?: unknown })?.imagePolicy;
        if (this.isPolicy(candidate)) {
          return candidate;
        }
      }
    } catch {
      // Fall through to the default when the store is missing or corrupt.
    }
    return 'https';
  }

  /**
   * Persists the active policy to the user-data directory (best-effort).
   */
  private save(): void {
    try {
      writeFileSync(this.storeFile(), JSON.stringify({ imagePolicy: this.policy }), {
        encoding: 'utf8',
        mode: 0o600,
      });
    } catch {
      // Persistence is best-effort; a failure simply means the choice is not remembered.
    }
  }

  /**
   * Gets the absolute path of the security store file.
   * @returns Returns the store path.
   */
  private storeFile(): string {
    return join(app.getPath('userData'), 'security.json');
  }

  /**
   * Narrows an untrusted value to an {@link ImageSourcePolicy}.
   * @param value The value to test.
   * @returns Returns true when the value is a known policy.
   */
  private isPolicy(value: unknown): value is ImageSourcePolicy {
    return typeof value === 'string' && (POLICIES as readonly string[]).includes(value);
  }
}
