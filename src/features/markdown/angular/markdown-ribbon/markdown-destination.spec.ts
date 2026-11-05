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

  it('markdownDestination_escapesTheBracketsThatWouldEndTheWrapper', () => {
    expect(markdownDestination('a>b c')).toBe('<a\\>b c>');
  });
});
