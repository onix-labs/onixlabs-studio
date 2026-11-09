import { ExplorerFilter } from './explorer-filter';

describe('ExplorerFilter (#1182 follow-up)', () => {
  const KEY: string = 'test.explorer.filters';
  const LEGACY: string = 'test.explorer.changesOnly';

  afterEach(() => {
    localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY);
  });

  it('isAdditive_rememberingWhatIsTicked', () => {
    const filter: ExplorerFilter = new ExplorerFilter(KEY, LEGACY);
    expect(filter.active()).toBe(false);

    filter.toggle('changes');
    filter.toggle('error');
    filter.toggle('changes');

    expect([...filter.selected()]).toEqual(['error']);
    expect(filter.active()).toBe(true);
    expect([...new ExplorerFilter(KEY, LEGACY).selected()]).toEqual(['error']);
  });

  it('carriesOverTheOlderShowChangedFilesOnlySwitch_asShowDifferences', () => {
    localStorage.setItem(LEGACY, 'true');

    expect([...new ExplorerFilter(KEY, LEGACY).selected()]).toEqual(['changes']);
  });

  it('ignoresWhatItCannotRead_andClearsOnlyWhatIsTicked', () => {
    localStorage.setItem(KEY, '["error","bogus",3]');
    const filter: ExplorerFilter = new ExplorerFilter(KEY, LEGACY);

    filter.clear('warning');
    expect([...filter.selected()]).toEqual(['error']);
    filter.clear('error');
    expect(filter.active()).toBe(false);
  });
});
