import type { MenuItem } from '@shared/angular/components/menu/menu';
import {
  buildQuickFixMenu,
  NO_QUICK_FIXES_LABEL,
  NO_QUICK_FIXES_ROW,
  QuickFixAction,
  quickFixChoiceOf,
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

/**
 * Lists rows as a tree of labels: a row with a submenu as `label ▸ [children]`.
 * @param rows The rows.
 * @returns Returns the labels.
 */
function treeOf(rows: readonly MenuItem[]): unknown[] {
  return rows.map((row: MenuItem): unknown =>
    row.separator === true
      ? '|'
      : row.children === undefined
        ? row.label
        : { [row.label]: treeOf(row.children) },
  );
}

/**
 * Finds a row's identifier by its labels, outermost first.
 * @param rows The rows.
 * @param labels The labels down to it.
 * @returns Returns its identifier.
 */
function idAt(rows: readonly MenuItem[], ...labels: string[]): string | undefined {
  let level: readonly MenuItem[] = rows;
  let found: MenuItem | undefined;
  for (const label of labels) {
    found = level.find((row: MenuItem): boolean => row.label === label);
    level = found?.children ?? [];
  }
  return found?.id;
}

describe('buildQuickFixMenu fix-all and nested actions (#1151)', () => {
  const SCOPES: readonly string[] = [
    'Document',
    'Project',
    'Solution',
    'ContainingMember',
    'ContainingType',
  ];

  it('foldsAFixAllIntoItsFix_asFixHereThenEveryScopeNarrowestFirst', () => {
    const rows: readonly MenuItem[] = buildQuickFixMenu([
      action('Remove unused variable', { path: ['Remove unused variable'] }),
      action('Fix All: Remove unused variable', {
        path: ['Remove unused variable'],
        fixAllScopes: SCOPES,
      }),
      action('Use implicit type', { kind: 'refactor', path: ['Use implicit type'] }),
    ]);

    expect(treeOf(rows)).toEqual([
      {
        'Remove unused variable': [
          'Fix Here',
          '|',
          'Fix All in Containing Member',
          'Fix All in Containing Type',
          'Fix All in Document',
          'Fix All in Project',
          'Fix All in Solution',
        ],
      },
      '|',
      'Use implicit type',
    ]);
    expect(quickFixChoiceOf(idAt(rows, 'Remove unused variable', 'Fix Here') ?? '')).toEqual({
      indices: [0],
      scope: null,
    });
    expect(
      quickFixChoiceOf(idAt(rows, 'Remove unused variable', 'Fix All in Solution') ?? ''),
    ).toEqual({ indices: [1], scope: 'Solution' });
  });

  it('aFixAllWithNoFixBesideIt_isASubmenuOfItsScopes', () => {
    const rows: readonly MenuItem[] = buildQuickFixMenu([
      action('Fix All: Add braces', { fixAllScopes: ['Solution', 'Document', 'Workspace'] }),
    ]);

    expect(treeOf(rows)).toEqual([
      {
        'Fix All: Add braces': [
          'Fix All in Document',
          'Fix All in Solution',
          'Fix All in Workspace',
        ],
      },
    ]);
  });

  it('nestedActions_followTheirPaths_keepingEachChildsPlaceForTheChoice', () => {
    const at: (...path: string[]) => Partial<QuickFixAction> = (
      ...path: string[]
    ): Partial<QuickFixAction> => ({
      path: ['Suppress or configure issues', ...path],
    });
    const rows: readonly MenuItem[] = buildQuickFixMenu([
      action('Remove unused variable'),
      action('Suppress or configure issues', {
        path: ['Suppress or configure issues'],
        children: [
          action('in Source', at('Suppress CS0219', 'in Source')),
          action('Fix All: in Source', {
            ...at('Suppress CS0219', 'in Source'),
            fixAllScopes: ['Document', 'Solution'],
          }),
          action('None', at('Configure CS0219 severity', 'None')),
          action('Error', at('Configure CS0219 severity', 'Error')),
          action('Hidden', { ...at('Configure CS0219 severity', 'Hidden'), disabledReason: 'No.' }),
        ],
      }),
    ]);

    expect(treeOf(rows)).toEqual([
      'Remove unused variable',
      {
        'Suppress or configure issues': [
          {
            'Suppress CS0219': [
              { 'in Source': ['Fix Here', '|', 'Fix All in Document', 'Fix All in Solution'] },
            ],
          },
          { 'Configure CS0219 severity': ['None', 'Error'] },
        ],
      },
    ]);
    expect(
      quickFixChoiceOf(
        idAt(rows, 'Suppress or configure issues', 'Configure CS0219 severity', 'Error') ?? '',
      ),
    ).toEqual({ indices: [1, 3], scope: null });
    expect(
      quickFixChoiceOf(
        idAt(
          rows,
          'Suppress or configure issues',
          'Suppress CS0219',
          'in Source',
          'Fix All in Solution',
        ) ?? '',
      ),
    ).toEqual({ indices: [1, 1], scope: 'Solution' });
    // A submenu's own row chooses nothing.
    expect(quickFixChoiceOf(idAt(rows, 'Suppress or configure issues') ?? '')).toBeNull();
  });
});
