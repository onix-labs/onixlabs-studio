import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { Icon } from '../../../../../icons/icon';
import {
  MarkdownCommands,
  OutlineHeading,
} from '../../../../../services/markdown-commands/markdown-commands';
import { MarkdownToolPanel } from '../markdown-tool-panel/markdown-tool-panel';

/**
 * The Outline tool panel: a navigable outline of the document's headings and subheadings (including
 * setext headings). Clicking a heading scrolls the editor to it.
 */
@Component({
  selector: 'app-markdown-outline-panel',
  imports: [MarkdownToolPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-markdown-tool-panel title="Outline" [icon]="Icon.OUTLINE">
      @if (outline().length > 0) {
        <ul class="outline">
          @for (heading of outline(); track heading.id) {
            <li>
              <button
                type="button"
                class="outline__item"
                [class]="'outline__item--h' + heading.level"
                [style.padding-inline-start.rem]="0.5 + (heading.level - 1) * 0.85"
                [title]="heading.text"
                (click)="goTo(heading)"
              >
                {{ heading.text || 'Untitled heading' }}
              </button>
            </li>
          }
        </ul>
      } @else {
        <p class="outline__empty">No headings yet. Add a heading to build the outline.</p>
      }
    </app-markdown-tool-panel>
  `,
  styles: [
    `
      .outline {
        display: flex;
        flex-direction: column;
        gap: 0.05rem;
        margin: 0;
        padding: 0;
        list-style: none;
      }

      .outline__item {
        display: block;
        inline-size: 100%;
        padding-block: 0.3rem;
        padding-inline-end: 0.4rem;
        overflow: hidden;
        font: inherit;
        font-size: 0.85rem;
        color: var(--body-foreground-color);
        text-align: start;
        text-overflow: ellipsis;
        white-space: nowrap;
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

      .outline__item--h1 {
        font-weight: 600;
      }

      .outline__item--h2 {
        font-weight: 500;
      }

      .outline__item--h3,
      .outline__item--h4,
      .outline__item--h5,
      .outline__item--h6 {
        color: var(--welcome-muted-foreground-color);
      }

      .outline__empty {
        margin: 0;
        font-size: 0.85rem;
        line-height: 1.5;
        color: var(--welcome-muted-foreground-color);
      }
    `,
  ],
})
export class MarkdownOutlinePanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the markdown command registry publishing the active editor's outline.
   */
  private readonly commands: MarkdownCommands = inject(MarkdownCommands);

  /**
   * Gets the active document's headings, in document order.
   */
  protected readonly outline: Signal<readonly OutlineHeading[]> = this.commands.outline;

  /**
   * Navigates the editor to the given heading.
   * @param heading The heading to scroll to.
   */
  protected goTo(heading: OutlineHeading): void {
    this.commands.goToHeading(heading.index);
  }
}
