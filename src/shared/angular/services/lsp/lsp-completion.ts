import type * as MonacoApi from 'monaco-editor';

/**
 * How a server completes (#1021): the characters that start a completion as they are typed, and
 * whether it fills a completion in when one is focused or accepted (`completionItem/resolve`).
 */
export interface LspCompletionSupport {
  /**
   * Gets the characters that start a completion as they are typed (`.`, `:`, `<`…).
   */
  readonly triggerCharacters: readonly string[];

  /**
   * Gets whether the server fills a completion in on request.
   */
  readonly resolve: boolean;
}

/**
 * How a server answers signature help (#1021): the characters that start it as they are typed, and
 * those that update it while it shows.
 */
export interface LspSignatureHelpSupport {
  /**
   * Gets the characters that start signature help (`(`, `,`…).
   */
  readonly triggerCharacters: readonly string[];

  /**
   * Gets the characters that update signature help while it shows.
   */
  readonly retriggerCharacters: readonly string[];
}

/**
 * A protocol range.
 */
export interface LspCompletionRange {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
}

/**
 * Markup content (markdown or plain text) a server sends.
 */
interface LspMarkupContent {
  readonly kind?: string;
  readonly value: string;
}

/**
 * A text edit a server sends.
 */
interface LspTextEdit {
  readonly range: LspCompletionRange;
  readonly newText: string;
}

/**
 * An insert-or-replace edit a server sends: the text inserts over `insert` and replaces over
 * `replace`, as the user chooses.
 */
interface LspInsertReplaceEdit {
  readonly newText: string;
  readonly insert: LspCompletionRange;
  readonly replace: LspCompletionRange;
}

/**
 * One completion a server sends, as the protocol (3.17) defines it.
 */
export interface LspCompletionItem {
  readonly label: string;
  readonly labelDetails?: { readonly detail?: string; readonly description?: string };
  readonly kind?: number;
  readonly tags?: readonly number[];
  readonly detail?: string;
  readonly documentation?: string | LspMarkupContent;
  readonly deprecated?: boolean;
  readonly preselect?: boolean;
  readonly sortText?: string;
  readonly filterText?: string;
  readonly insertText?: string;
  readonly insertTextFormat?: number;
  readonly insertTextMode?: number;
  readonly textEdit?: LspTextEdit | LspInsertReplaceEdit;
  readonly textEditText?: string;
  readonly additionalTextEdits?: readonly LspTextEdit[];
  readonly commitCharacters?: readonly string[];
  readonly command?: unknown;
  readonly data?: unknown;
}

/**
 * The defaults a completion list gives every item that does not say otherwise (3.17).
 */
interface LspItemDefaults {
  readonly commitCharacters?: readonly string[];
  readonly editRange?:
    | LspCompletionRange
    | { readonly insert: LspCompletionRange; readonly replace: LspCompletionRange };
  readonly insertTextFormat?: number;
  readonly insertTextMode?: number;
  readonly data?: unknown;
}

/**
 * A server's completion answer, read.
 */
export interface LspCompletionAnswer {
  /**
   * Gets the items, each with the list's defaults applied.
   */
  readonly items: readonly LspCompletionItem[];

  /**
   * Gets whether the list is incomplete: typing further asks the server again rather than filtering.
   */
  readonly incomplete: boolean;
}

/**
 * Holds the protocol's `InsertTextFormat.Snippet`.
 */
const SNIPPET_FORMAT: number = 2;

/**
 * Holds the protocol's `InsertTextMode.asIs`: the text keeps its whitespace as sent.
 */
const AS_IS_MODE: number = 1;

/**
 * Holds the protocol's (and Monaco's) `CompletionItemTag.Deprecated`.
 */
const DEPRECATED_TAG: number = 1;

/**
 * Names Monaco's completion kinds by the protocol's number for each (`CompletionItemKind`, 1–25).
 */
const KIND_NAMES: readonly string[] = [
  'Text',
  'Text',
  'Method',
  'Function',
  'Constructor',
  'Field',
  'Variable',
  'Class',
  'Interface',
  'Module',
  'Property',
  'Unit',
  'Value',
  'Enum',
  'Keyword',
  'Snippet',
  'Color',
  'File',
  'Reference',
  'Folder',
  'EnumMember',
  'Constant',
  'Struct',
  'Event',
  'Operator',
  'TypeParameter',
];

/**
 * Reads how a server completes from its `completionProvider`.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns how it completes, or null when it does not.
 */
export function completionSupportOf(capabilities: unknown): LspCompletionSupport | null {
  const provider: unknown = (capabilities as { completionProvider?: unknown } | undefined)
    ?.completionProvider;
  if (typeof provider !== 'object' || provider === null) {
    return null;
  }
  const entry: { triggerCharacters?: unknown; resolveProvider?: unknown } = provider;
  return {
    triggerCharacters: characters(entry.triggerCharacters),
    resolve: entry.resolveProvider === true,
  };
}

