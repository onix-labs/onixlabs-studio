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
        --tool-panel-bar-background: var(--gray-200);
        --tool-panel-bar-foreground: var(--gray-700);
        --tool-panel-body-background: var(--gray-200);

        display: flex;
        flex-direction: column;
        block-size: 100%;
        color: var(--body-foreground-color);
        background: var(--tool-panel-body-background);
      }

      :host-context([data-theme-mode='dark']) {
        --tool-panel-bar-background: color-mix(in srgb, var(--gray-900), var(--gray-800));
        --tool-panel-bar-foreground: var(--gray-400);
        --tool-panel-body-background: color-mix(in srgb, var(--gray-900), var(--gray-800));
      }

      .tool-panel__header {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.125rem 0.25rem 0.5rem;
        background: var(--tool-panel-bar-background);
        color: var(--tool-panel-bar-foreground);
      }

      .tool-panel__icon {
        font-size: 0.9rem;
      }

      .tool-panel__title {
        flex: 1;
        margin: 0;
        font-size: 0.75rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.03em;
      }

      .tool-panel__close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        inline-size: 1.5rem;
        block-size: 1.5rem;
        font-size: 0.9rem;
        color: inherit;
        background: transparent;
        border: 0.0625rem solid transparent;
        border-radius: 0.375rem;
        corner-shape: squircle;
        cursor: pointer;
        transition: var(--hover-transition);

        &:hover {
          color: var(--accent-surface-foreground-color);
          background: var(--accent-surface-background-color);
          border-color: var(--accent-surface-border-color);
        }

        &:focus-visible {
          outline: var(--focus-ring-width) solid var(--focus-ring-color);
          outline-offset: -0.125rem;
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
