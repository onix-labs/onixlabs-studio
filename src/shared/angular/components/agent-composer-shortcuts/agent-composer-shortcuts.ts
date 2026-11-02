import { CdkMenu, CdkMenuTrigger } from '@angular/cdk/menu';
import { ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, inject, Signal } from '@angular/core';
import { Button } from '@shared/angular/components/forms/button/button';
import { MENU_POSITIONS } from '@shared/angular/components/menu/menu-position';
import { Icon } from '@shared/angular/icons/icon';
import { Settings } from '@shared/angular/services/settings/settings';
import type { SendMessageWith } from '@shared/angular/services/settings/settings-registry';
import { Studio } from '@shared/angular/services/studio/studio';

/**
 * Describes one shortcut the composer answers to: the keys it is pressed with, and what pressing them
 * does. A chord is its keys in order, each drawn as its own cap.
 */
export interface ComposerShortcut {
  /**
   * Gets the keys of the chord, in the order they are pressed.
   */
  readonly keys: readonly string[];

  /**
   * Gets what the chord does, phrased to follow its keys ("to send").
   */
  readonly description: string;
}

/**
 * Describes a titled group of shortcuts, so the ones that only apply while the suggestion list is open
 * are not read as always available.
 */
export interface ComposerShortcutGroup {
  /**
   * Gets the heading shown above the group.
   */
  readonly title: string;

  /**
   * Gets the group's shortcuts, in display order.
   */
  readonly shortcuts: readonly ComposerShortcut[];
}

/**
 * Holds every shortcut the composer answers to.
 *
 * This is the written form of what
 * {@link import('../agent-composer/agent-composer').AgentComposer.onKeydown} implements — a key added
 * or moved there belongs here in the same change, since this menu is the only place the shortcuts are
 * advertised.
 */
/**
 * Renders the modifier keys the way the platform names them: the list is written with `Alt`, which
 * macOS calls Option and draws as ⌥ — the same convention the keybindings service uses.
 * @param groups The groups as written.
 * @param isMac Whether the platform is macOS.
 * @returns Returns the groups with their modifiers localised.
 */
export function localiseModifiers(
  groups: readonly ComposerShortcutGroup[],
  isMac: boolean,
): readonly ComposerShortcutGroup[] {
  if (!isMac) {
    return groups;
  }
  return groups.map((group: ComposerShortcutGroup): ComposerShortcutGroup => ({
    ...group,
    shortcuts: group.shortcuts.map((shortcut: ComposerShortcut): ComposerShortcut => ({
      ...shortcut,
      keys: shortcut.keys.map((key: string): string => (key === 'Alt' ? '⌥' : key)),
    })),
  }));
}

/**
 * Rewrites the composer's send and new-line rows for the Send Message With setting: the chosen key
 * sends, and each of the other two inserts a new line.
 * @param groups The groups as written.
 * @param send The key that sends.
 * @param isMac Whether the platform is macOS, where the command modifier is ⌘ rather than Ctrl.
 * @returns Returns the groups with the send key applied.
 */
export function withSendKey(
  groups: readonly ComposerShortcutGroup[],
  send: SendMessageWith,
  isMac: boolean,
): readonly ComposerShortcutGroup[] {
  const keys: Readonly<Record<SendMessageWith, readonly string[]>> = {
    enter: ['↵'],
    'mod-enter': [isMac ? '⌘' : 'Ctrl', '↵'],
    'shift-enter': ['⇧', '↵'],
  };
  const order: readonly SendMessageWith[] = ['enter', 'mod-enter', 'shift-enter'];
  const sendRows: readonly ComposerShortcut[] = [
    { keys: keys[send], description: 'to send' },
    ...order
      .filter((key: SendMessageWith): boolean => key !== send)
      .map((key: SendMessageWith): ComposerShortcut => ({
        keys: keys[key],
        description: 'for a new line',
      })),
  ];
  return groups.map((group: ComposerShortcutGroup, index: number): ComposerShortcutGroup =>
    index === 0
      ? {
          ...group,
          shortcuts: [
            ...sendRows,
            ...group.shortcuts.filter(
              (shortcut: ComposerShortcut): boolean =>
                shortcut.description !== 'to send' && shortcut.description !== 'for a new line',
            ),
          ],
        }
      : group,
  );
}

export const COMPOSER_SHORTCUT_GROUPS: readonly ComposerShortcutGroup[] = [
  {
    title: 'Composer',
    shortcuts: [
      // The send and new-line keys follow Send Message With; see withSendKey.
      { keys: ['↵'], description: 'to send' },
      { keys: ['⇧', '↵'], description: 'for a new line' },
      // Alt, not Shift: Shift+arrows extends the selection, which the composer must not take.
      { keys: ['Alt', '↑'], description: 'for the previous message' },
      { keys: ['Alt', '↓'], description: 'for the next message' },
      { keys: ['/'], description: 'for the command palette' },
      { keys: ['@'], description: 'to attach a file' },
      { keys: ['Esc'], description: 'to stop editing a message' },
    ],
  },
  {
    title: 'While suggestions are open',
    shortcuts: [
      { keys: ['↑', '↓'], description: 'to move through the list' },
      { keys: ['↵'], description: 'to accept the highlighted one' },
      { keys: ['⇥'], description: 'to accept the highlighted one' },
      { keys: ['Esc'], description: 'to close the list' },
    ],
  },
];

/**
 * The composer's keyboard-shortcut menu: an icon button in the composer footer opening a drop-up of
 * every key and chord the prompt box answers to.
 *
 * It replaces the two hints the footer used to print. Those named the two shortcuts that fit in the
 * space and left the rest — history recall, the `/` palette, the `@` mention — to be discovered by
 * accident, and still cost the footer a line of text at every window width. A button costs one glyph
 * and can hold the whole list.
 */
@Component({
  selector: 'app-agent-composer-shortcuts',
  imports: [Button, CdkMenu, CdkMenuTrigger],
  templateUrl: './agent-composer-shortcuts.html',
  styleUrl: './agent-composer-shortcuts.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentComposerShortcuts {
  /**
   * Gets the icon set, exposed for the template.
   */
  protected readonly Icon: typeof Icon = Icon;

  /**
   * Holds a value indicating whether the platform is macOS, which names its modifiers with symbols.
   */
  private readonly isMac: boolean = inject(Studio).platform === 'darwin';

  /**
   * Holds the settings store, for the key that sends.
   */
  private readonly settings: Settings = inject(Settings);

  /**
   * Gets the shortcut groups listed by the menu, with the send key the setting names.
   */
  protected readonly groups: Signal<readonly ComposerShortcutGroup[]> = computed(
    (): readonly ComposerShortcutGroup[] =>
      localiseModifiers(
        withSendKey(
          COMPOSER_SHORTCUT_GROUPS,
          this.settings.value('ai.sendMessageWith')(),
          this.isMac,
        ),
        this.isMac,
      ),
  );

  /**
   * Gets the position that opens the menu upward from the button, their leading edges aligned. The
   * composer sits at the foot of the panel, so a downward menu would open off the bottom of it.
   */
  protected readonly menuPosition: readonly ConnectedPosition[] = MENU_POSITIONS['up-start'];
}
