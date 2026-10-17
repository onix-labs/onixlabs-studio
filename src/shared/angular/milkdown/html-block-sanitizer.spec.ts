import { sanitizeHtmlBlock } from './html-block-sanitizer';

describe('sanitizeHtmlBlock', () => {
  it('keepsAnImageAndItsLayout', () => {
    expect(
      sanitizeHtmlBlock('<p align="center"><img src="./logo.png" alt="Logo" width="120"></p>'),
    ).toBe('<p align="center"><img src="./logo.png" alt="Logo" width="120"></p>');
  });

  it('dropsWhatCanRun', () => {
    expect(sanitizeHtmlBlock('<p align="left"><img src="x" onerror="alert(1)"></p>')).toBe(
      '<p align="left"><img src="x"></p>',
    );
    expect(
      sanitizeHtmlBlock('<p><script>alert(1)</script><a href="javascript:alert(1)">x</a></p>'),
    ).toBe('<p><a>x</a></p>');
  });

  it('dropsWhatCanNavigateRestyleOrTakeInput', () => {
    // Audit S5: each of these got through the content-security policy. A refresh sent the user to a
    // web page the moment a cloned README opened; a style covered the rest of the window.
    expect(
      sanitizeHtmlBlock(
        '<p align="left"><meta http-equiv="refresh" content="0;url=https://attacker.example"></p>',
      ),
    ).toBe('<p align="left"></p>');
    expect(sanitizeHtmlBlock('<p><style>body{display:none}</style>text</p>')).toBe('<p>text</p>');
    // The parser closes the paragraph at the form; the form, its field and its button go, and only
    // the button's caption is left as text.
    expect(
      sanitizeHtmlBlock(
        '<p><form action="https://attacker.example"><input name="q"><button>go</button></form></p>',
      ),
    ).toBe('<p></p>go<p></p>');
    expect(
      sanitizeHtmlBlock(
        '<p><link rel="stylesheet" href="https://x/y.css"><base href="https://x/"></p>',
      ),
    ).toBe('<p></p>');
  });

  it('keepsALinkToTheWeb_whichOpensInTheBrowserOnlyWhenClicked', () => {
    expect(sanitizeHtmlBlock('<p><a href="https://example.test">docs</a></p>')).toBe(
      '<p><a href="https://example.test">docs</a></p>',
    );
  });
});
