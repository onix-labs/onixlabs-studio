// Ambient declaration for the `@defasm/core` package, which ships no type declarations. This declares
// the small slice of the DefAssembler API the assembler uses (see binary-assembler.ts); keep it in
// step with the package if the usage grows.

declare module '@defasm/core' {
  /**
   * One assembler diagnostic.
   */
  export interface ASMError {
    /**
     * Gets the human-readable error message.
     */
    readonly message: string;
  }

  /**
   * A statement list holding the assembled instructions.
   */
  export interface StatementList {
    /**
     * Returns all the assembled bytes of the instructions in the list.
     */
    dump(): Uint8Array;
  }

  /**
   * The parsing syntax configuration.
   */
  export interface AssemblySyntax {
    /**
     * Gets whether Intel syntax is used (AT&T when false).
     */
    readonly intel: boolean;

    /**
     * Gets whether registers/immediates take the AT&T `%`/`$` prefix.
     */
    readonly prefix: boolean;
  }

  /**
   * The assembler configuration.
   */
  export interface AssemblyConfig {
    /**
     * Gets the parsing syntax.
     */
    readonly syntax?: AssemblySyntax;

    /**
     * Gets the target bitness (16, 32, or 64).
     */
    readonly bitness?: number;

    /**
     * Gets whether the `.text` section is writable.
     */
    readonly writableText?: boolean;
  }

  /**
   * The incremental x86-64 assembler state.
   */
  export class AssemblyState {
    public constructor(config?: AssemblyConfig);

    /**
     * Gets the diagnostics produced by the last compile.
     */
    public readonly errors: ASMError[];

    /**
     * Gets the statement list of all assembled instructions.
     */
    public readonly head: StatementList;

    /**
     * Assembles a string of source code, replacing the previous state.
     * @param source The assembly source.
     * @param config The optional compile configuration (unused here).
     */
    public compile(source: string, config?: unknown): void;
  }
}
