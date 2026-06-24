import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { nameToEmoji } from 'gemoji';
import { Modal } from '../../../../../shared/modal/modal';

/**
 * Pairs an emoji's shortcode name with its Unicode character.
 */
interface EmojiEntry {
  /**
   * Gets the emoji's shortcode name (for example `smile`).
   */
  readonly name: string;

  /**
   * Gets the emoji's Unicode character.
   */
  readonly emoji: string;
}

/**
 * Holds the full emoji list, derived once from the shortcode map that the markdown editor's emoji
 * plugin already bundles, so the picker adds no further weight to the bundle.
 */
const EMOJI_ENTRIES: readonly EmojiEntry[] = Object.entries(nameToEmoji).map(
  ([name, emoji]: [string, string]): EmojiEntry => ({ name, emoji }),
);

/**
 * Caps the number of emoji shown at once so the grid stays responsive; search narrows the full set.
 */
const MAX_RESULTS: number = 240;

/**
 * A searchable emoji picker. Emoji are matched by their shortcode name; selecting one emits its
 * Unicode character to insert. Hosted by the markdown ribbon's Insert group.
 */
@Component({
  selector: 'app-markdown-emoji-modal',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  styles: [
    `
      .emoji-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(2.2rem, 1fr));
        gap: 0.15rem;
        max-block-size: 16rem;
        margin-block-start: 0.6rem;
        overflow-y: auto;
      }

      .emoji-cell {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 1;
        font-size: 1.3rem;
        line-height: 1;
        background: transparent;
        border: 0.0625rem solid transparent;
        border-radius: 0.375rem;
        corner-shape: squircle;
        cursor: pointer;
        transition: var(--hover-transition);

        &:hover,
        &:focus-visible {
          background: var(--accent-surface-background-color);
          border-color: var(--accent-surface-border-color);
          outline: none;
        }
      }

      .emoji-empty {
        margin: 1rem 0;
        font-size: 0.9rem;
        text-align: center;
        color: var(--welcome-muted-foreground-color);
      }
    `,
  ],
  template: `
    <app-modal [open]="open()" [width]="32" ariaLabel="Insert emoji" (dismiss)="cancel()">
      <h2 class="insert-modal__title">Insert emoji</h2>

      <div class="insert-modal__field">
        <label class="insert-modal__label" for="emoji-search">Search</label>
        <input
          #searchInput
          id="emoji-search"
          class="insert-modal__input"
          type="text"
          placeholder="smile, heart, rocket…"
          [value]="query()"
          (input)="query.set(searchInput.value)"
        />
      </div>

      @if (results().length > 0) {
        <div class="emoji-grid">
          @for (item of results(); track item.name) {
            <button
              type="button"
              class="emoji-cell"
              [attr.title]="item.name"
              [attr.aria-label]="item.name"
              (click)="pick(item.emoji)"
            >
              {{ item.emoji }}
            </button>
          }
        </div>
      } @else {
        <p class="emoji-empty">No emoji match “{{ query() }}”.</p>
      }
    </app-modal>
  `,
})
export class MarkdownEmojiModal {
  /**
   * Gets a value indicating whether the modal is open.
   */
  public readonly open: InputSignal<boolean> = input.required<boolean>();

  /**
   * Emitted when the modal is dismissed without inserting.
   */
  public readonly closed: OutputEmitterRef<void> = output<void>();

  /**
   * Emitted with the chosen emoji's Unicode character when the user picks one.
   */
  public readonly submitted: OutputEmitterRef<string> = output<string>();

  /**
   * Holds the search-query field value.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Gets the emoji whose shortcode name matches the current query, capped to {@link MAX_RESULTS}. An
   * empty query shows the first page of the full set.
   */
  protected readonly results: Signal<readonly EmojiEntry[]> = computed((): readonly EmojiEntry[] => {
    const term: string = this.query().trim().toLowerCase();
    if (term.length === 0) {
      return EMOJI_ENTRIES.slice(0, MAX_RESULTS);
    }
    const matches: EmojiEntry[] = [];
    for (const item of EMOJI_ENTRIES) {
      if (item.name.includes(term)) {
        matches.push(item);
        if (matches.length >= MAX_RESULTS) {
          break;
        }
      }
    }
    return matches;
  });

  /**
   * Picks an emoji, emitting it and resetting the search.
   * @param emoji The chosen emoji's Unicode character.
   */
  protected pick(emoji: string): void {
    this.submitted.emit(emoji);
    this.reset();
    this.closed.emit();
  }

  /**
   * Cancels the dialog, resetting the search.
   */
  protected cancel(): void {
    this.reset();
    this.closed.emit();
  }

  /**
   * Clears the search so the next open starts fresh.
   */
  private reset(): void {
    this.query.set('');
  }
}
