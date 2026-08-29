import { TestBed } from '@angular/core/testing';

import { AppMenu } from './app-menu';
import { MENU_SEPARATOR, MenuContribution, MenuEntry } from './app-menu-model';

/**
 * Orders a contribution ahead of another, as the core's leading sections are ordered ahead of a
 * feature's.
 */
const CORE_PRIORITY: number = 0;

/**
 * Orders a contribution behind the core's, as a feature's sections are.
 */
const FEATURE_PRIORITY: number = 500;

describe('AppMenu', () => {
  let menu: AppMenu;

  /**
   * Reads a merged section's entries by id.
   * @param id The section id.
   * @returns Returns the section's entries.
   */
  function itemsOf(id: string): readonly MenuEntry[] {
    return (
      menu.sections().find((section: MenuContribution): boolean => section.id === id)?.items ?? []
    );
  }

  /**
   * Reads a merged section's entry labels by id, so a test can state the whole menu it expects.
   * @param id The section id.
   * @returns Returns the labels, with separators shown as a rule.
   */
  function labelsOf(id: string): readonly string[] {
    return itemsOf(id).map((entry: MenuEntry): string =>
      entry.kind === 'separator' ? '---' : (entry.label ?? ''),
    );
  }

  beforeEach(() => {
    TestBed.configureTestingModule({});
    menu = TestBed.inject(AppMenu);
  });

  it('sections_whenIdsMatch_foldsTheContributionIntoTheExistingSection', () => {
    menu.contribute(
      'core',
      [{ id: 'file', label: 'File', items: [{ id: 'core.open', label: 'Open' }] }],
      CORE_PRIORITY,
    );
    menu.contribute(
      'feature',
      [{ id: 'file', label: 'File', items: [{ id: 'feature.save', label: 'Save' }] }],
      FEATURE_PRIORITY,
    );

    expect(menu.sections().length).toBe(1);
    expect(labelsOf('file')).toEqual(['Open', 'Save']);
  });

  it('sections_whenAFeatureClaimsTheSameChord_replacesTheCoreEntry', () => {
    // The core carries Undo as the native role, which suits a plain text box; a code tab needs its own
    // model-level undo, and claiming the chord must take it rather than leave both entries live.
    menu.contribute(
      'core',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { id: 'core.edit.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
            { id: 'core.edit.paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
          ],
        },
      ],
      CORE_PRIORITY,
    );
    menu.contribute(
      'feature',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ id: 'code.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' }],
        },
      ],
      FEATURE_PRIORITY,
    );

    // Paste is untouched, so it still reaches whatever holds focus; Undo is the feature's alone.
    expect(labelsOf('edit')).toEqual(['Paste', 'Undo']);
    expect(itemsOf('edit')[1].id).toBe('code.undo');
  });

  it('sections_whenNoFeatureClaimsTheChord_keepsTheCoreRole', () => {
    menu.contribute(
      'core',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { id: 'core.edit.paste', label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
          ],
        },
      ],
      CORE_PRIORITY,
    );
    menu.contribute(
      'feature',
      [{ id: 'edit', label: 'Edit', items: [{ id: 'code.find', label: 'Find…' }] }],
      FEATURE_PRIORITY,
    );

    expect(itemsOf('edit')[0].role).toBe('paste');
  });

  it('sections_whenAChordIsClaimedInASubmenu_leavesTheTopLevelEntryAlone', () => {
    menu.contribute(
      'core',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ id: 'core.edit.paste', label: 'Paste', accelerator: 'CmdOrCtrl+V' }],
        },
      ],
      CORE_PRIORITY,
    );
    menu.contribute(
      'feature',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            {
              id: 'feature.more',
              label: 'More',
              items: [{ id: 'feature.buried', label: 'Buried', accelerator: 'CmdOrCtrl+V' }],
            },
          ],
        },
      ],
      FEATURE_PRIORITY,
    );

    expect(labelsOf('edit')).toEqual(['Paste', 'More']);
  });

  it('sections_whenASectionEndsWithASeparator_trimsIt', () => {
    // The core ends a section with a separator to leave room for a feature; nothing follows here.
    menu.contribute(
      'core',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [{ id: 'core.edit.cut', label: 'Cut' }, MENU_SEPARATOR],
        },
      ],
      CORE_PRIORITY,
    );

    expect(labelsOf('edit')).toEqual(['Cut']);
  });

  it('sections_whenContributionsMeetAtSeparators_collapsesTheRun', () => {
    menu.contribute(
      'core',
      [{ id: 'file', label: 'File', items: [{ id: 'core.open', label: 'Open' }, MENU_SEPARATOR] }],
      CORE_PRIORITY,
    );
    menu.contribute(
      'feature',
      [
        {
          id: 'file',
          label: 'File',
          items: [MENU_SEPARATOR, { id: 'feature.save', label: 'Save' }],
        },
      ],
      FEATURE_PRIORITY,
    );

    expect(labelsOf('file')).toEqual(['Open', '---', 'Save']);
  });

  it('sections_whenAClaimStrandsASeparator_dropsIt', () => {
    // Removing the entries a separator divided must not leave the rule behind.
    menu.contribute(
      'core',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { id: 'core.edit.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
            MENU_SEPARATOR,
            { id: 'core.edit.cut', label: 'Cut', accelerator: 'CmdOrCtrl+X' },
          ],
        },
      ],
      CORE_PRIORITY,
    );
    menu.contribute(
      'feature',
      [
        {
          id: 'edit',
          label: 'Edit',
          items: [
            { id: 'f.undo', label: 'Undo', accelerator: 'CmdOrCtrl+Z' },
            { id: 'f.cut', label: 'Cut', accelerator: 'CmdOrCtrl+X' },
          ],
        },
      ],
      FEATURE_PRIORITY,
    );

    expect(labelsOf('edit')).toEqual(['Undo', 'Cut']);
  });

  it('dispatch_whenTheCommandHasAHandler_runsIt', () => {
    let ran: number = 0;
    menu.contribute(
      'core',
      [
        {
          id: 'file',
          label: 'File',
          items: [{ id: 'core.open', label: 'Open', run: (): void => void (ran += 1) }],
        },
      ],
      CORE_PRIORITY,
    );
    TestBed.tick();

    menu.dispatch('core.open');

    expect(ran).toBe(1);
  });

  it('clearOwner_whenTheOwnerLeaves_dropsItsSections', () => {
    menu.contribute(
      'feature',
      [{ id: 'code', label: 'Code', items: [{ id: 'code.run', label: 'Run' }] }],
      FEATURE_PRIORITY,
    );
    expect(menu.sections().length).toBe(1);

    menu.clearOwner('feature');

    expect(menu.sections().length).toBe(0);
  });
});
