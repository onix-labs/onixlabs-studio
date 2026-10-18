import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  Signal,
} from '@angular/core';
import { ToolPanel } from '@shared/angular/components/panels/tool-panel/tool-panel';
import { Icon } from '@shared/angular/icons/icon';
import { EditorSearch } from './editor-search';
import { SearchView } from './search-view';

/**
 * A tab's own Find & Replace outside a workspace (#1007): the shared {@link SearchView} — the same
 * view the workspace's Search panel shows — in the tool-panel chrome every docked panel of the editor
 * views wears, over the {@link EditorSearch} the tab keeps. Its header's close button, or Escape inside
 * it, asks the tab to hide it.
 */
@Component({
  selector: 'app-editor-search-panel',
  imports: [ToolPanel, SearchView],
  templateUrl: './editor-search-panel.html',
  styleUrl: './editor-search-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'closed.emit()' },
})
export class EditorSearchPanel {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Gets the tab's find state the panel shows.
   */
  public readonly search: InputSignal<EditorSearch> = input.required<EditorSearch>();

  /**
   * Emits when the user dismisses the panel, so the tab can hide it.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Gets the panel's title, reflecting whether the editor searched can be replaced in.
   */
  protected readonly title: Signal<string> = computed((): string =>
    this.search().replaceable() ? 'Find and Replace' : 'Find',
  );
}
