import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { Icon } from '@shared/angular/icons/icon';
import { AppIcon } from '@shared/angular/components/icon/app-icon';
import { Button } from '@shared/angular/components/forms/button/button';
import { PanelDragHandle } from '@shared/angular/components/panel-layout/panel-drag-handle';
import { Log } from '@shared/angular/services/log/log';

/**
 * The shared chrome for an editor tool panel: a titled header with a close button and a scrollable
 * body into which the specific panel projects its content. The header's close button raises
 * {@link closed} so the host decides what closing means (hiding the panel in its own registry/layout);
 * this component names no feature so it can be reused across the app.
 *
 * THIS is where a docked panel's appearance lives. Every dockable panel in the editor views (markdown,
 * code, terminal, binary) wears this chrome, so a panel cannot look different from its neighbours by
 * being written differently: a panel with extra header controls projects them into the `panelActions`
 * slot rather than rolling its own bar.
 *
 * The header doubles as the panel's drag handle: hosted inside a panel layout it drags the panel
 * onto another edge, and hosted anywhere else (such as the dock) the handle is inert.
 */
@Component({
  selector: 'app-tool-panel',
  imports: [AppIcon, Button, PanelDragHandle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (header()) {
      <header class="tool-panel__header" [appPanelDragHandle]="handle()">
        @if (icon(); as glyph) {
          <app-icon class="tool-panel__icon" [icon]="glyph" />
        }
        <h2 class="tool-panel__title">{{ title() }}</h2>
        <span class="tool-panel__spacer"></span>
        <ng-content select="[panelActions]" />
        @if (closable()) {
          <app-button
            variant="none"
            size="small"
            [icon]="Icon.CLOSE"
            [ariaLabel]="closeLabel()"
            [tooltip]="closeLabel()"
            (click)="onClose()"
          />
        }
      </header>
    }
    <div class="tool-panel__body" [class.tool-panel__body--flush]="flush()">
      <ng-content />
    </div>
  `,
  styles: [
    `
      // The header and body are transparent so the enclosing panel's shared surface shows through and
      // the whole panel reads as one piece. Only the header's muted foreground is set here, so a title
      // recedes against the content it labels.
      :host {
        --tool-panel-bar-foreground: var(--gray-700);

        display: flex;
        flex-direction: column;
        block-size: 100%;
        color: var(--body-foreground-color);
      }

      :host-context([data-theme-mode='dark']) {
        --tool-panel-bar-foreground: var(--gray-400);
      }

      .tool-panel__header {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.25rem 0.5rem;
        color: var(--tool-panel-bar-foreground);
      }

      .tool-panel__icon {
        font-size: 1rem;
      }

      .tool-panel__title {
        margin: 0;
        font-size: 0.75rem;
        font-weight: 500;
      }

      // The spacer, rather than a flexed title, pushes the actions to the trailing edge: it keeps the
      // title's own width so a long one wraps no differently from a short one, and leaves projected
      // actions sitting directly beside the close button.
      .tool-panel__spacer {
        flex: 1 1 auto;
      }

      .tool-panel__body {
        flex: 1;
        min-block-size: 0;
        padding: 0.75rem;
        overflow: auto;
      }

      // A flush body hosts content that manages its own padding and scrolling (such as the agent
      // chat), filling the panel edge to edge.
      .tool-panel__body--flush {
        padding: 0;
        overflow: hidden;
      }
    `,
  ],
})
export class ToolPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds the structured logger.
   */
  private readonly log: Log = inject(Log);

  /**
   * Gets the panel's title.
   */
  public readonly title: InputSignal<string> = input.required<string>();

  /**
   * Gets the icon shown beside the title, or undefined for a title-only header.
   */
  public readonly icon: InputSignal<Icon | undefined> = input<Icon | undefined>(undefined);

  /**
   * Gets the name the panel is dragged under, for the rare panel whose title names its content rather
   * than the panel itself (the binary view's Assembly panel drags as "Disassembly"). Defaults to
   * {@link title}.
   */
  public readonly dragTitle: InputSignal<string | undefined> = input<string | undefined>(undefined);

  /**
   * Gets a value indicating whether the header is shown. A host that supplies its own chrome (or docks
   * the panel somewhere already titled) hides it and keeps only the body.
   */
  public readonly header: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets a value indicating whether the header offers a close button.
   */
  public readonly closable: InputSignal<boolean> = input<boolean>(true);

  /**
   * Gets the close button's accessible name and tooltip, which names what is being closed.
   */
  public readonly closeLabel: InputSignal<string> = input<string>('Close panel');

  /**
   * Gets a value indicating whether the body is flush — without padding or its own scroll — so the
   * projected content (such as the agent chat) fills the panel and manages its own layout.
   */
  public readonly flush: InputSignal<boolean> = input<boolean>(false);

  /**
   * Emitted when the user activates the header's close button, so the host can hide the panel.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the name the panel's header drags under, falling back to its title.
   */
  protected readonly handle: Signal<string> = computed(
    (): string => this.dragTitle() ?? this.title(),
  );

  /**
   * Raises {@link closed} so the host dismisses the panel.
   */
  protected onClose(): void {
    this.log.debug('ToolPanel', `Closing panel '${this.title()}'`);
    this.closed.emit();
  }
}
