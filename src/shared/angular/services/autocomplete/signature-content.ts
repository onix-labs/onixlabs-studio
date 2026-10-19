import type * as MonacoApi from 'monaco-editor';
import { escapeMarkdown, prepareMarkdown } from '@shared/angular/services/hover/hover-content';

/**
 * A run of a signature's label, flagged whether it is the active parameter.
 */
export interface SignatureRun {
  /**
   * Gets the run's text.
   */
  readonly text: string;

  /**
   * Gets whether the run is the parameter being typed, and is highlighted.
   */
  readonly active: boolean;
}

/**
 * What Studio's signature card shows (#1021).
 */
export interface SignatureView {
  /**
   * Gets the active signature's label in runs, the active parameter's highlighted.
   */
  readonly runs: readonly SignatureRun[];

  /**
   * Gets which overload shows and how many there are, or null when there is only one.
   */
  readonly overload: { readonly index: number; readonly count: number } | null;

  /**
   * Gets the documentation, as markdown sections: the active parameter's, then the signature's.
   */
  readonly sections: readonly string[];
}

/**
 * Builds what the signature card shows of a signature-help answer: the active signature with its
 * active parameter highlighted, which overload it is, and the parameter's and signature's
 * documentation.
 * @param hints The answer.
 * @returns Returns the view, or null when the answer holds no signature.
 */
export function signatureView(hints: MonacoApi.languages.SignatureHelp): SignatureView | null {
  const count: number = hints.signatures.length;
  if (count === 0) {
    return null;
  }
  const index: number = Math.min(Math.max(hints.activeSignature, 0), count - 1);
  const signature: MonacoApi.languages.SignatureInformation = hints.signatures[index];
  const active: number = signature.activeParameter ?? hints.activeParameter;
  const parameter: MonacoApi.languages.ParameterInformation | undefined =
    signature.parameters[active];
  const sections: string[] = [];
  const parameterDocs: string = markdownOf(parameter?.documentation);
  if (parameterDocs.length > 0) {
    sections.push(parameterDocs);
  }
  const signatureDocs: string = markdownOf(signature.documentation);
  if (signatureDocs.length > 0) {
    sections.push(signatureDocs);
  }
  return {
    runs: signatureRuns(
      signature.label,
      parameter === undefined ? null : parameterSpan(signature, parameter),
    ),
    overload: count > 1 ? { index, count } : null,
    sections,
  };
}

/**
 * Finds where a parameter is in its signature's label: at the offsets it gives, or where its label
 * first stands as a whole word after the label's opening parenthesis — so a parameter named like the
 * function it belongs to is found among the parameters, not in the function's name.
 * @param signature The signature.
 * @param parameter The parameter.
 * @returns Returns its start and end in the label, or null when it cannot be found.
 */
export function parameterSpan(
  signature: MonacoApi.languages.SignatureInformation,
  parameter: MonacoApi.languages.ParameterInformation,
): readonly [number, number] | null {
  const label: string | [number, number] = parameter.label;
  if (Array.isArray(label)) {
    const [start, end]: [number, number] = label;
    return start >= 0 && end > start && end <= signature.label.length ? [start, end] : null;
  }
  if (label.length === 0) {
    return null;
  }
  const escaped: string = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern: RegExp = new RegExp(`(?:\\W|^)${escaped}(?=\\W|$)`, 'g');
  // Searched from the opening parenthesis (the character before the first parameter is a non-word
  // character, so a parameter straight after it still matches), or from the start when there is none.
  pattern.lastIndex = Math.max(0, signature.label.indexOf('('));
  const match: RegExpExecArray | null = pattern.exec(signature.label);
  if (match === null) {
    return null;
  }
  const end: number = match.index + match[0].length;
  return [end - label.length, end];
}

/**
 * Splits a signature's label around its active parameter.
 * @param label The label.
 * @param span Where the active parameter is, or null for none.
 * @returns Returns the runs, which together spell the label.
 */
export function signatureRuns(
  label: string,
  span: readonly [number, number] | null,
): SignatureRun[] {
  if (span === null) {
    return [{ text: label, active: false }];
  }
  const [start, end]: readonly [number, number] = span;
  return [
    { text: label.slice(0, start), active: false },
    { text: label.slice(start, end), active: true },
    { text: label.slice(end), active: false },
  ].filter((run: SignatureRun): boolean => run.text.length > 0);
}

/**
 * Reads documentation as markdown: markdown when it is, plain text escaped otherwise.
 * @param documentation The documentation, or undefined.
 * @returns Returns the markdown, trimmed, or an empty string for none.
 */
function markdownOf(documentation: string | MonacoApi.IMarkdownString | undefined): string {
  if (documentation === undefined) {
    return '';
  }
  return (
    typeof documentation === 'string'
      ? escapeMarkdown(documentation)
      : prepareMarkdown(documentation)
  ).trim();
}
