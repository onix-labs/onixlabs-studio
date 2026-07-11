import { MarkdownPipe } from './markdown-pipe';

describe('MarkdownPipe', () => {
  let pipe: MarkdownPipe;

  beforeEach(() => {
    pipe = new MarkdownPipe();
  });

  it('transform_whenNullUndefinedOrEmpty_returnsEmptyString', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
    expect(pipe.transform('')).toBe('');
  });

  it('transform_whenPlainText_wrapsItInAParagraph', () => {
    const html: string = pipe.transform('hello world');

    expect(html).toContain('<p>hello world</p>');
  });

  it('transform_whenHeadingMarkdown_rendersAHeadingElement', () => {
    const html: string = pipe.transform('# Title');

    expect(html).toContain('<h1');
    expect(html).toContain('Title');
  });

  it('transform_whenInlineMarkdown_rendersEmphasisAndCode', () => {
    const html: string = pipe.transform('**bold** and `code`');

    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('transform_whenListMarkdown_rendersListItems', () => {
    const html: string = pipe.transform('- first\n- second');

    expect(html).toContain('<ul>');
    expect(html).toContain('<li>first</li>');
    expect(html).toContain('<li>second</li>');
  });
});
