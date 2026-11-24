import { TestBed } from '@angular/core/testing';
import { SplitSizes } from './split-sizes';

describe('SplitSizes', () => {
  let sizes: SplitSizes;

  beforeEach(() => {
    localStorage.clear();
    sizes = TestBed.inject(SplitSizes);
  });

  afterEach(() => localStorage.clear());

  it('get_whenNothingWasSet_returnsNull', () => {
    expect(sizes.get('query', 'results')).toBeNull();
  });

  it('get_afterASet_returnsIt', () => {
    sizes.set('query', 'results', 240);

    expect(sizes.get('query', 'results')).toBe(240);
  });

  it('set_leavesOtherPanesAndOtherSplitsAlone', () => {
    sizes.set('query', 'results', 240);
    sizes.set('query', 'plan', 300);
    sizes.set('request', 'results', 100);

    expect(sizes.get('query', 'results')).toBe(240);
    expect(sizes.get('query', 'plan')).toBe(300);
    expect(sizes.get('request', 'results')).toBe(100);
  });

  it('get_whenWhatIsStoredIsNotASize_passesOverIt', () => {
    localStorage.setItem('split.query', JSON.stringify({ a: 'wide', b: -5, c: null, d: 50 }));

    expect(sizes.get('query', 'a')).toBeNull();
    expect(sizes.get('query', 'b')).toBeNull();
    expect(sizes.get('query', 'c')).toBeNull();
    expect(sizes.get('query', 'd')).toBe(50);
  });

  it('get_whenWhatIsStoredIsNotAnObject_returnsNull', () => {
    localStorage.setItem('split.query', JSON.stringify([1, 2]));

    expect(sizes.get('query', '0')).toBeNull();
  });

  describe('a size the panel layout kept', () => {
    beforeEach(() => {
      localStorage.setItem(
        'panel-layout.query',
        JSON.stringify({ results: { edge: 'bottom', order: 0, size: 310 }, odd: { size: 'tall' } }),
      );
    });

    it('get_whenNoneIsSetUnderTheSplit_takesItOver', () => {
      expect(sizes.get('query', 'results')).toBe(310);

      localStorage.removeItem('panel-layout.query');
      expect(sizes.get('query', 'results')).toBe(310);
    });

    it('get_whenOneIsSetUnderTheSplit_prefersIt', () => {
      sizes.set('query', 'results', 200);

      expect(sizes.get('query', 'results')).toBe(200);
    });

    it('get_whenItIsNotASize_returnsNull', () => {
      expect(sizes.get('query', 'odd')).toBeNull();
      expect(sizes.get('query', 'missing')).toBeNull();
    });
  });
});
