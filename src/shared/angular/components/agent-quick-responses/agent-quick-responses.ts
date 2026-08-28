import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { TextField } from '@shared/angular/components/forms/text-field/text-field';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Icon } from '@shared/angular/icons/icon';
import {
  AgentQuickResponses as QuickResponseLibrary,
  QuickResponse,
} from '@shared/angular/services/agent-quick-responses/agent-quick-responses';

/**
 * The composer's quick-response menu: an icon button opening a drop-up of the user's saved one-line
 * replies, with a field at its foot for adding another and a delete control on every row.
 *
 * Picking a response is reported to the host rather than acted on here, because what a saved reply
 * means depends on what is already in the composer — the menu's job is to say which one was chosen.
 *
 * The list is the user's own: there are no built-in replies beyond the starter set the library seeds,
 * since a reply that reads naturally to one person is somebody else's clutter.
 */
@Component({
  selector: 'app-agent-quick-responses',
  imports: [AppIcon, Button, TextField, CdkMenu, CdkMenuItem, CdkMenuTrigger],
  templateUrl: './agent-quick-responses.html',
  styleUrl: './agent-quick-responses.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentQuickResponses {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the saved replies.
   */
  private readonly library: QuickResponseLibrary = inject(QuickResponseLibrary);

  /**
   * Gets the saved replies, in the order they were added.
   */
  protected readonly responses: Signal<readonly QuickResponse[]> = this.library.responses;

  /**
   * Holds what has been typed into the add field.
   */
  protected readonly draft: WritableSignal<string> = signal<string>('');

  /**
   * Gets the position that opens the menu upward from the button, their leading edges aligned. The
   * composer sits at the foot of the panel, so a downward menu would open off the bottom of it.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['up-start'];

  /**
   * Emitted with the text of the response the user picked.
   */
  public readonly chosen: OutputEmitterRef<string> = output<string>();

  /**
   * Reports the picked response to the host.
   * @param response The picked response.
   */
  protected choose(response: QuickResponse): void {
    this.chosen.emit(response.text);
  }

  /**
   * Adds what has been typed as a new response, clearing the field on success. A blank or duplicate
   * entry is refused by the library, and the field keeps its text so it can be corrected rather than
   * retyped.
   */
  protected add(): void {
    if (this.library.add(this.draft())) {
      this.draft.set('');
    }
  }

  /**
   * Deletes a response.
   * @param response The response to delete.
   */
  protected remove(response: QuickResponse): void {
    this.library.remove(response.id);
  }
}
