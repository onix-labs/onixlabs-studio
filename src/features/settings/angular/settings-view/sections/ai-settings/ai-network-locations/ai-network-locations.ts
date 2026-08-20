import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { SettingRow } from '@shared/angular/components/forms/setting-row/setting-row';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { Log } from '@shared/angular/services/log/log';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import { normaliseNetworkLocation } from '@shared/api/network-locations';

/**
 * Which network list a row belongs to: the allow list (the only hosts the agent may reach) or the
 * deny list (hosts it may never reach).
 */
type ListKind = 'allow' | 'deny';

/**
 * Represents the network-location editor in the AI settings section: two host lists governing where
 * the agent may send traffic, the counterpart of the write-path editor beside it.
 *
 * It is a sibling component rather than a mode of that editor because the two collect different
 * things in different ways — a directory comes from a picker, a host is typed — and merging them
 * would mean one component with two personalities. What the user types is normalised as it is added
 * (`https://api.example.com/v1` and `api.example.com:8443` both become `api.example.com`), so the
 * stored list is hosts however the entry was pasted.
 */
@Component({
  selector: 'app-ai-network-locations',
  imports: [Button, SettingRow, TextField],
  templateUrl: './ai-network-locations.html',
  styleUrl: './ai-network-locations.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiNetworkLocations {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the settings service the lists are read from and written to.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the hosts the agent may reach.
   */
  protected readonly allowed: Signal<readonly string[]> = this.settings.aiAllowedNetworkLocations;

  /**
   * Gets the hosts the agent may never reach.
   */
  protected readonly denied: Signal<readonly string[]> = this.settings.aiDeniedNetworkLocations;

  /**
   * Holds what is being typed into the allow list's field.
   */
  protected readonly allowDraft: WritableSignal<string> = signal<string>('');

  /**
   * Holds what is being typed into the deny list's field.
   */
  protected readonly denyDraft: WritableSignal<string> = signal<string>('');

  /**
   * Adds what has been typed to a list, normalised to a host and ignoring a duplicate or a blank.
   * @param kind Which list to add to.
   */
  protected add(kind: ListKind): void {
    const draft: WritableSignal<string> = kind === 'allow' ? this.allowDraft : this.denyDraft;
    const host: string = normaliseNetworkLocation(draft());
    if (host === '') {
      return;
    }
    draft.set('');
    const current: readonly string[] = this.current(kind);
    if (current.includes(host)) {
      return;
    }
    this.log.info('settings.ai', 'Network location added', kind, host);
    this.commit(kind, [...current, host]);
  }

  /**
   * Removes a host from a list.
   * @param kind Which list the host is in.
   * @param index The entry index.
   */
  protected remove(kind: ListKind, index: number): void {
    this.log.info('settings.ai', 'Network location removed', kind, this.current(kind)[index]);
    this.commit(
      kind,
      this.current(kind).filter((_: string, i: number): boolean => i !== index),
    );
  }

  /**
   * Gets a list's current entries.
   * @param kind Which list.
   * @returns Returns the entries.
   */
  private current(kind: ListKind): readonly string[] {
    return kind === 'allow' ? this.allowed() : this.denied();
  }

  /**
   * Persists a list's entries.
   * @param kind Which list.
   * @param next The new entries.
   */
  private commit(kind: ListKind, next: readonly string[]): void {
    if (kind === 'allow') {
      this.settings.setAiAllowedNetworkLocations(next);
    } else {
      this.settings.setAiDeniedNetworkLocations(next);
    }
  }
}
