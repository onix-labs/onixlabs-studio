import { selectAllTargetsDocument } from './select-all-scope';

describe('selectAllTargetsDocument', () => {
  it('selectAllTargetsDocument_whenPrimaryBlock_plainChordSelectsBlock', () => {
    expect(selectAllTargetsDocument('block', false)).toBe(false);
  });

  it('selectAllTargetsDocument_whenPrimaryBlock_shiftChordSelectsDocument', () => {
    expect(selectAllTargetsDocument('block', true)).toBe(true);
  });

  it('selectAllTargetsDocument_whenPrimaryDocument_plainChordSelectsDocument', () => {
    expect(selectAllTargetsDocument('document', false)).toBe(true);
  });

  it('selectAllTargetsDocument_whenPrimaryDocument_shiftChordSelectsBlock', () => {
    expect(selectAllTargetsDocument('document', true)).toBe(false);
  });
});
