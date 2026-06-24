import { ChangeDetectionStrategy, Component, inject, input, InputSignal } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import { AppIcon } from '../../../../shared/icon/app-icon';
import { MarkdownPanels } from '../../../../../services/markdown-panels/markdown-panels';

/**
 * The shared chrome for a markdown editor tool panel: a titled header with a close button and a
 * scrollable body into which the specific panel projects its content. Closing routes through the
 * {@link MarkdownPanels} registry.
 */
@Component({
  selector: 'app-markdown-tool-panel',
  imports: [AppIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="tool-panel__header">
      <app-icon class="tool-panel__icon" [icon]="icon()" />
      <h2 class="tool-panel__title">{{ title() }}</h2>
      <button type="button" class="tool-panel__close" aria-label="Close panel" (click)="onClose()">
        <app-icon [icon]="Icon.CLOSE" />
      </button>
    </header>
    <div class="tool-panel__body">
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        block-size: 100%;
        color: var(--body-foreground-color);
        background: var(--body-background-color);
      }

      .tool-panel__header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        padding: 0.5rem 0.5rem 0.5rem 0.75rem;
        border-block-end: 0.0625rem solid var(--dock-border-color);
      }

      .tool-panel__icon {
        color: var(--accent-color);
      }

      .tool-panel__title {
        flex: 1;
        margin: 0;
        font-size: 0.8rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .tool-panel__close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 1.6rem;
        block-size: 1.6rem;
        color: var(--welcome-muted-foreground-color);
        background: transparent;
        border: none;
        border-radius: 0.375rem;
        corner-shape: squircle;
        cursor: pointer;
        transition: var(--hover-transition);

        &:hover,
        &:focus-visible {
          color: var(--accent-surface-foreground-color);
          background: var(--accent-surface-background-color);
          outline: none;
        }
      }

      .tool-panel__body {
        flex: 1;
        min-block-size: 0;
        padding: 0.75rem;
        overflow: auto;
      }
    `,
  ],
})
export class MarkdownToolPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the panel's title.
   */
  public readonly title: InputSignal<string> = input.required<string>();

  /**
   * Gets the icon shown beside the title.
   */
  public readonly icon: InputSignal<Icon> = input.required<Icon>();

  /**
   * Holds the panel registry the close button routes through.
   */
  private readonly panels: MarkdownPanels = inject(MarkdownPanels);

  /**
   * Closes the panel.
   */
  protected onClose(): void {
    this.panels.close();
  }
}
