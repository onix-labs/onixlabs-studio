import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  signal,
  WritableSignal,
} from '@angular/core';
import { Icon } from '../../../icons/icon';
import { AppIcon } from '../../shared/icon/app-icon';
import { Modal } from '../../shared/modal/modal';

/**
 * Hosts the source-control workspace as a top-level tab — a visual Git surface (branches, history,
 * staging) in the spirit of GitKraken. The full view is still to come; for now this is a placeholder
 * so the tab type, its icon, and the welcome-screen entry point are wired end to end. It also carries
 * a temporary harness that exercises the reusable modal in both dismissable and blocking modes.
 */
@Component({
  selector: 'app-source-control-view',
  imports: [AppIcon, Modal],
  templateUrl: './source-control-view.html',
  styleUrl: './source-control-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceControlView {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets a value indicating whether the view belongs to the active tab.
   */
  public readonly isActive: InputSignal<boolean> = input<boolean>(false);

  /**
   * Holds whether the dismissable demo modal is open. Temporary harness for the reusable modal until
   * the real source-control surface lands.
   */
  protected readonly dismissableOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Holds whether the non-dismissable demo modal is open. Temporary harness for the reusable modal
   * until the real source-control surface lands.
   */
  protected readonly blockingOpen: WritableSignal<boolean> = signal<boolean>(false);

  /**
   * Opens the dismissable demo modal.
   */
  protected openDismissable(): void {
    this.dismissableOpen.set(true);
  }

  /**
   * Closes the dismissable demo modal.
   */
  protected closeDismissable(): void {
    this.dismissableOpen.set(false);
  }

  /**
   * Opens the non-dismissable demo modal.
   */
  protected openBlocking(): void {
    this.blockingOpen.set(true);
  }

  /**
   * Closes the non-dismissable demo modal.
   */
  protected closeBlocking(): void {
    this.blockingOpen.set(false);
  }
}