/**
 * Reads how a server answers signature help from its `signatureHelpProvider`.
 * @param capabilities The server's advertised capabilities (an LSP `ServerCapabilities`).
 * @returns Returns how it answers, or null when it does not.
 */
export function signatureHelpSupportOf(capabilities: unknown): LspSignatureHelpSupport | null {
  const provider: unknown = (capabilities as { signatureHelpProvider?: unknown } | undefined)
    ?.signatureHelpProvider;
  if (typeof provider !== 'object' || provider === null) {
    return null;
  }
  const entry: { triggerCharacters?: unknown; retriggerCharacters?: unknown } = provider;
  return {
    triggerCharacters: characters(entry.triggerCharacters),
    retriggerCharacters: characters(entry.retriggerCharacters),
  };
}

/**
 * Reads a server's completion answer — a bare array or a list — applying the list's item defaults
 * (3.17) to each item that does not say otherwise.
 * @param result The answer, untrusted.
 * @returns Returns the items and whether the list is incomplete.
 */
export function completionAnswer(result: unknown): LspCompletionAnswer {
  if (Array.isArray(result)) {
    return { items: result.filter(isItem), incomplete: false };
  }
  if (typeof result !== 'object' || result === null) {
    return { items: [], incomplete: false };
  }
  const list: { items?: unknown; isIncomplete?: unknown; itemDefaults?: unknown } = result;
  const defaults: LspItemDefaults =
    typeof list.itemDefaults === 'object' && list.itemDefaults !== null ? list.itemDefaults : {};
  const items: LspCompletionItem[] = Array.isArray(list.items) ? list.items.filter(isItem) : [];
  return {
    items: items.map((item: LspCompletionItem): LspCompletionItem => withDefaults(item, defaults)),
    incomplete: list.isIncomplete === true,
  };
}

/**
 * Maps a server's completion to Monaco's: its label (with its details), kind, tags, documentation,
 * the text it inserts — a snippet with tab stops, or plain — over the span it says (one span, or an
 * insert span and a replace span), its extra edits (an auto-import), the characters that accept it,
 * and the command it runs.
 * @param monaco The Monaco namespace, for its enumerations.
 * @param item The server's completion, with the list's defaults applied.
 * @param range The span replaced when the completion names none: the word typed so far.
 * @param command Maps the completion's command to Monaco's, or undefined when Studio does not run it.
 * @returns Returns Monaco's completion.
 */
export function toCompletionItem(
  monaco: typeof MonacoApi,
  item: LspCompletionItem,
  range: MonacoApi.IRange,
  command: (raw: unknown) => MonacoApi.languages.Command | undefined,
): MonacoApi.languages.CompletionItem {
  const languages: typeof MonacoApi.languages = monaco.languages;
  const edit: LspTextEdit | LspInsertReplaceEdit | undefined = item.textEdit;
  const rules: number =
    (item.insertTextFormat === SNIPPET_FORMAT
      ? languages.CompletionItemInsertTextRule.InsertAsSnippet
      : 0) |
    (item.insertTextMode === AS_IS_MODE
      ? languages.CompletionItemInsertTextRule.KeepWhitespace
      : 0);
  const tags: MonacoApi.languages.CompletionItemTag[] =
    (item.tags ?? []).includes(DEPRECATED_TAG) || item.deprecated === true ? [DEPRECATED_TAG] : [];
  const mapped: MonacoApi.languages.CompletionItem = {
    label:
      item.labelDetails === undefined
        ? item.label
        : {
            label: item.label,
            detail: item.labelDetails.detail,
            description: item.labelDetails.description,
          },
    kind: completionKind(monaco, item.kind),
    detail: item.detail,
    documentation: documentationOf(item.documentation),
    insertText: edit?.newText ?? item.insertText ?? item.label,
    insertTextRules: rules === 0 ? undefined : rules,
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect === true ? true : undefined,
    range:
      edit === undefined
        ? range
        : 'range' in edit
          ? rangeOf(edit.range)
          : { insert: rangeOf(edit.insert), replace: rangeOf(edit.replace) },
    additionalTextEdits: editsOf(item.additionalTextEdits),
    commitCharacters: item.commitCharacters === undefined ? undefined : [...item.commitCharacters],
    command: item.command === undefined ? undefined : command(item.command),
  };
  if (tags.length > 0) {
    mapped.tags = tags;
  }
  return mapped;
}

/**
 * Reads what a server filled in of a completion (`completionItem/resolve`): its detail, its
 * documentation and its extra edits — only what it sent.
 * @param resolved The server's answer, untrusted.
 * @returns Returns the parts of Monaco's completion it fills in.
 */
