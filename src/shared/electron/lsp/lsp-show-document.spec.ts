import { toShowDocumentRequest } from './lsp-show-document';

describe('toShowDocumentRequest (#1211)', () => {
  it('aWebPage_opensInTheBrowser_whateverTheServerAsked', () => {
    expect(
      toShowDocumentRequest('s1', { uri: 'http://127.0.0.1:61234/gopls/abc/pkg/example.com/x' }),
    ).toEqual({
      sessionId: 's1',
      uri: 'http://127.0.0.1:61234/gopls/abc/pkg/example.com/x',
      external: true,
    });
  });

  it('aFile_opensInStudio_withItsSelection', () => {
    expect(
      toShowDocumentRequest('s1', {
        uri: 'file:///w/shapes.go',
        takeFocus: true,
        selection: { start: { line: 4, character: 5 }, end: { line: 4, character: 19 } },
      }),
    ).toEqual({
      sessionId: 's1',
      uri: 'file:///w/shapes.go',
      external: false,
      selection: { start: { line: 4, character: 5 }, end: { line: 4, character: 19 } },
    });
  });

  it('aFileWithAMalformedSelection_opensWithout_it', () => {
    expect(
      toShowDocumentRequest('s1', {
        uri: 'file:///w/shapes.go',
        selection: { start: { line: -1, character: 0 }, end: { line: 1 } },
      }),
    ).toEqual({ sessionId: 's1', uri: 'file:///w/shapes.go', external: false });
  });

  it('aFileForTheOperatingSystem_isRefused', () => {
    expect(toShowDocumentRequest('s1', { uri: 'file:///w/app', external: true })).toBeNull();
  });

  it.each(['javascript:alert(1)', 'data:text/html,<p>hi</p>', 'vscode://settings', 'not a uri'])(
    'anyOtherScheme_isRefused: %s',
    (uri: string) => {
      expect(toShowDocumentRequest('s1', { uri })).toBeNull();
    },
  );

  it.each([null, undefined, 3, {}, { uri: 42 }])('malformedParams_areRefused: %s', (params) => {
    expect(toShowDocumentRequest('s1', params)).toBeNull();
  });
});
