import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  viewChild,
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
import { Settings } from '@shared/angular/services/settings/settings';
import { QuickResponseMode } from '@shared/angular/services/settings/settings-registry';

/**
 * Describes a picked quick response and what to do with it (#1420): send it, or put it in the composer.
 * With a draft already written, `send` means add the response and send the draft, and `insert` means
 * add it and leave the draft unsent.
 */
export interface QuickResponseChoice {
  /**
   * Gets the response's text.
   */
  readonly text: string;

  /**
   * Gets whether the composer sends after taking the text, or only takes it.
   */
  readonly mode: QuickResponseMode;
}

/**
 * Describes the second button on every row: the other of the two things picking a row does.
 */
interface AlternateAction {
  /**
   * Gets what the button does, as its label and tooltip.
   */
  readonly label: string;

  /**
   * Gets the button's icon.
   */
  readonly icon: Icon;

  /**
   * Gets the mode the button picks with.
   */
  readonly mode: QuickResponseMode;
}

/**
 * The composer's quick-response menu: an icon button opening a drop-up of the user's saved one-line
 * replies, with a field at its foot for adding another and a delete control on every row.
 *
 * Picking a response is reported to the host rather than acted on here, because what a saved reply
 * means depends on what is already in the composer — the menu's job is to say which one was chosen.
 *
 * The list is the user's own: there are no built-in replies beyond the starter set the library seeds,
 * since a reply that reads naturally to one person is somebody else's clutter. Its order is theirs
 * too — each row carries a grip, so the replies reached for most can be dragged to the top.
 */
@Component({
  selector: 'app-agent-quick-responses',
  imports: [
    AppIcon,
    Button,
    TextField,
    CdkMenu,
    CdkMenuItem,
    CdkMenuTrigger,
    CdkDrag,
    CdkDragHandle,
    CdkDropList,
  ],
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
   * Gets whether the composer already holds a draft. A draft is never sent by a plain pick, so with one
   * a row adds to it, and the row's second button is the explicit Add and Send.
   */
  public readonly hasDraft: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emitted with the response the user picked and what to do with it.
   */
  public readonly chosen: OutputEmitterRef<QuickResponseChoice> = output<QuickResponseChoice>();

  /**
   * Holds the user's choice of what picking a response does in an empty composer.
   */
  private readonly setting: Signal<QuickResponseMode> =
    inject(Settings).value('ai.quickResponseMode');

  /**
   * Holds the button that opens the menu, so the second button on a row can close it as picking does.
   */
  private readonly trigger: Signal<CdkMenuTrigger> = viewChild.required(CdkMenuTrigger);

  /**
   * Gets what picking a row does: added to a draft when there is one, otherwise the user's setting.
   */
  protected readonly pickMode: Signal<QuickResponseMode> = computed((): QuickResponseMode =>
    this.hasDraft() ? 'insert' : this.setting(),
  );

  /**
   * Gets the row's second button, which does the other thing: Add and Send with a draft, otherwise the
   * opposite of the setting.
   */
  protected readonly alternate: Signal<AlternateAction> = computed((): AlternateAction => {
    if (this.hasDraft()) {
      return { label: 'Add and Send', icon: Icon.SEND, mode: 'send' };
    }
    return this.setting() === 'send'
      ? { label: 'Insert for Editing', icon: Icon.PENCIL, mode: 'insert' }
      : { label: 'Send Now', icon: Icon.SEND, mode: 'send' };
  });

  /**
   * Reports a row's pick to the host, in the mode a plain pick has.
   * @param response The picked response.
   */
  protected choose(response: QuickResponse): void {
    this.chosen.emit({ text: response.text, mode: this.pickMode() });
  }

  /**
   * Reports a row's second button to the host and closes the menu, as picking the row does.
   * @param response The response.
   */
  protected chooseAlternate(response: QuickResponse): void {
    this.chosen.emit({ text: response.text, mode: this.alternate().mode });
    this.trigger().close();
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

  /**
   * Commits a drag by moving the dragged reply into the slot it was dropped on. The move is reported
   * to the library rather than applied to the rendered list, since the order is the library's and has
   * to be persisted; the rows re-render from it.
   * @param event The drop, carrying the row's position before and after.
   */
  protected onDrop(event: CdkDragDrop<readonly QuickResponse[]>): void {
    const saved: readonly QuickResponse[] = this.responses();
    const source: QuickResponse | undefined = saved[event.previousIndex];
    const target: QuickResponse | undefined = saved[event.currentIndex];
    if (source === undefined || target === undefined) {
      return;
    }
    this.library.reorder(source.id, target.id);
  }
}