export function resolvedParts(resolved: unknown): Partial<MonacoApi.languages.CompletionItem> {
  if (!isItem(resolved)) {
    return {};
  }
  const parts: Partial<MonacoApi.languages.CompletionItem> = {};
  if (typeof resolved.detail === 'string') {
    parts.detail = resolved.detail;
  }
  if (resolved.documentation !== undefined) {
    parts.documentation = documentationOf(resolved.documentation);
  }
  if (Array.isArray(resolved.additionalTextEdits)) {
    parts.additionalTextEdits = editsOf(resolved.additionalTextEdits);
  }
  return parts;
}

/**
 * Maps Monaco's completion trigger to the protocol's: invoked (typing an identifier or ⌃Space), a
 * trigger character, or the re-asking of an incomplete list.
 * @param context Monaco's completion context.
 * @returns Returns the protocol's `CompletionContext`.
 */
export function completionContext(context: MonacoApi.languages.CompletionContext | undefined): {
  readonly triggerKind: number;
  readonly triggerCharacter?: string;
} {
  // Monaco numbers its kinds from 0 (Invoke, TriggerCharacter, TriggerForIncompleteCompletions); the
  // protocol from 1, in the same order.
  const triggerKind: number = (context?.triggerKind ?? 0) + 1;
  return context?.triggerCharacter === undefined
    ? { triggerKind }
    : { triggerKind, triggerCharacter: context.triggerCharacter };
}

/**
 * Maps a server's signature help to Monaco's: each signature with its parameters (labelled by text or
 * by offsets into the signature's label), its documentation and its active parameter, and which
 * signature and parameter are active.
 * @param result The server's answer, untrusted.
 * @returns Returns Monaco's signature help, or null when there are no signatures.
 */
export function toSignatureHelp(result: unknown): MonacoApi.languages.SignatureHelp | null {
  if (typeof result !== 'object' || result === null) {
    return null;
  }
  const help: { signatures?: unknown; activeSignature?: unknown; activeParameter?: unknown } =
    result;
  const signatures: MonacoApi.languages.SignatureInformation[] = Array.isArray(help.signatures)
    ? help.signatures.flatMap((raw: unknown): MonacoApi.languages.SignatureInformation[] => {
        const signature: MonacoApi.languages.SignatureInformation | null = signatureOf(raw);
        return signature === null ? [] : [signature];
      })
    : [];
  if (signatures.length === 0) {
    return null;
  }
  const active: number = typeof help.activeSignature === 'number' ? help.activeSignature : 0;
  return {
    signatures,
    activeSignature: active >= 0 && active < signatures.length ? active : 0,
    activeParameter: typeof help.activeParameter === 'number' ? help.activeParameter : 0,
  };
}

/**
 * Maps Monaco's signature help back to the protocol's, for the `activeSignatureHelp` a retrigger
 * sends.
 * @param help Monaco's signature help.
 * @returns Returns the protocol's.
 */
export function toLspSignatureHelp(help: MonacoApi.languages.SignatureHelp): unknown {
  return {
    signatures: help.signatures.map((signature: MonacoApi.languages.SignatureInformation) => ({
      label: signature.label,
      ...(signature.documentation === undefined
        ? {}
        : { documentation: lspDocumentation(signature.documentation) }),
      parameters: signature.parameters.map(
        (parameter: MonacoApi.languages.ParameterInformation) => ({
          label: parameter.label,
          ...(parameter.documentation === undefined
            ? {}
            : { documentation: lspDocumentation(parameter.documentation) }),
        }),
      ),
      ...(signature.activeParameter === undefined
        ? {}
        : { activeParameter: signature.activeParameter }),
    })),
    activeSignature: help.activeSignature,
    activeParameter: help.activeParameter,
  };
}

/**
 * Maps a protocol completion kind to Monaco's.
 * @param monaco The Monaco namespace, for its enumeration.
 * @param kind The protocol's kind, or undefined.
 * @returns Returns Monaco's kind: text when the kind is missing or unknown.
 */
export function completionKind(
  monaco: typeof MonacoApi,
  kind: number | undefined,
): MonacoApi.languages.CompletionItemKind {
  const kinds: Record<string, MonacoApi.languages.CompletionItemKind | undefined> = monaco.languages
    .CompletionItemKind as unknown as Record<string, MonacoApi.languages.CompletionItemKind>;
  const name: string = KIND_NAMES[kind ?? 1] ?? 'Text';
  return kinds[name] ?? monaco.languages.CompletionItemKind.Text;
}

/**
 * Maps a protocol range to Monaco's, zero-based to one-based.
 * @param range The protocol range.
 * @returns Returns Monaco's range.
 */
export function rangeOf(range: LspCompletionRange): MonacoApi.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

