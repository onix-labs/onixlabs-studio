import { Service, signal, Signal, WritableSignal } from '@angular/core';
import { PluginSummary } from '@shared/api/plugin-channels';

/**
 * Owns the one question every plugin install must ask first: "do you accept running this
 * third-party code?" It holds the plugin whose terms are currently up (rendered by the consent host
 * mounted at the application root, in its own window like every modal) and resolves each request
 * with the user's answer.
 *
 * One place, so that every entry point to an install — the Plugin Manager's button, the
 * "support isn't installed" notification, anything else that comes along — asks the same terms the
 * same way. The notification used to install directly; consent that one button could skip was not
 * consent.
 */
@Service()
export class PluginConsent {
  /**
   * Holds the plugin whose terms are being asked, or null when nothing is being asked.
   */
  private readonly asking: WritableSignal<PluginSummary | null> = signal<PluginSummary | null>(
    null,
  );

  /**
   * Holds the resolver of the request in flight, or null when nothing is being asked.
   */
  private answer: ((accepted: boolean) => void) | null = null;

  /**
   * Gets the plugin whose terms are being asked, or null when nothing is being asked.
   */
  public readonly pending: Signal<PluginSummary | null> = this.asking.asReadonly();

  /**
   * Puts a plugin's terms in front of the user and waits for the answer. A request made while
   * another is still being asked is refused (resolves false) rather than queued: consent is a
   * deliberate act, and a dialog that reappears the moment one is answered invites a reflex click.
   * @param plugin The plugin to ask about.
   * @returns Returns a promise that resolves true when the terms are accepted, false otherwise.
   */
  public request(plugin: PluginSummary): Promise<boolean> {
    if (this.answer !== null) {
      return Promise.resolve(false);
    }
    this.asking.set(plugin);
    return new Promise<boolean>((resolve: (accepted: boolean) => void): void => {
      this.answer = resolve;
    });
  }

  /**
   * Accepts the terms being asked.
   */
  public accept(): void {
    this.settle(true);
  }

  /**
   * Declines the terms being asked. Dismissing the window means the same thing, and is deliberately
   * the same outcome: nothing is fetched and nothing is written.
   */
  public decline(): void {
    this.settle(false);
  }

  /**
   * Resolves the request in flight, if any, and clears the question.
   * @param accepted The user's answer.
   */
  private settle(accepted: boolean): void {
    const resolve: ((accepted: boolean) => void) | null = this.answer;
    this.answer = null;
    this.asking.set(null);
    resolve?.(accepted);
  }
}
