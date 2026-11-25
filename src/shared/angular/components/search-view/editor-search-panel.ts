import {
  ChangeDetectionStrategy,
  Component,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
} from '@angular/core';
import { EditorSearch } from './editor-search';
import { SearchView } from './search-view';

/**
 * A tab's own Find & Replace outside a workspace (#1007): the shared {@link SearchView} — the same
 * view the workspace's Search panel shows — over the
 * {@link EditorSearch} the tab keeps. Escape inside it asks the tab to hide it.
 */
@Component({
  selector: 'app-editor-search-panel',
  imports: [SearchView],
  templateUrl: './editor-search-panel.html',
  styleUrl: './editor-search-panel.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.escape)': 'closed.emit()' },
})
export class EditorSearchPanel {
  /**
   * Gets the tab's find state the panel shows.
   */
  public readonly search: InputSignal<EditorSearch> = input.required<EditorSearch>();

  /**
   * Gets whether the find field takes the keyboard when the panel is drawn.
   */
  public readonly focuses: InputSignal<boolean> = input<boolean>(true);

  /**
   * Emits when the user dismisses the panel, so the tab can hide it.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();
}