/**
 * Applies a completion list's item defaults to one of its items: the defaults stand where the item
 * says nothing. A default edit range makes the item an edit of that span, inserting its edit text (or
 * its insert text, or its label).
 * @param item The item.
 * @param defaults The list's defaults.
 * @returns Returns the item with the defaults applied.
 */
function withDefaults(item: LspCompletionItem, defaults: LspItemDefaults): LspCompletionItem {
  const range: LspItemDefaults['editRange'] = defaults.editRange;
  const newText: string = item.textEditText ?? item.insertText ?? item.label;
  return {
    ...item,
    commitCharacters: item.commitCharacters ?? defaults.commitCharacters,
    insertTextFormat: item.insertTextFormat ?? defaults.insertTextFormat,
    insertTextMode: item.insertTextMode ?? defaults.insertTextMode,
    data: item.data ?? defaults.data,
    textEdit:
      item.textEdit ??
      (range === undefined
        ? undefined
        : 'insert' in range
          ? { newText, insert: range.insert, replace: range.replace }
          : { newText, range }),
  };
}

/**
 * Reads a signature a server sent.
 * @param raw The signature, untrusted.
 * @returns Returns Monaco's signature, or null when it is malformed.
 */
function signatureOf(raw: unknown): MonacoApi.languages.SignatureInformation | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const entry: {
    label?: unknown;
    documentation?: unknown;
    parameters?: unknown;
    activeParameter?: unknown;
  } = raw;
  if (typeof entry.label !== 'string') {
    return null;
  }
  const parameters: MonacoApi.languages.ParameterInformation[] = Array.isArray(entry.parameters)
    ? entry.parameters.flatMap((parameter: unknown): MonacoApi.languages.ParameterInformation[] => {
        const label: unknown = (parameter as { label?: unknown } | null)?.label;
        const documentation: unknown = (parameter as { documentation?: unknown } | null)
          ?.documentation;
        const valid: boolean =
          typeof label === 'string' ||
          (Array.isArray(label) &&
            label.length === 2 &&
            typeof label[0] === 'number' &&
            typeof label[1] === 'number');
        return valid
          ? [
              {
                label: label as string | [number, number],
                documentation: documentationOf(
                  documentation as string | LspMarkupContent | undefined,
                ),
              },
            ]
          : [];
      })
    : [];
  return {
    label: entry.label,
    documentation: documentationOf(entry.documentation as string | LspMarkupContent | undefined),
    parameters,
    ...(typeof entry.activeParameter === 'number'
      ? { activeParameter: entry.activeParameter }
      : {}),
  };
}

/**
 * Maps a server's documentation to Monaco's: markdown as a markdown string, plain text as text.
 * @param documentation The documentation, or undefined.
 * @returns Returns Monaco's documentation, or undefined.
 */
function documentationOf(
  documentation: string | LspMarkupContent | undefined,
): string | MonacoApi.IMarkdownString | undefined {
  if (documentation === undefined || documentation === null) {
    return undefined;
  }
  if (typeof documentation === 'string') {
    return documentation;
  }
  if (typeof documentation.value !== 'string') {
    return undefined;
  }
  return documentation.kind === 'markdown' ? { value: documentation.value } : documentation.value;
}

/**
 * Maps Monaco's documentation back to the protocol's.
 * @param documentation Monaco's documentation.
 * @returns Returns the protocol's.
 */
function lspDocumentation(documentation: string | MonacoApi.IMarkdownString): unknown {
  return typeof documentation === 'string'
    ? documentation
    : { kind: 'markdown', value: documentation.value };
}

/**
 * Maps a server's extra edits to Monaco's.
 * @param edits The edits, or undefined.
 * @returns Returns Monaco's edits, or undefined for none.
 */
function editsOf(
  edits: readonly LspTextEdit[] | undefined,
): MonacoApi.editor.ISingleEditOperation[] | undefined {
  if (edits === undefined) {
    return undefined;
  }
  return edits
    .filter(
      (edit: LspTextEdit): boolean =>
        typeof edit === 'object' && edit !== null && typeof edit.newText === 'string',
    )
    .map((edit: LspTextEdit): MonacoApi.editor.ISingleEditOperation => ({
      range: rangeOf(edit.range),
      text: edit.newText,
    }));
}

/**
 * Reads a list of characters a server advertised.
 * @param raw The list, untrusted.
 * @returns Returns the characters, empty when there are none.
 */
function characters(raw: unknown): readonly string[] {
  return Array.isArray(raw)
    ? raw.filter((entry: unknown): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

/**
 * Determines whether an entry of a server's answer is a completion.
 * @param raw The entry, untrusted.
 * @returns Returns true when it has a label.
 */
function isItem(raw: unknown): raw is LspCompletionItem {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    typeof (raw as { label?: unknown }).label === 'string'
  );
}
