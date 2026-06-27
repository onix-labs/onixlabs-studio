import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';

/**
 * A run of a label, flagged whether it matches the active query.
 */
interface TextSegment {
  /**
   * Gets the run's text.
   */
  readonly text: string;

  /**
   * Gets whether the run matches the query (and is therefore highlighted).
   */
  readonly match: boolean;
}

/**
 * Renders a label with the runs matching a query highlighted, used by the explorer trees so a filtered
 * row shows where it matched. The match is a case-insensitive substring; when the query is empty the
 * whole text renders unhighlighted.
 */
@Component({
  selector: 'app-highlighted-text',
  imports: [],
  templateUrl: './highlighted-text.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HighlightedText {
  /**
   * Gets the label to render.
   */
  public readonly text: InputSignal<string> = input<string>('');

  /**
   * Gets the query whose matches are highlighted.
   */
  public readonly query: InputSignal<string> = input<string>('');

  /**
   * Gets the label split into runs around the query, so the matched runs can be highlighted.
   */
  protected readonly segments: Signal<readonly TextSegment[]> = computed(
    (): readonly TextSegment[] => {
      const text: string = this.text();
      const query: string = this.query().trim();
      if (query.length === 0) {
        return [{ text, match: false }];
      }
      const needle: string = query.toLowerCase();
      const haystack: string = text.toLowerCase();
      const runs: TextSegment[] = [];
      let index: number = 0;
      for (
        let at: number = haystack.indexOf(needle);
        at !== -1;
        at = haystack.indexOf(needle, index)
      ) {
        if (at > index) {
          runs.push({ text: text.slice(index, at), match: false });
        }
        runs.push({ text: text.slice(at, at + needle.length), match: true });
        index = at + needle.length;
      }
      if (index < text.length) {
        runs.push({ text: text.slice(index), match: false });
      }
      return runs;
    },
  );
}
