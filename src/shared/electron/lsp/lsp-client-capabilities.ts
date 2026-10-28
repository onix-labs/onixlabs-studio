import type { ClientCapabilities, SymbolKind } from 'vscode-languageserver-protocol';
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
      // Studio's completion list (#1021) inserts snippets with tab stops, honours the characters
      // that accept a completion, shows a completion's documentation as markdown (struck through when
      // deprecated, preselected when the server says), offers insert-or-replace, shows a label's
      // details, and asks the server to fill a completion in — its documentation, detail and extra
      // edits (an auto-import) — as it is focused. It sends what started each request, and reads a
      // list's item defaults.
      completion: {
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
      },
      // Studio's signature card (#1021) shows the active signature's documentation as markdown, with
      // the active parameter highlighted by its offsets or its text, and each signature's own active
      // parameter. It sends what started each request and the signatures showing.
      signatureHelp: {
        dynamicRegistration: false,
        signatureInformation: {
          documentationFormat: ['markdown', 'plaintext'],
          parameterInformation: { labelOffsetSupport: true },
          activeParameterSupport: true,
        },
        contextSupport: true,
      },
      hover: { contentFormat: ['markdown', 'plaintext'] },
      // The compiler's folds and the reads and writes of the symbol under the caret (#1147). Folds are
      // whole lines, as Monaco folds.
      foldingRange: {
        dynamicRegistration: false,
        lineFoldingOnly: true,
        foldingRangeKind: { valueSet: ['comment', 'imports', 'region'] },
      },
      documentHighlight: { dynamicRegistration: false },
      // Expand and Shrink Selection grow by the compiler's syntax nodes (#1155).
      selectionRange: { dynamicRegistration: false },
      // Facts above types and members — Roslyn's reference counts (#1149) — each filled in as shown.
      codeLens: { dynamicRegistration: false },
      // Parameter names and inferred types set into the code (#1145); the tooltip — the parameter's
      // or type's signature — and a hint's insertable text are filled in when it is hovered.
      inlayHint: {
        dynamicRegistration: false,
        resolveSupport: { properties: ['tooltip', 'textEdits', 'label.tooltip'] },
      },
      // Format Document, Format Selection and format-on-type (#1141): the server lays the code out,
      // honouring the project's own conventions (`.editorconfig` for Roslyn).
      formatting: { dynamicRegistration: false },
      rangeFormatting: { dynamicRegistration: false },
      onTypeFormatting: { dynamicRegistration: false },
      definition: { linkSupport: false },
      // Go to Implementation and Go to Type Definition (#1142), answered by path like a definition.
      implementation: { linkSupport: false },
      typeDefinition: { linkSupport: false },
      references: {},
      // A member's callers and callees, and a type's base and derived types (#1153).
      callHierarchy: { dynamicRegistration: false },
      typeHierarchy: { dynamicRegistration: false },
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
      // Range as well as full (#1147): Monaco paints the screen shown from a range request before the
      // whole file's tokens arrive. Roslyn then advertises `full: false`, but answers full requests
      // still — and the full provider is registered off the server's legend, not that flag.
      semanticTokens: {
        requests: { full: true, range: true },
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
      // A changed setting is announced with `didChangeConfiguration`, on which a server asks for its
      // configuration again (#1143); nothing is registered for it dynamically.
      didChangeConfiguration: { dynamicRegistration: false },
      semanticTokens: { refreshSupport: true },
      // A server may say its diagnostics are stale (a project finished loading, the analysis scope
      // changed), on which the workspace pull starts afresh (#1144).
      diagnostics: { refreshSupport: true },
      // A server may say its hints are stale (a setting changed, a project loaded), on which the
      // editors ask again (#1145).
      inlayHint: { refreshSupport: true },
      // A server may say its lenses are stale, on which the editors ask again (#1149).
      codeLens: { refreshSupport: true },
      // Go to Symbol in Workspace (#1146). No resolveSupport: a server must say where each symbol is
      // in its first answer, which Roslyn does.
      symbol: {
        dynamicRegistration: false,
        symbolKind: {
          valueSet: Array.from(
            { length: 26 },
            (_: unknown, index: number): SymbolKind => (index + 1) as SymbolKind,
          ),
        },
      },
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
    // A server's question is put to the user with its actions as buttons, and the chosen action
    // returned exactly as the server sent it, whatever else it carries (#1154).
    window: {
      workDoneProgress: true,
      showMessage: { messageActionItem: { additionalPropertiesSupport: true } },
    },
  };
}
