import type { MenuItem } from '@shared/angular/components/menu/menu';
import {
  buildQuickFixMenu,
  NO_QUICK_FIXES_LABEL,
  NO_QUICK_FIXES_ROW,
  QuickFixAction,
  quickFixIndexOf,
} from './quick-fix-menu';

/**
 * Builds an action.
 * @param title The title.
 * @param extra What else it is.
 * @returns Returns the action.
 */
function action(title: string, extra: Partial<QuickFixAction> = {}): QuickFixAction {
  return {
    title,
    kind: 'quickfix',
    isPreferred: false,
    disabledReason: null,
    edit: null,
    command: null,
    origin: 'server',
    resolve: null,
    ...extra,
  };
}

/**
 * Lists the rows by label, separators as `|`.
 * @param rows The rows.
 * @returns Returns the labels.
 */
function labelsOf(rows: readonly MenuItem[]): string[] {
  return rows.map((row: MenuItem): string => (row.separator === true ? '|' : row.label));
}

describe('buildQuickFixMenu (#1016)', () => {
  it('listsFixesFirst_preferredAtTheTop_thenRefactorsAndSourceActions_eachBelowADivider', () => {
    const rows: readonly MenuItem[] = buildQuickFixMenu([
      action('Organize imports', { kind: 'source.organizeImports' }),
      action('Extract method', { kind: 'refactor.extract' }),
      action('Add missing import'),
      action('Use the suggested name', { isPreferred: true }),
      action('Run the server command', { kind: '' }),
      action('Inline variable', { kind: 'refactor.inline' }),
      action('Something else', { kind: 'notebook' }),
    ]);

    expect(labelsOf(rows)).toEqual([
      'Use the suggested name',
      'Add missing import',
      'Run the server command',
      '|',
      'Extract method',
      'Inline variable',
      '|',
      'Organize imports',
      '|',
      'Something else',
    ]);
    // Each row stands for its action by its index in the list given.
    expect(rows.map((row: MenuItem): number | null => quickFixIndexOf(row.id))).toEqual([
      3,
      2,
      4,
      null,
      1,
      5,
      null,
      0,
      null,
      6,
    ]);
  });

  it('anActionThatCannotRun_isNotListed', () => {
    const rows: readonly MenuItem[] = buildQuickFixMenu([
      action('Extract constant', { kind: 'refactor', disabledReason: 'Select an expression.' }),
      action('Add import', { kind: 'quickfix' }),
      action('Extract to interface', {
        kind: 'refactor.extract',
        disabledReason: 'Selection is not a valid type node',
      }),
      action('Extract method', { kind: 'refactor' }),
    ]);

    expect(rows).toEqual([
      { id: 'quick-fix-1', label: 'Add import' },
      { id: 'quick-fix-separator-refactor', label: '', separator: true },
      { id: 'quick-fix-3', label: 'Extract method' },
    ]);
  });

  it('onlyActionsThatCannotRun_saysSoInOneGreyedRow', () => {
    expect(
      buildQuickFixMenu([
        action('Extract constant', { kind: 'refactor', disabledReason: 'Select an expression.' }),
        action('Move to file', { kind: 'refactor.move', disabledReason: 'Nothing to move.' }),
      ]),
    ).toEqual([{ id: NO_QUICK_FIXES_ROW, label: NO_QUICK_FIXES_LABEL, disabled: true }]);
  });

  it('nothingToOffer_saysSoInOneGreyedRow', () => {
    expect(buildQuickFixMenu([])).toEqual([
      { id: NO_QUICK_FIXES_ROW, label: NO_QUICK_FIXES_LABEL, disabled: true },
    ]);
    expect(NO_QUICK_FIXES_LABEL).toBe('No fixes available here');
    expect(quickFixIndexOf(NO_QUICK_FIXES_ROW)).toBeNull();
    expect(quickFixIndexOf('rename')).toBeNull();
  });
});
