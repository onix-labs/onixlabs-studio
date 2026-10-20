import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Icon } from '@shared/angular/icons/icon';
import type {
  ReferenceItem,
  ReferenceList,
} from '@shared/angular/services/references/reference-list';
import { ReferencesView } from './references-view';

/**
 * A tab's own References panel outside a workspace (#1014): the shared {@link ReferencesView} — the
 * same view the workspace's References panel shows — in the tool-panel chrome the tab's Find panel
 * wears. Its header's close button, or Escape inside it, asks the tab to hide it.
 */
@Component({
  selector: 'app-editor-references-panel',
  imports: [ToolPanel, ReferencesView],
  templateUrl: './editor-references-panel.html',
  styleUrl: './editor-references-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'closed.emit()' },
})
export class EditorReferencesPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the list the panel shows.
   */
  public readonly list: InputSignal<ReferenceList | null> = input<ReferenceList | null>(null);

  /**
   * Emits the place the user chose, for the tab to go to.
   */
  public readonly chosen: OutputEmitterRef<ReferenceItem> = output<ReferenceItem>();

  /**
   * Emits when the user dismisses the panel, so the tab can hide it.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();
}
