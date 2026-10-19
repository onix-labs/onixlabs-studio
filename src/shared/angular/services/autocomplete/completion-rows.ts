import type * as MonacoApi from 'monaco-editor';
import { Icon } from '@shared/angular/icons/icon';
import {
  escapeMarkdown,
  fenced,
  prepareMarkdown,
} from '@shared/angular/services/hover/hover-content';
import type { SuggestItem } from '@shared/angular/services/monaco/monaco-suggest-commands';

/**
 * Names Monaco's completion kinds.
 */
export type CompletionKindName =
  | 'Method'
  | 'Function'
  | 'Constructor'
  | 'Field'
  | 'Variable'
  | 'Class'
  | 'Struct'
  | 'Interface'
  | 'Module'
  | 'Property'
  | 'Event'
  | 'Operator'
  | 'Unit'
  | 'Value'
  | 'Constant'
  | 'Enum'
  | 'EnumMember'
  | 'Keyword'
  | 'Text'
  | 'Color'
  | 'File'
  | 'Reference'
  | 'Customcolor'
  | 'Folder'
  | 'TypeParameter'
  | 'User'
  | 'Issue'
  | 'Tool'
  | 'Snippet';

/**
 * Holds Monaco's `CompletionItemKind` values, written as values for a window with no Monaco to read
 * them from (and for the specs).
 */
export const COMPLETION_KIND: Readonly<Record<CompletionKindName, number>> = {
  Method: 0,
  Function: 1,
  Constructor: 2,
  Field: 3,
  Variable: 4,
  Class: 5,
  Struct: 6,
  Interface: 7,
  Module: 8,
  Property: 9,
  Event: 10,
  Operator: 11,
  Unit: 12,
  Value: 13,
  Constant: 14,
  Enum: 15,
  EnumMember: 16,
  Keyword: 17,
  Text: 18,
  Color: 19,
  File: 20,
  Reference: 21,
  Customcolor: 22,
  Folder: 23,
  TypeParameter: 24,
  User: 25,
  Issue: 26,
  Tool: 27,
  Snippet: 28,
};

/**
 * Holds Monaco's `CompletionItemTag.Deprecated`.
 */
const DEPRECATED_TAG: number = 1;

/**
 * Lists the icon of each completion kind, by Monaco's number for it.
 */
const KIND_ICONS: ReadonlyMap<number, Icon> = new Map<number, Icon>([
  [COMPLETION_KIND.Method, Icon.SYMBOL_FUNCTION],
  [COMPLETION_KIND.Function, Icon.SYMBOL_FUNCTION],
  [COMPLETION_KIND.Constructor, Icon.SYMBOL_FUNCTION],
  [COMPLETION_KIND.Field, Icon.SYMBOL_FIELD],
  [COMPLETION_KIND.Variable, Icon.SYMBOL_VARIABLE],
  [COMPLETION_KIND.Class, Icon.SYMBOL_CLASS],
  [COMPLETION_KIND.Struct, Icon.SYMBOL_CLASS],
  [COMPLETION_KIND.Interface, Icon.SYMBOL_INTERFACE],
  [COMPLETION_KIND.Module, Icon.SYMBOL_NAMESPACE],
  [COMPLETION_KIND.Property, Icon.SYMBOL_PROPERTY],
  [COMPLETION_KIND.Event, Icon.SYMBOL_EVENT],
  [COMPLETION_KIND.Operator, Icon.SYMBOL_OPERATOR],
  [COMPLETION_KIND.Unit, Icon.SYMBOL_UNIT],
  [COMPLETION_KIND.Value, Icon.SYMBOL_VALUE],
  [COMPLETION_KIND.Constant, Icon.SYMBOL_CONSTANT],
  [COMPLETION_KIND.Enum, Icon.SYMBOL_ENUM],
  [COMPLETION_KIND.EnumMember, Icon.SYMBOL_ENUM],
  [COMPLETION_KIND.Keyword, Icon.SYMBOL_KEYWORD],
  [COMPLETION_KIND.Text, Icon.SYMBOL_TEXT],
  [COMPLETION_KIND.Color, Icon.SYMBOL_COLOR],
  [COMPLETION_KIND.Customcolor, Icon.SYMBOL_COLOR],
  [COMPLETION_KIND.File, Icon.FILE],
  [COMPLETION_KIND.Reference, Icon.LINK],
  [COMPLETION_KIND.Folder, Icon.FOLDER],
  [COMPLETION_KIND.TypeParameter, Icon.SYMBOL_TYPE_PARAMETER],
  [COMPLETION_KIND.Snippet, Icon.SYMBOL_SNIPPET],
]);

/**
 * Lists the name each completion kind is read out as, by Monaco's number for it.
 */
const KIND_NAMES: ReadonlyMap<number, string> = new Map<number, string>(
  Object.entries(COMPLETION_KIND).map(([name, kind]: [string, number]): [number, string] => [
    kind,
    name === 'Customcolor'
      ? 'colour'
      : name === 'EnumMember'
        ? 'enum member'
        : name === 'TypeParameter'
          ? 'type parameter'
          : name.toLowerCase(),
  ]),
);

/**
 * A run of a row's label, flagged whether it matches what was typed.
 */
export interface LabelRun {
  /**
   * Gets the run's text.
   */
  readonly text: string;

  /**
   * Gets whether the run matches what was typed, and is highlighted.
   */
  readonly match: boolean;
}

