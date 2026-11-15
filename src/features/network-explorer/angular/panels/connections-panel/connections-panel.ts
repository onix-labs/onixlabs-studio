import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { Chip, ChipTone } from '@shared/angular/components/chip/chip';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { PanelToolbar } from '@shared/angular/components/panel-toolbar/panel-toolbar';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { NetworkInterfaceInfo } from '@shared/api/system-monitor-channels';
import { NetworkActivity } from '../../network-activity/network-activity';

/**
 * The Network Explorer's Connections panel: every connection this machine has open to a remote peer,
 * with the process that owns it, both ends, its protocol and its state.
 *
 * Listening sockets are left out — they are waiting for a peer, not connected to one — and so,
 * unless asked for, are connections between this machine and itself. Choosing an interface in the
 * Interfaces panel narrows the list to the connections made over it.
 *
 * Each row's remote peer is what ping and traceroute will be run against.
 */
@Component({
  selector: 'app-connections-panel',
  imports: [Button, Chip, PanelToolbar, TextField],
  templateUrl: './connections-panel.html',
  styleUrl: './connections-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConnectionsPanel {
  /**
   * Gets the dock panel this component is projected into.
   */
  public readonly panel: InputSignal<DockPanel> = input.required<DockPanel>();

  /**
   * Holds the tab's network readings and selection.
   */
  protected readonly activity: NetworkActivity = inject(NetworkActivity);

  /**
   * Holds the icon tokens used by the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets what the list is showing, for the strip: how many connections, and over which interface.
   */
  protected readonly summary: Signal<string> = computed((): string => {
    const count: number = this.activity.connections().length;
    const noun: string = count === 1 ? 'connection' : 'connections';
    const selected: NetworkInterfaceInfo | undefined = this.activity.selectedInterface();
    return selected === undefined
      ? `${count} ${noun}`
      : `${count} ${noun} over ${selected.name} (${selected.id})`;
  });

  /**
   * Gets the tone a connection's state is shown in: established connections are good, ones opening or
   * closing are in between, the rest quiet.
   * @param state The state.
   * @returns Returns the tone.
   */
  protected toneOf(state: string): ChipTone {
    if (state === 'ESTABLISHED') {
      return 'success';
    }
    return state.startsWith('SYN') || state.endsWith('WAIT') ? 'warning' : 'neutral';
  }
}
