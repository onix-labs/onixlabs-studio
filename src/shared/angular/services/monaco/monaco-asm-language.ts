import type * as MonacoApi from 'monaco-editor';

/**
 * Specifies the Monaco language identifier for disassembled machine code.
 */
export const ASM_LANGUAGE_ID: string = 'asm';

/**
 * A Monarch grammar for generic assembly listings of the form `<address>  <mnemonic> <operands>`. It
 * is deliberately architecture-agnostic: the leading address reads as muted metadata, mnemonics and
 * directives as keywords, common registers as predefined variables, and immediates as numbers, so a
 * disassembly of any supported architecture is legible. Token names are the standard Monaco ones, so
 * the application's `vs`/`vs-dark`-based themes colour them without any theme changes.
 */
const ASM_GRAMMAR: MonacoApi.languages.IMonarchLanguage = {
  ignoreCase: true,
  defaultToken: '',
  tokenizer: {
    root: [
      // A line comment (some architectures use ; or #).
      [/[;#].*$/, 'comment'],
      // The leading address is metadata, not code; render it muted.
      [/^[0-9A-Fa-f]+\b/, 'comment'],
      // Immediates.
      [/\b0x[0-9A-Fa-f]+\b/, 'number.hex'],
      [/\b\d+\b/, 'number'],
      // Common registers across x86/x64/ARM/ARM64.
      [
        /%?\b(?:[re]?[abcd]x|[abcd][lh]|[re]?[sd]i|[re]?[bs]p|[re]?ip|r\d+[dwb]?|[xyz]mm\d+|[cdefgs]s|[re]flags|pc|sp|lr|fp|[wx]\d+|v\d+)\b/,
        'variable.predefined',
      ],
      // Assembler directives such as `.byte`.
      [/\.[A-Za-z][\w]*/, 'keyword'],
      // Mnemonics and remaining identifiers (labels, operand symbols).
      [/\b[A-Za-z_][\w.]*\b/, 'keyword'],
      // Operand punctuation.
      [/[,+\-*/:()[\]{}]/, 'delimiter'],
    ],
  },
};

/**
 * Registers the `asm` language and its Monarch grammar with Monaco, so the disassembly editor renders
 * syntax-highlighted assembly. Idempotent and a no-op when Monaco has not loaded.
 * @param monaco The loaded Monaco namespace, or undefined when it has not loaded yet.
 */
export function registerAsmLanguage(monaco: typeof MonacoApi | undefined): void {
  if (monaco === undefined) {
    return;
  }
  const registered: boolean = monaco.languages
    .getLanguages()
    .some(
      (language: MonacoApi.languages.ILanguageExtensionPoint): boolean =>
        language.id === ASM_LANGUAGE_ID,
    );
  if (registered) {
    return;
  }
  monaco.languages.register({ id: ASM_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(ASM_LANGUAGE_ID, ASM_GRAMMAR);
}
