import { parseSpellingConfiguration } from './spelling-channels';

describe('parseSpellingConfiguration', () => {
  it('readsAConfiguration_droppingAnythingThatIsNotAWord', () => {
    expect(
      parseSpellingConfiguration({
        enabled: false,
        languages: ['en-GB', 3, ''],
        words: ['Studio', null],
      }),
    ).toEqual({ enabled: false, languages: ['en-GB'], words: ['Studio'] });
  });

  it('defaultsToOnWithNothingChosen', () => {
    expect(parseSpellingConfiguration({})).toEqual({ enabled: true, languages: [], words: [] });
  });

  it('rejectsAValueThatIsNotAnObject', () => {
    expect(parseSpellingConfiguration('on')).toBeUndefined();
    expect(parseSpellingConfiguration(null)).toBeUndefined();
  });
});
