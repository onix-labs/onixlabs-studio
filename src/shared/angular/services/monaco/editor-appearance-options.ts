import type * as MonacoApi from 'monaco-editor';
import type {
  MinimumDiagnosticSeverity,
  TextEditorSettings,
} from '@shared/angular/services/settings/settings';
import { parseRulers } from './parse-rulers';

/**
 * Names the editor class hiding the underlines below each minimum severity; see `_diagnostics.scss`.
 * Monaco draws every marker, and the markers are shared with the Problems panel, so an editor leaves
 * them in place and hides what it should not underline.
 */
const SEVERITY_CLASSES: Readonly<Record<MinimumDiagnosticSeverity, string>> = {
  hint: '',
  info: 'minimum-severity-info',
  warning: 'minimum-severity-warning',
  error: 'minimum-severity-error',
};

/**
 * Builds the Monaco options for how code looks, shared by the options an editor is created with and
 * the ones it re-applies when the settings change, so neither can drift from the other.
 * @param resolved The code settings in force.
 * @returns Returns the options.
 */
export function editorAppearanceOptions(
  resolved: TextEditorSettings,
): MonacoApi.editor.IEditorOptions {
  return {
    renderWhitespace: resolved.renderWhitespace,
    rulers: [...parseRulers(resolved.rulers)],
    guides: {
      indentation: resolved.indentGuides !== 'off',
      highlightActiveIndentation: resolved.indentGuides === 'highlight-active',
      bracketPairs:
        resolved.bracketPairGuides === 'all'
          ? true
          : resolved.bracketPairGuides === 'active'
            ? 'active'
            : false,
    },
    matchBrackets: resolved.matchBrackets ? 'always' : 'never',
    fontLigatures: resolved.fontLigatures,
    cursorStyle: resolved.cursorStyle,
    cursorWidth: resolved.cursorWidth,
    scrollBeyondLastLine: resolved.scrollBeyondLastLine,
    showFoldingControls: resolved.foldingControls === 'always' ? 'always' : 'mouseover',
    colorDecorators: resolved.colourSwatches,
    extraEditorClassName: SEVERITY_CLASSES[resolved.minimumDiagnosticSeverity],
  };
}
