import { CdkContextMenuTrigger } from '@angular/cdk/menu';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  Signal,
  viewChild,
} from '@angular/core';
import { Menu, MenuChoice, MenuItem } from '@shared/angular/components/menu/menu';
import {
  EditorContextMenu,
  EditorContextMenuOpener,
  EditorContextMenuSubject,
} from '@shared/angular/services/editor-context-menu/editor-context-menu';

/**
 * The shape of the context the menu panel is opened with: the right-click's subject rides as
 * `$implicit`, which is what the panel template's `let-data` reads.
 */
interface EditorContextMenuContext {
  $implicit: EditorContextMenuSubject | undefined;
}

/**
 * Draws Studio's editor right-click menu (#1012) beside the editor it serves: the shared `app-menu`,
 * opened at the pointer by a CDK context-menu trigger. The shared text and diff editors place one in
 * their view and hand it to the {@link EditorContextMenu} service as the opener for their editors.
 *
 * Being in the editor's view is the point: the trigger builds its overlay from its own injector, so
 * the menu is drawn in the editor's window — a popped-out dock or a modal is a window of its own —
 * exactly as a tree's row menu is. Other menus Studio opens at an editor's caret — the quick-fix menu
 * (#1016) — open through it for the same reason, carrying a `run` of their own for their rows.
 */
@Component({
  selector: 'app-editor-context-menu',
  imports: [Menu, CdkContextMenuTrigger],
  templateUrl: './editor-context-menu-host.html',
  styleUrl: './editor-context-menu-host.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EditorContextMenuHost implements EditorContextMenuOpener {
  /**
   * Holds the service that runs the chosen command.
   */
  private readonly contextMenu: EditorContextMenu = inject(EditorContextMenu);

  /**
   * Holds the change detector, told when the menu opens from outside Angular's own event handling.
   */
  private readonly changeDetector: ChangeDetectorRef = inject(ChangeDetectorRef);

  /**
   * Holds the trigger that opens the menu.
   */
  private readonly trigger: Signal<CdkContextMenuTrigger> =
    viewChild.required<CdkContextMenuTrigger>(CdkContextMenuTrigger);

  /**
   * Holds the one context object the trigger is given. CDK builds the panel's portal on the first
   * open and reuses it, context and all, so each right-click's subject is moved into this object
   * rather than handed over as a new one (see `MenuSubject`).
   */
  private readonly context: EditorContextMenuContext = { $implicit: undefined };

  /**
   * Resolves the rows for the subject the menu was opened with.
   * @param data The trigger's data: the right-click's subject.
   * @returns Returns the rows.
   */
  protected readonly rowsFor: (data: unknown) => readonly MenuItem[] = (
    data: unknown,
  ): readonly MenuItem[] => (data as EditorContextMenuSubject | undefined)?.items ?? [];

  /**
   * Opens the menu at the pointer for a right-click in an editor.
   * @param event The right-click, which places the menu; the trigger consumes it, so neither the
   * browser nor anything around the editor acts on it too.
   * @param subject The editor and the rows to show.
   */
  public open(event: MouseEvent, subject: EditorContextMenuSubject): void {
    this.context.$implicit = subject;
    const trigger: CdkContextMenuTrigger = this.trigger();
    trigger.menuData = this.context;
    trigger._openOnContextMenu(event);
    this.changeDetector.markForCheck();
  }

  /**
   * Runs the chosen row's command once the menu has closed, so the command — which focuses the editor,
   * or opens a Go to box of its own — is not undone by the menu tearing itself down.
   * @param choice The chosen row and the subject the menu was opened with.
   */
  protected onChosen(choice: MenuChoice): void {
    const subject: EditorContextMenuSubject | undefined = choice.data as
      EditorContextMenuSubject | undefined;
    if (subject === undefined) {
      return;
    }
    queueMicrotask((): void =>
      subject.run === undefined
        ? this.contextMenu.run(choice.id, subject.editor)
        : subject.run(choice.id),
    );
  }

  /**
   * Gives the editor focus back when the menu closes without anything else taking it — dismissed with
   * Escape, say — so the caret is where it was and typing carries on.
   */
  protected onClosed(): void {
    const editor: EditorContextMenuSubject['editor'] | undefined = this.context.$implicit?.editor;
    if (editor === undefined) {
      return;
    }
    // Looked at once the panel is gone: CDK reports the close before it detaches the panel, while the
    // row that had focus is still in the document.
    queueMicrotask((): void => {
      const owner: Document = editor.getContainerDomNode().ownerDocument;
      const active: Element | null = owner.activeElement;
      if (active === null || active === owner.body) {
        editor.focus();
      }
    });
  }
}
