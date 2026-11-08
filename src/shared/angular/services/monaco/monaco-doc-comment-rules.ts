import type * as MonacoApi from 'monaco-editor';

/**
 * Builds the Enter rules that continue a Rust doc comment (#1210): Enter at the end of a `///` line
 * starts the next with `/// `, and the same for a module's `//! `. A plain `//` comment is not
 * continued, nor `////`, which Rust reads as a plain comment.
 *
 * rust-analyzer offers this as a request of its own (`experimental/onEnter`), answering a snippet edit
 * for each Enter. Monaco does the same from a rule, with no round trip on a keystroke, and the rules
 * are those the rust-analyzer extension for VS Code declares for the same purpose.
 * @param monaco The Monaco instance, for its indent actions.
 * @returns Returns the rules.
 */
export function rustDocCommentRules(monaco: typeof MonacoApi): MonacoApi.languages.OnEnterRule[] {
  return [
    {
      beforeText: /^\s*\/{3}(?!\/).*$/,
      action: { indentAction: monaco.languages.IndentAction.None, appendText: '/// ' },
    },
    {
      beforeText: /^\s*\/\/!.*$/,
      action: { indentAction: monaco.languages.IndentAction.None, appendText: '//! ' },
    },
  ];
}

/**
 * Teaches a Monaco instance to continue Rust doc comments on Enter (#1210). Monaco merges this with
 * the configuration its own Rust language registers, field by field, and that configuration has no
 * Enter rules, so nothing of its own is replaced.
 * @param monaco The Monaco instance.
 */
export function registerDocCommentRules(monaco: typeof MonacoApi | undefined): void {
  monaco?.languages.setLanguageConfiguration('rust', { onEnterRules: rustDocCommentRules(monaco) });
}
