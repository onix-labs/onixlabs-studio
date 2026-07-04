import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  InputSignal,
  output,
  OutputEmitterRef,
  signal,
  Signal,
  WritableSignal,
} from '@angular/core';
import { gemoji } from 'gemoji';
import { SettingsStore } from '@shared/angular/services/settings-store/settings-store';
import { Modal } from '@shared/angular/components/modal/modal';

/**
 * Pairs an emoji's Unicode character with its primary shortcode name.
 */
interface EmojiEntry {
  /**
   * Gets the emoji's Unicode character.
   */
  readonly emoji: string;

  /**
   * Gets the emoji's primary shortcode name (for example `smile`).
   */
  readonly name: string;
}

/**
 * Groups emoji under a display category.
 */
interface EmojiCategory {
  /**
   * Gets the category's display name.
   */
  readonly name: string;

  /**
   * Gets the emoji in the category.
   */
  readonly emojis: readonly EmojiEntry[];
}

/**
 * An emoji entry paired with the lower-cased text it is matched against during search.
 */
interface SearchableEmoji extends EmojiEntry {
  /**
   * Gets the lower-cased names, tags, and description searched against.
   */
  readonly search: string;
}

/**
 * Maps each `gemoji` category to the display category shown in the picker. The two Unicode "Smileys
 * & Emotion" and "People & Body" groups are merged into a single "Smileys & People" section.
 */
const CATEGORY_MAP: Readonly<Record<string, string>> = {
  'Smileys & Emotion': 'Smileys & People',
  'People & Body': 'Smileys & People',
  'Animals & Nature': 'Animals & Nature',
  'Food & Drink': 'Food & Drink',
  Activities: 'Activity',
  'Travel & Places': 'Travel & Places',
  Objects: 'Objects',
  Symbols: 'Symbols',
  Flags: 'Flags',
};

/**
 * The display categories, in the order they appear in the picker.
 */
const CATEGORY_ORDER: readonly string[] = [
  'Smileys & People',
  'Animals & Nature',
  'Food & Drink',
  'Activity',
  'Travel & Places',
  'Objects',
  'Symbols',
  'Flags',
];

/**
 * The display name of the recent-emoji section, also used as its scroll-tab.
 */
const RECENT_CATEGORY: string = 'Recent';

/**
 * Associates a section with the glyph shown on its scroll-tab.
 */
interface EmojiTab {
  /**
   * Gets the section's category name (its scroll target).
   */
  readonly category: string;

  /**
   * Gets the representative glyph shown on the tab.
   */
  readonly glyph: string;
}

/**
 * The scroll-tabs shown above the grid, one per section. The Recent tab is shown only when there are
 * recent emoji.
 */
const TABS: readonly EmojiTab[] = [
  { category: RECENT_CATEGORY, glyph: '🕐' },
  { category: 'Smileys & People', glyph: '😀' },
  { category: 'Animals & Nature', glyph: '🐻' },
  { category: 'Food & Drink', glyph: '🍔' },
  { category: 'Activity', glyph: '⚽' },
  { category: 'Travel & Places', glyph: '✈️' },
  { category: 'Objects', glyph: '💡' },
  { category: 'Symbols', glyph: '🔣' },
  { category: 'Flags', glyph: '🚩' },
];

/**
 * The emoji grouped into ordered display categories, built once from the dataset.
 */
const CATEGORIES: readonly EmojiCategory[] = buildCategories();

/**
 * Every emoji with its searchable text, built once for the search path.
 */
const SEARCHABLE: readonly SearchableEmoji[] = gemoji.map(
  (entry): SearchableEmoji => ({
    emoji: entry.emoji,
    name: entry.names[0],
    search: `${entry.names.join(' ')} ${entry.tags.join(' ')} ${entry.description}`.toLowerCase(),
  }),
);

/**
 * Looks up an emoji's primary name from its character, used to label recent emoji.
 */
const NAME_BY_EMOJI: ReadonlyMap<string, string> = new Map<string, string>(
  gemoji.map((entry): [string, string] => [entry.emoji, entry.names[0]]),
);

/**
 * Groups the dataset into the ordered display categories.
 * @returns Returns the ordered categories.
 */
