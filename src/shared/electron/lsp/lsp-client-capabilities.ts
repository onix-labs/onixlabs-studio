import type { ClientCapabilities } from 'vscode-languageserver-protocol';
import { SEMANTIC_TOKEN_MODIFIERS, SEMANTIC_TOKEN_TYPES } from '@shared/api/lsp-channels';

/**
 * Builds the client capabilities advertised to every server. They cover diagnostics, document
 * synchronisation, and the core language features the renderer client surfaces.
 * @returns Returns the client capabilities.
 */
export function clientCapabilities(): ClientCapabilities {
  return {
    textDocument: {
      synchronization: { dynamicRegistration: true, didSave: true },
      publishDiagnostics: { relatedInformation: true },
      // Advertise pull diagnostics so a pull-based server (notably the Roslyn C# server, which does
      // not push `publishDiagnostics`) advertises its `diagnosticProvider` back and answers
      // `textDocument/diagnostic`; without this the server treats the client as push-only and the
      // Error List never receives its errors.
      diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
      completion: { completionItem: { snippetSupport: true } },
      hover: { contentFormat: ['markdown', 'plaintext'] },
      definition: { linkSupport: false },
      references: {},
      // Nested symbols, so a server answers with each type's members inside it rather than one flat
      // list; the editor strip's Type and Member dropdowns read them (#882).
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      // Studio's Rename Symbol (#1015) asks the server first whether the symbol at the caret can be
      // renamed, and what its name spans, before it asks for the new name.
      rename: { prepareSupport: true },
      // Studio's quick-fix menu (#1016) lists a server's code actions as literals — fixes first, the
      // preferred ones at the top, refactors and source actions below — with the ones that cannot run
      // greyed and saying why. A server may leave an action's edit and command out until it is chosen,
      // keeping data of its own on it to fill them in from (`codeAction/resolve`). Change annotations
      // are not shown, so none is asked to be honoured.
      codeAction: {
        dynamicRegistration: false,
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: [
              '',
              'quickfix',
              'refactor',
              'refactor.extract',
              'refactor.inline',
              'refactor.rewrite',
              'source',
              'source.organizeImports',
              'source.fixAll',
            ],
          },
        },
        isPreferredSupport: true,
        disabledSupport: true,
        dataSupport: true,
        resolveSupport: { properties: ['edit', 'command'] },
        honorsChangeAnnotations: false,
      },
      // Advertise semantic tokens so servers send them; the renderer maps each server's legend onto
      // the standard one and feeds Monaco, colouring types, members, and parameters.
      semanticTokens: {
        requests: { full: true, range: false },
        tokenTypes: [...SEMANTIC_TOKEN_TYPES],
        tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
        formats: ['relative'],
        overlappingTokenSupport: false,
        multilineTokenSupport: false,
      },
    },
    // `refreshSupport` tells a server it may send `workspace/semanticTokens/refresh` when its
    // classification improves (a project finishes loading); without it heavy servers never signal
    // that their initial, degraded tokens should be re-requested.
    workspace: {
      workspaceFolders: true,
      configuration: true,
      semanticTokens: { refreshSupport: true },
      // The main process watches the session root and sends `didChangeWatchedFiles`; a server
      // narrows that to its own globs through a dynamic registration.
      didChangeWatchedFiles: { dynamicRegistration: true, relativePatternSupport: true },
      // A server's `workspace/applyEdit` is applied by the renderer (#1015), and a rename's answer may
      // come either as per-file `changes` or as versioned `documentChanges`. Creating, renaming and
      // deleting files is not supported yet: no resource operations are advertised, and any a server
      // sends anyway are refused and named rather than half-applied.
      applyEdit: true,
      workspaceEdit: { documentChanges: true, resourceOperations: [] },
      // A chosen code action's command runs on the server (#1016), when the server lists it among
      // the commands it runs; whatever it changes comes back as a `workspace/applyEdit`.
      executeCommand: { dynamicRegistration: false },
    },
    window: { workDoneProgress: true },
  };
}
