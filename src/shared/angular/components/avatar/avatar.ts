import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';

/**
 * The accent hues an avatar can wear, from the theme's accent palette. Ordered so that neighbouring
 * hashes land on hues far apart, which keeps two agents hired one after the other distinguishable.
 */
export const AVATAR_HUES: readonly string[] = [
  'blue',
  'orange',
  'emerald',
  'magenta',
  'cyan',
  'coral',
  'violet',
  'yellow',
  'teal',
  'pink',
  'indigo',
  'mint',
];

/**
 * Reads a name's monogram: the first letters of its first two words, upper-cased.
 * @param name The name.
 * @returns Returns the monogram, or `?` for a name with no letters.
 */
export function monogramOf(name: string): string {
  const words: readonly string[] = name
    .trim()
    .split(/\s+/)
    .filter((word: string): boolean => word.length > 0);
  const letters: string = words
    .slice(0, 2)
    .map((word: string): string => [...word][0] ?? '')
    .join('')
    .toUpperCase();
  return letters.length === 0 ? '?' : letters;
}

/**
 * Picks the hue a seed wears: a stable hash of the seed, onto {@link AVATAR_HUES}.
 * @param seed The seed — an identity that does not change when the name does.
 * @returns Returns the hue's name.
 */
export function hueOf(seed: string): string {
  let hash: number = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return AVATAR_HUES[hash % AVATAR_HUES.length];
}

/**
 * An avatar: a monogram on a disc, coloured from the theme's accent palette.
 *
 * Seeded by an identity rather than the name, so renaming someone keeps their colour — the colour is
 * how a person is recognised at a glance across a roster, a tree and a chat. Decorative to assistive
 * technology unless given a label: it usually sits beside the name it abbreviates.
 */
@Component({
  selector: 'app-avatar',
  template: '{{ monogram() }}',
  styleUrl: './avatar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-hue]': 'hue()',
    '[class.avatar--small]': "size() === 'small'",
    '[attr.role]': "ariaLabel() === undefined ? null : 'img'",
    '[attr.aria-label]': 'ariaLabel() ?? null',
    '[attr.aria-hidden]': "ariaLabel() === undefined ? 'true' : null",
  },
})
export class Avatar {
  /**
   * Gets the name the monogram is taken from.
   */
  public readonly name: InputSignal<string> = input.required<string>();

  /**
   * Gets the identity the colour is taken from.
   */
  public readonly seed: InputSignal<string> = input.required<string>();

  /**
   * Gets the avatar's size.
   */
  public readonly size: InputSignal<'small' | 'medium'> = input<'small' | 'medium'>('medium');

  /**
   * Gets the accessible name, or undefined when the avatar is decoration beside its name.
   */
  public readonly ariaLabel: InputSignal<string | undefined> = input<string>();

  /**
   * Gets the monogram.
   */
  protected readonly monogram: Signal<string> = computed((): string => monogramOf(this.name()));

  /**
   * Gets the hue.
   */
  protected readonly hue: Signal<string> = computed((): string => hueOf(this.seed()));
}