function buildCategories(): readonly EmojiCategory[] {
  const groups: Map<string, EmojiEntry[]> = new Map<string, EmojiEntry[]>(
    CATEGORY_ORDER.map((name: string): [string, EmojiEntry[]] => [name, []]),
  );
  for (const entry of gemoji) {
    const category: string | undefined = CATEGORY_MAP[entry.category];
    if (category !== undefined) {
      groups.get(category)?.push({ emoji: entry.emoji, name: entry.names[0] });
    }
  }
  return CATEGORY_ORDER.map(
    (name: string): EmojiCategory => ({ name, emojis: groups.get(name) ?? [] }),
  );
}

/**
 * Caps the number of search results shown so the grid stays responsive.
 */
const MAX_RESULTS: number = 240;

/**
 * Caps the number of remembered recent emoji.
 */
const MAX_RECENT: number = 24;

/**
 * The settings-store key under which recent emoji are persisted.
 */
const RECENT_KEY: string = 'markdown.recent-emoji';

/**
 * A categorised, searchable emoji picker. Emoji are grouped under Recent and the standard Unicode
 * categories; searching matches their shortcode names, tags, and descriptions. Selecting an emoji
 * emits its Unicode character to insert and records it as recent. Hosted by the markdown ribbon's
 * Insert group.
 */
