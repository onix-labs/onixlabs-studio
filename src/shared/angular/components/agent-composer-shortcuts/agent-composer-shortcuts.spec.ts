import { describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  AgentComposerShortcuts,
  COMPOSER_SHORTCUT_GROUPS,
  localiseModifiers,
  ComposerShortcut,
  ComposerShortcutGroup,
} from './agent-composer-shortcuts';

/**
 * Mounts the shortcuts button.
 * @returns Returns the fixture.
 */
function mount(): ComponentFixture<AgentComposerShortcuts> {
  TestBed.configureTestingModule({ imports: [AgentComposerShortcuts] });
  const fixture: ComponentFixture<AgentComposerShortcuts> =
    TestBed.createComponent(AgentComposerShortcuts);
  fixture.detectChanges();
  return fixture;
}

/**
 * Gets every shortcut listed, whichever group it belongs to.
 * @returns Returns the shortcuts.
 */
function allShortcuts(): readonly ComposerShortcut[] {
  return COMPOSER_SHORTCUT_GROUPS.flatMap(
    (group: ComposerShortcutGroup): readonly ComposerShortcut[] => group.shortcuts,
  );
}

describe('localiseModifiers', () => {
  it('drawsAltAsOptionOnMacOS_andLeavesItAsAltElsewhere', () => {
    const groups: readonly ComposerShortcutGroup[] = [
      { title: 'T', shortcuts: [{ keys: ['Alt', '↑'], description: 'd' }] },
    ];
    expect(localiseModifiers(groups, true)[0].shortcuts[0].keys).toEqual(['⌥', '↑']);
    expect(localiseModifiers(groups, false)[0].shortcuts[0].keys).toEqual(['Alt', '↑']);
  });

  it('theHistoryChordIsAdvertisedOnAlt_notShift', () => {
    // Shift+arrows belongs to text selection; the menu must not promise it to recall.
    const recall: readonly ComposerShortcut[] = allShortcuts().filter(
      (shortcut: ComposerShortcut): boolean =>
        /previous message|next message/.test(shortcut.description),
    );
    expect(recall.map((shortcut: ComposerShortcut): readonly string[] => shortcut.keys)).toEqual([
      ['Alt', '↑'],
      ['Alt', '↓'],
    ]);
  });
});

describe('AgentComposerShortcuts', () => {
  it('render_beforeOpening_isAnIconButtonNamingItself', () => {
    const fixture: ComponentFixture<AgentComposerShortcuts> = mount();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    const trigger: HTMLButtonElement | null = host.querySelector('button');
    expect(trigger).not.toBeNull();
    expect(trigger?.getAttribute('aria-label')).toBe('Keyboard shortcuts');
    // Nothing is listed until it is asked for: the footer costs one glyph.
    expect(document.querySelectorAll('.agent-shortcuts__item').length).toBe(0);
  });

  it('open_whenTheButtonIsClicked_listsEveryShortcut', () => {
    const fixture: ComponentFixture<AgentComposerShortcuts> = mount();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    host.querySelector('button')?.click();
    TestBed.tick();

    // The panel renders through the CDK overlay, outside the fixture's own DOM.
    const rows: readonly Element[] = Array.from(
      document.querySelectorAll('.agent-shortcuts__item'),
    );
    expect(rows.length).toBe(allShortcuts().length);
    const text: string = rows.map((row: Element): string => row.textContent ?? '').join(' | ');
    expect(text).toContain('to send');
    expect(text).toContain('for the previous message');
    expect(text).toContain('for the command palette');
  });

  it('shortcuts_areKeyedChords_eachSayingWhatItDoes', () => {
    for (const shortcut of allShortcuts()) {
      expect(shortcut.keys.length).toBeGreaterThan(0);
      expect(shortcut.description.length).toBeGreaterThan(0);
    }
    // History recall is the chord the arrows were freed from, so it has to be advertised as one.
    expect(allShortcuts()).toContainEqual({
      keys: ['Alt', '↑'],
      description: 'for the previous message',
    });
    expect(allShortcuts()).toContainEqual({
      keys: ['Alt', '↓'],
      description: 'for the next message',
    });
  });
});
