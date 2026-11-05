import { markdownDestination } from './markdown-destination';

describe('markdownDestination', () => {
  it('markdownDestination_leavesAnOrdinaryUrlBare', () => {
    expect(markdownDestination('https://x.test/a.png?b=1')).toBe('https://x.test/a.png?b=1');
  });

  it('markdownDestination_wrapsAPathWithSpaces', () => {
    expect(markdownDestination('../my photos/a.png')).toBe('<../my photos/a.png>');
  });

  it('markdownDestination_wrapsParentheses', () => {
    expect(markdownDestination('a(1).png')).toBe('<a(1).png>');
  });

  it('markdownDestination_escapesABackslash_soItCannotCancelABracketsEscape', () => {
    expect(markdownDestination('a\\> b')).toBe('<a\\\\\\> b>');
  });

  it('markdownDestination_keepsAWindowsPathWhole', () => {
    expect(markdownDestination('C:\\my photos\\a.png')).toBe('<C:\\\\my photos\\\\a.png>');
  });

  it('markdownDestination_encodesALineBreak_whichTheBracketsCannotHold', () => {
    expect(markdownDestination('a\r\nb')).toBe('<a%0D%0Ab>');
  });

  it('markdownDestination_escapesTheBracketsThatWouldEndTheWrapper', () => {
    expect(markdownDestination('a>b c')).toBe('<a\\>b c>');
  });
});