@Component({
  selector: 'app-markdown-emoji-modal',
  imports: [Modal],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './insert-modal.scss',
  styles: [
    `
      .emoji-tabs {
        display: flex;
        gap: 0.1rem;
        margin-block-start: 0.6rem;
        border-block-end: 0.0625rem solid var(--dock-border-color);
      }

      .emoji-tab {
        flex: 1;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: 0.2rem 0;
        font-size: 1.1rem;
        line-height: 1;
        background: transparent;
        border: none;
        border-block-end: 0.125rem solid transparent;
        cursor: pointer;
        opacity: 0.65;
        transition: var(--hover-transition);

        &:hover {
          opacity: 1;
        }

        &:focus-visible {
          outline: var(--focus-ring-width) solid var(--focus-ring-color);
          outline-offset: -0.125rem;
        }
      }

      .emoji-tab--active {
        opacity: 1;
        border-block-end-color: var(--accent-color);
      }

      .emoji-scroll {
        position: relative;
        max-block-size: 18rem;
        margin-block-start: 0.4rem;
        overflow-y: auto;
      }

      .emoji-category-title {
        position: sticky;
        inset-block-start: 0;
        z-index: 1;
        margin: 0;
        padding: 0.35rem 0.1rem 0.2rem;
        font-size: 0.7rem;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--welcome-muted-foreground-color);
        background: var(--body-background-color);
      }

      .emoji-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(3rem, 1fr));
        gap: 0.15rem;
      }

      .emoji-cell {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 1;
        font-size: 2rem;
        line-height: 1;
        background: transparent;
        border: 0.0625rem solid transparent;
        border-radius: calc(0.375rem * var(--border-radius-multiplier));
        corner-shape: var(--app-corner-shape, squircle);
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
    <app-modal [open]="open()" [width]="32" ariaLabel="Insert Emoji" (dismiss)="cancel()">
      <h2 class="insert-modal__title">Insert Emoji</h2>

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

      @if (query().length === 0) {
        <div class="emoji-tabs" role="tablist">
          @for (tab of visibleTabs(); track tab.category) {
            <button
              type="button"
              class="emoji-tab"
              [class.emoji-tab--active]="effectiveActive() === tab.category"
              [attr.title]="tab.category"
              [attr.aria-label]="tab.category"
              (click)="scrollTo(tab.category)"
            >
              {{ tab.glyph }}
            </button>
          }
        </div>
      }

      <div class="emoji-scroll" (scroll)="onScroll()">
        @if (query().length > 0) {
          @if (searchResults().length > 0) {
            <div class="emoji-grid">
              @for (item of searchResults(); track item.emoji) {
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
        } @else {
          @if (recentEntries().length > 0) {
            <section data-category="Recent">
              <h3 class="emoji-category-title">Recent</h3>
              <div class="emoji-grid">
                @for (item of recentEntries(); track item.emoji) {
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
            </section>
          }

          @for (category of categories; track category.name) {
            <section [attr.data-category]="category.name">
              <h3 class="emoji-category-title">{{ category.name }}</h3>
              <div class="emoji-grid">
                @for (item of category.emojis; track item.emoji) {
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
            </section>
          }
        }
      </div>
    </app-modal>
  `,
})
export class MarkdownEmojiModal {
  /**
   * Holds the persisted store backing the recent-emoji list.
   */
  private readonly store: SettingsStore = inject(SettingsStore);

  /**
   * Holds this component's host element, used to find the scroll container and its sections.
   */
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef) as ElementRef<HTMLElement>;

  /**
   * Holds the category whose section is currently at the top of the scroll area, driving the active
   * tab. Empty until the user scrolls, in which case the first tab is treated as active.
   */
  protected readonly activeCategory: WritableSignal<string> = signal<string>('');

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
   * Gets the ordered emoji categories shown when not searching.
   */
  protected readonly categories: readonly EmojiCategory[] = CATEGORIES;

  /**
   * Holds the search-query field value.
   */
  protected readonly query: WritableSignal<string> = signal<string>('');

  /**
   * Holds the recent emoji characters, most recent first, persisted across sessions.
   */
  private readonly recent: WritableSignal<readonly string[]> = signal<readonly string[]>(
    this.store.get<readonly string[]>(RECENT_KEY, []),
  );

  /**
   * Gets the recent emoji as displayable entries.
   */
  protected readonly recentEntries: Signal<readonly EmojiEntry[]> = computed(
    (): readonly EmojiEntry[] =>
      this.recent().map(
        (emoji: string): EmojiEntry => ({
          emoji,
          name: NAME_BY_EMOJI.get(emoji) ?? emoji,
        }),
      ),
  );

  /**
   * Gets the scroll-tabs to show, dropping the Recent tab when there are no recent emoji.
   */
  protected readonly visibleTabs: Signal<readonly EmojiTab[]> = computed((): readonly EmojiTab[] =>
    TABS.filter(
      (tab: EmojiTab): boolean =>
        tab.category !== RECENT_CATEGORY || this.recentEntries().length > 0,
    ),
  );

  /**
   * Gets the category to highlight as active: the scrolled-to one, or the first tab before any scroll.
   */
  protected readonly effectiveActive: Signal<string> = computed(
    (): string => this.activeCategory() || this.visibleTabs()[0]?.category || '',
  );

  /**
   * Gets the emoji matching the current query, capped to {@link MAX_RESULTS}.
   */
  protected readonly searchResults: Signal<readonly EmojiEntry[]> = computed(
    (): readonly EmojiEntry[] => {
      const term: string = this.query().trim().toLowerCase();
      if (term.length === 0) {
        return [];
      }
      const matches: EmojiEntry[] = [];
      for (const item of SEARCHABLE) {
        if (item.search.includes(term)) {
          matches.push(item);
          if (matches.length >= MAX_RESULTS) {
            break;
          }
        }
      }
      return matches;
    },
  );

  /**
   * Picks an emoji: records it as recent, emits it, and resets the search.
   * @param emoji The chosen emoji's Unicode character.
   */
  protected pick(emoji: string): void {
    const next: readonly string[] = [
      emoji,
      ...this.recent().filter((existing: string): boolean => existing !== emoji),
    ].slice(0, MAX_RECENT);
    this.recent.set(next);
    this.store.set(RECENT_KEY, next);
    this.submitted.emit(emoji);
    this.reset();
    this.closed.emit();
  }

  /**
   * Scrolls the picker to the given category's section and marks its tab active.
   * @param category The category to scroll to.
   */
  protected scrollTo(category: string): void {
    const root: HTMLElement = this.host.nativeElement;
    const container: HTMLElement | null = root.querySelector<HTMLElement>('.emoji-scroll');
    const section: HTMLElement | null = root.querySelector<HTMLElement>(
      `[data-category="${category}"]`,
    );
    if (container !== null && section !== null) {
      container.scrollTop = section.offsetTop;
    }
    this.activeCategory.set(category);
  }

  /**
   * Tracks which section is at the top of the scroll area as the user scrolls, so the matching tab is
   * highlighted.
   */
  protected onScroll(): void {
    const container: HTMLElement | null =
      this.host.nativeElement.querySelector<HTMLElement>('.emoji-scroll');
    if (container === null) {
      return;
    }
    const sections: HTMLElement[] = Array.from(
      container.querySelectorAll<HTMLElement>('[data-category]'),
    );
    let current: string = '';
    for (const section of sections) {
      if (section.offsetTop <= container.scrollTop + 4) {
        current = section.dataset['category'] ?? '';
      } else {
        break;
      }
    }
    this.activeCategory.set(current);
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
