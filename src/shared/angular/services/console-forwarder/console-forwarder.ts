import { Service } from '@angular/core';
import { Bridge } from '@shared/api/bridge';
import { LogChannel, LogLevel, MAX_LOG_MESSAGE_LENGTH } from '@shared/api/log-channels';

/**
 * Names the console method a forwarded entry originates from; identical to the log level it is
 * reported with.
 */
const FORWARDED_LEVELS: readonly LogLevel[] = ['log', 'info', 'warn', 'error', 'debug'];

/**
 * Intercepts the renderer's console methods and forwards each entry to the main-process logger over
 * the generic bridge (dev runs land on stdout, packaged runs in the rotating log files), while still
 * calling the native method so DevTools output is unchanged. Instantiated by an app initializer so
 * the earliest boot logs are captured. Outside Electron the bridge is absent and the console is left
 * untouched, so the service is a safe no-op in the browser.
 */
@Service()
export class ConsoleForwarder {
  /**
   * Holds the IPC bridge to the main-process logger, or undefined outside Electron.
   */
  private readonly bridge: Bridge | undefined = window.bridge;

  /**
   * Holds each intercepted method's native implementation, for pass-through and {@link restore}.
   */
  private readonly natives: Map<LogLevel, (...args: unknown[]) => void> = new Map<
    LogLevel,
    (...args: unknown[]) => void
  >();

  /**
   * Holds a value indicating whether a forward is already in flight, so a bridge implementation
   * that itself logs cannot recurse back into the interceptor.
   */
  private forwarding: boolean = false;

  /**
   * Initializes the service, intercepting the console methods when the bridge is present.
   */
  public constructor() {
    if (this.bridge !== undefined) {
      this.intercept();
    }
  }

  /**
   * Restores the native console methods, ending the forwarding. Used when tearing the interception
   * down (tests); the app itself forwards for its whole lifetime.
   */
  public restore(): void {
    for (const [level, native] of this.natives) {
      (console as unknown as Record<LogLevel, (...args: unknown[]) => void>)[level] = native;
    }
    this.natives.clear();
  }

  /**
   * Replaces each console method with a wrapper that calls the native implementation first, then
   * forwards the serialised entry over the bridge.
   */
  private intercept(): void {
    const target: Record<LogLevel, (...args: unknown[]) => void> = console;
    for (const level of FORWARDED_LEVELS) {
      const native: (...args: unknown[]) => void = target[level].bind(console);
      this.natives.set(level, target[level]);
      target[level] = (...args: unknown[]): void => {
        native(...args);
        this.forward(level, args);
      };
    }
  }

  /**
   * Forwards one console entry over the bridge, guarding against recursion and never letting a
   * forwarding failure surface to the caller — logging must not be able to break the app.
   * @param level The console severity.
   * @param args The console call's arguments.
   */
  private forward(level: LogLevel, args: readonly unknown[]): void {
    if (this.forwarding || this.bridge === undefined) {
      return;
    }
    this.forwarding = true;
    try {
      this.bridge.send(LogChannel.Write, { level, message: this.serialize(args) });
    } catch {
      // A failed forward is deliberately swallowed; the native console output already happened.
    } finally {
      this.forwarding = false;
    }
  }

  /**
   * Serialises a console call's arguments to one length-capped line: strings pass through, errors
   * keep their stack, and objects are JSON-encoded with a string fallback for circular structures.
   * @param args The console call's arguments.
   * @returns Returns the space-joined, capped message text.
   */
  private serialize(args: readonly unknown[]): string {
    const parts: string[] = args.map((arg: unknown): string => {
      if (typeof arg === 'string') {
        return arg;
      }
      if (arg instanceof Error) {
        return arg.stack ?? `${arg.name}: ${arg.message}`;
      }
      try {
        return JSON.stringify(arg) ?? String(arg);
      } catch {
        return String(arg);
      }
    });
    return parts.join(' ').slice(0, MAX_LOG_MESSAGE_LENGTH);
  }
}
