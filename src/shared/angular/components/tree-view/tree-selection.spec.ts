import { TreeSelection } from './tree-selection';

/**
 * The rows the tree shows, in order.
 */
const ORDER: readonly string[] = ['a', 'b', 'c', 'd', 'e'];

describe('TreeSelection (#1048)', () => {
  let selection: TreeSelection;

  beforeEach(() => {
    selection = new TreeSelection();
  });

  it('replace_selectsOneRowAlone_orNothing', () => {
    selection.replace('b');
    expect(selection.ids()).toEqual(['b']);
    expect(selection.focused()).toBe('b');

    selection.replace(null);
    expect(selection.ids()).toEqual([]);
    expect(selection.focused()).toBeNull();
  });

  it('toggle_addsAndRemovesRows_keepingTheTreesOrder', () => {
    selection.apply('d', 'replace', ORDER);
    selection.apply('b', 'toggle', ORDER);
    expect(selection.ids()).toEqual(['b', 'd']);
    expect(selection.focused()).toBe('b');

    // Taking the focused row away moves the focus to a row still selected.
    selection.apply('b', 'toggle', ORDER);
    expect(selection.ids()).toEqual(['d']);
    expect(selection.focused()).toBe('d');
  });

  it('extend_selectsTheRangeFromTheAnchor_eitherWay', () => {
    selection.apply('b', 'replace', ORDER);
    selection.apply('d', 'extend', ORDER);
    expect(selection.ids()).toEqual(['b', 'c', 'd']);
    expect(selection.focused()).toBe('d');

    // The anchor stays where the range started, so extending again re-measures from it.
    selection.apply('a', 'extend', ORDER);
    expect(selection.ids()).toEqual(['a', 'b']);
  });

  it('extend_withNoAnchor_selectsTheRowAlone', () => {
    selection.apply('c', 'extend', ORDER);

    expect(selection.ids()).toEqual(['c']);
  });

  it('selectAll_takesEveryRow_keepingTheFocusedOne', () => {
    selection.apply('c', 'replace', ORDER);
    selection.selectAll(ORDER);

    expect(selection.ids()).toEqual(ORDER);
    expect(selection.focused()).toBe('c');
  });

  it('targetsFor_isTheSelection_whenTheRowIsInIt_otherwiseTheRowAlone', () => {
    selection.apply('b', 'replace', ORDER);
    selection.apply('d', 'toggle', ORDER);

    expect(selection.targetsFor('d', ORDER)).toEqual(['b', 'd']);
    expect(selection.targetsFor('e', ORDER)).toEqual(['e']);
    // A selected row the tree no longer shows (its folder collapsed) is left out.
    expect(selection.targetsFor('d', ['a', 'c', 'd'])).toEqual(['d']);
  });
});
