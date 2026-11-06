import type { ClientCapabilities } from 'vscode-languageserver-protocol';
import { clientCapabilities } from './lsp-client-capabilities';

describe('clientCapabilities', () => {
  it('workspace_asksServersWhatARenamedFileChanges (#1207)', () => {
    expect(clientCapabilities().workspace?.fileOperations).toEqual({
      dynamicRegistration: false,
      willRename: true,
    });
  });

  it('completion_advertisesWhatStudiosCompletionListHonours (#1021)', () => {
    const capabilities: ClientCapabilities = clientCapabilities();

    expect(capabilities.textDocument?.completion).toEqual({
      dynamicRegistration: false,
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        preselectSupport: true,
        tagSupport: { valueSet: [1] },
        insertReplaceSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
        insertTextModeSupport: { valueSet: [1, 2] },
        labelDetailsSupport: true,
      },
      contextSupport: true,
      completionList: {
        itemDefaults: [
          'commitCharacters',
          'editRange',
          'insertTextFormat',
          'insertTextMode',
          'data',
        ],
      },
    });
  });

  it('signatureHelp_advertisesWhatStudiosSignatureCardHonours (#1021)', () => {
    expect(clientCapabilities().textDocument?.signatureHelp).toEqual({
      dynamicRegistration: false,
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
      contextSupport: true,
    });
  });
});
