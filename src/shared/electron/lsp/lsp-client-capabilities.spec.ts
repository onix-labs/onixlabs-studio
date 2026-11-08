import type { ClientCapabilities } from 'vscode-languageserver-protocol';
import { clientCapabilities } from './lsp-client-capabilities';

describe('clientCapabilities: Go to Declaration (#1213)', () => {
  it('asksForDeclarations_byPathLikeADefinition', () => {
    expect(clientCapabilities().textDocument?.declaration).toEqual({ linkSupport: false });
  });
});

describe('clientCapabilities', () => {
  it('workspace_asksServersWhatARenamedFileChanges (#1207)', () => {
    expect(clientCapabilities().workspace?.fileOperations).toEqual({
      dynamicRegistration: false,
      willRename: true,
    });
  });

  it('textDocument_tellsClangdItFadesWhatThePreprocessorLeavesOut (#1213)', () => {
    expect(clientCapabilities('clangd').textDocument).toMatchObject({
      inactiveRegionsCapabilities: { inactiveRegions: true },
    });
  });

  it('experimental_asksAServerToSayHowItIs (#1210)', () => {
    expect(clientCapabilities().experimental).toMatchObject({ serverStatusNotification: true });
  });

  it('workspaceEdit_tellsOnlyAServerItHasBeenTriedWith_thatAFileMayBeCreated (#1210)', () => {
    expect(clientCapabilities('rust').workspace?.workspaceEdit?.resourceOperations).toEqual([
      'create',
    ]);
    expect(clientCapabilities('typescript').workspace?.workspaceEdit?.resourceOperations).toEqual(
      [],
    );
    expect(clientCapabilities().workspace?.workspaceEdit?.resourceOperations).toEqual([]);
  });

  it('experimental_namesTheCommandsALensMayCarry_andNoDebuggerThereIsNot (#1210)', () => {
    expect(clientCapabilities().experimental).toMatchObject({
      commands: { commands: ['rust-analyzer.runSingle', 'rust-analyzer.showReferences'] },
    });
  });

  it('diagnostics_advertiseUnnecessaryAndDeprecatedTags_pushedAndPulled', () => {
    const capabilities: ClientCapabilities = clientCapabilities();

    expect(capabilities.textDocument?.publishDiagnostics?.tagSupport).toEqual({ valueSet: [1, 2] });
    expect(capabilities.textDocument?.diagnostic?.tagSupport).toEqual({ valueSet: [1, 2] });
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