/**
 * One row of Studio's completion list (#1021): a completion's kind icon, its label with what was typed
 * highlighted, and its detail.
 */
export interface CompletionRow {
  /**
   * Gets the icon of the completion's kind.
   */
  readonly icon: Icon;

  /**
   * Gets the name of the completion's kind, as a screen reader reads it.
   */
  readonly kindName: string;

  /**
   * Gets the label as text.
   */
  readonly label: string;

  /**
   * Gets the label in runs, the matched ones highlighted.
   */
  readonly runs: readonly LabelRun[];

  /**
   * Gets what follows the label straight after it (a signature's parameters), or null.
   */
  readonly labelDetail: string | null;

  /**
   * Gets what the row says at its end (a type, a module), or null.
   */
  readonly detail: string | null;

  /**
   * Gets whether the completion is deprecated, and its label struck through.
   */
  readonly deprecated: boolean;
}

/**
 * What the details pane shows of the focused completion.
 */
export interface CompletionDetails {
  /**
   * Gets the sections, as markdown: the completion's detail as code, then its documentation.
   */
  readonly sections: readonly string[];
}

/**
 * Builds the row of a completion.
 * @param item The completion.
 * @returns Returns the row.
 */
export function rowOf(item: SuggestItem): CompletionRow {
  const completion: MonacoApi.languages.CompletionItem = item.completion;
  const label: string | MonacoApi.languages.CompletionItemLabel = completion.label;
  const described: MonacoApi.languages.CompletionItemLabel | null =
    typeof label === 'string' ? null : label;
  const labelDetail: string | null = nonEmpty(described?.detail);
  // A label's own description says what Monaco's row shows at its end; a completion's detail stands in
  // when it has none, unless it only repeats the label.
  const detail: string | null =
    nonEmpty(described?.description) ??
    (completion.detail !== undefined && completion.detail !== item.textLabel
      ? nonEmpty(firstLine(completion.detail))
      : null);
  return {
    icon: KIND_ICONS.get(completion.kind) ?? Icon.SYMBOL_OTHER,
    kindName: KIND_NAMES.get(completion.kind) ?? 'completion',
    label: item.textLabel,
    runs: labelRuns(item.textLabel, item.score),
    labelDetail,
    detail,
    deprecated: (completion.tags ?? []).includes(DEPRECATED_TAG),
  };
}

/**
 * Splits a label into runs around the characters a fuzzy score matched, as Monaco's list highlights
 * them.
 * @param label The label.
 * @param score The fuzzy score: its rank, the word's start, then the matched positions.
 * @returns Returns the runs, which together spell the label.
 */
export function labelRuns(label: string, score: readonly number[]): LabelRun[] {
  const matched: boolean[] = new Array<boolean>(label.length).fill(false);
  const start: number = score[1] ?? 0;
  for (let index: number = 2; index < score.length; index += 1) {
    const at: number = score[index] + start;
    if (at >= 0 && at < label.length) {
      matched[at] = true;
    }
  }
  const runs: LabelRun[] = [];
  for (let index: number = 0; index < label.length; index += 1) {
    const last: LabelRun | undefined = runs[runs.length - 1];
    if (last?.match === matched[index]) {
      runs[runs.length - 1] = { text: last.text + label[index], match: last.match };
    } else {
      runs.push({ text: label[index], match: matched[index] });
    }
  }
  return runs;
}

/**
 * Builds what the details pane shows of a completion: its detail as code in the document's language,
 * then its documentation as Studio markdown — markdown when the provider sent markdown, plain text
 * escaped otherwise. A detail that only repeats the label is left out.
 * @param item The completion.
 * @param languageId The document's language, which the detail is highlighted in.
 * @returns Returns the details, or null when there is nothing to show.
 */
export function detailsOf(item: SuggestItem, languageId: string): CompletionDetails | null {
  const completion: MonacoApi.languages.CompletionItem = item.completion;
  const sections: string[] = [];
  const detail: string | null = nonEmpty(completion.detail?.trim());
  if (detail !== null && detail !== item.textLabel) {
    sections.push(fenced(detail, languageId));
  }
  const documentation: string | MonacoApi.IMarkdownString | undefined = completion.documentation;
  const docs: string =
    documentation === undefined
      ? ''
      : typeof documentation === 'string'
        ? escapeMarkdown(documentation)
        : prepareMarkdown(documentation);
  if (docs.trim().length > 0) {
    sections.push(docs.trim());
  }
  return sections.length === 0 ? null : { sections };
}

/**
 * Determines whether a completion might show more once its provider fills it in.
 * @param item The completion.
 * @returns Returns true when its provider resolves completions and has not resolved this one.
 */
export function canResolve(item: SuggestItem): boolean {
  return typeof item.provider.resolveCompletionItem === 'function' && !item.isResolved;
}

/**
 * Takes the first line of a text.
 * @param text The text.
 * @returns Returns its first line.
 */
function firstLine(text: string): string {
  const end: number = text.indexOf('\n');
  return end < 0 ? text : text.slice(0, end);
}

/**
 * Reads a text that may be missing or blank.
 * @param text The text.
 * @returns Returns the text trimmed, or null when it is missing or blank.
 */
function nonEmpty(text: string | undefined): string | null {
  const trimmed: string | undefined = text?.trim();
  return trimmed === undefined || trimmed.length === 0 ? null : trimmed;
}
