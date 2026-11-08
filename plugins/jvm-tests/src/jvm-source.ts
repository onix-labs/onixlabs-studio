// Finds the test classes and methods one Java or Kotlin source file declares (#1358).
//
// Not a parser: comments, strings, text blocks and character literals are blanked out, and what is left
// is read for annotations, class declarations and the method each test annotation sits on. ⛔ Nothing
// is compiled or run.

/**
 * The annotations that make a method a test: JUnit 5's (Jupiter) test kinds and JUnit 4's `@Test`, by
 * simple or qualified name.
 */
const TEST_ANNOTATIONS: ReadonlySet<string> = new Set<string>([
  'Test',
  'ParameterizedTest',
  'RepeatedTest',
  'TestFactory',
  'TestTemplate',
]);

/**
 * The annotations that switch a test or class off: Jupiter's `@Disabled` and JUnit 4's `@Ignore`.
 */
const DISABLED_ANNOTATIONS: ReadonlySet<string> = new Set<string>(['Disabled', 'Ignore']);

/**
 * Describes a test method.
 */
export interface JvmTestMethod {
  /**
   * Gets the method's name.
   */
  readonly name: string;

  /**
   * Gets its 1-based line.
   */
  readonly line: number;

  /**
   * Gets whether it, or a class it is in, is switched off.
   */
  readonly disabled: boolean;
}

/**
 * Describes a class and the tests it holds.
 */
export interface JvmTestClass {
  /**
   * Gets its binary name within the package: `Outer` or `Outer$Inner`, as the reports name it.
   */
  readonly binaryName: string;

  /**
   * Gets its simple name.
   */
  readonly simpleName: string;

  /**
   * Gets its 1-based line.
   */
  readonly line: number;

  /**
   * Gets its tests.
   */
  readonly tests: JvmTestMethod[];

  /**
   * Gets the binary name of the class it is nested in, or undefined for a top-level class.
   */
  readonly outer?: string;
}

/**
 * Describes what one file declares.
 */
export interface JvmFileScan {
  /**
   * Gets its package, empty for the default package.
   */
  readonly packageName: string;

  /**
   * Gets every class in it, outer ones first.
   */
  readonly classes: readonly JvmTestClass[];
}

/**
 * Blanks out comments and literals, keeping every newline and offset.
 * @param text The source.
 * @returns Returns the source with those spans replaced by spaces.
 */
export function blankJvmLiterals(text: string): string {
  return text.replace(
    /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"""[\s\S]*?"""|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])+'/g,
    (span: string): string => span.replace(/[^\n]/g, ' '),
  );
}

/**
 * Reads an annotation's simple name: `org.junit.jupiter.api.Test` is `Test`.
 * @param name The name as written.
 * @returns Returns the simple name.
 */
function simpleName(name: string): string {
  return name.slice(name.lastIndexOf('.') + 1);
}

/**
 * Scans a file for its test classes and methods.
 * @param text The file's text.
 * @returns Returns what it declares.
 */
export function scanJvmFile(text: string): JvmFileScan {
  const code: string = blankJvmLiterals(text);
  const starts: number[] = [0];
  for (let index: number = 0; index < code.length; index += 1) {
    if (code.charCodeAt(index) === 10) {
      starts.push(index + 1);
    }
  }
  const lineOf: (offset: number) => number = (offset: number): number => {
    let low: number = 0;
    let high: number = starts.length - 1;
    while (low < high) {
      const middle: number = (low + high + 1) >> 1;
      if (starts[middle] <= offset) {
        low = middle;
      } else {
        high = middle - 1;
      }
    }
    return low + 1;
  };
  const packageName: string = /^\s*package\s+([\w.]+)/m.exec(code)?.[1] ?? '';
  const classes: JvmTestClass[] = [];
  const open: { readonly cls: JvmTestClass; readonly depth: number; readonly disabled: boolean }[] =
    [];
  let depth: number = 0;
  let annotations: string[] = [];
  let declared: { readonly cls: JvmTestClass; readonly disabled: boolean } | null = null;
  const token: RegExp =
    /@\s*([A-Za-z_][\w.]*)|\b(?:class|interface|object)\s+([A-Za-z_]\w*)|\bfun\s+(?:<[^>]*>\s*)?(`[^`\n]+`|[A-Za-z_]\w*)\s*\(|([A-Za-z_]\w*)\s*\(|[{};]/g;
  let match: RegExpExecArray | null = token.exec(code);
  while (match !== null) {
    if (match[1] !== undefined) {
      annotations.push(simpleName(match[1]));
      // An annotation's arguments are part of it, not a method call.
      const after: RegExpExecArray | null = /^\s*\(/.exec(code.slice(token.lastIndex));
      if (after !== null) {
        let cursor: number = token.lastIndex + after[0].length;
        let parens: number = 1;
        while (cursor < code.length && parens > 0) {
          parens += code[cursor] === '(' ? 1 : code[cursor] === ')' ? -1 : 0;
          cursor += 1;
        }
        token.lastIndex = cursor;
      }
    } else if (match[2] !== undefined) {
      const outer: (typeof open)[number] | undefined = open[open.length - 1];
      const cls: JvmTestClass = {
        binaryName: outer === undefined ? match[2] : `${outer.cls.binaryName}$${match[2]}`,
        simpleName: match[2],
        line: lineOf(match.index),
        tests: [],
        ...(outer === undefined ? {} : { outer: outer.cls.binaryName }),
      };
      declared = {
        cls,
        disabled:
          annotations.some((name: string): boolean => DISABLED_ANNOTATIONS.has(name)) ||
          outer?.disabled === true,
      };
      annotations = [];
    } else if (match[3] !== undefined || match[4] !== undefined) {
      const name: string = (match[3] ?? match[4]).replace(/^`|`$/g, '');
      const owner: (typeof open)[number] | undefined = open[open.length - 1];
      if (
        owner !== undefined &&
        annotations.some((annotation: string): boolean => TEST_ANNOTATIONS.has(annotation))
      ) {
        owner.cls.tests.push({
          name,
          line: lineOf(match.index),
          disabled:
            owner.disabled ||
            annotations.some((annotation: string): boolean => DISABLED_ANNOTATIONS.has(annotation)),
        });
        annotations = [];
      } else if (match[3] !== undefined) {
        annotations = [];
      }
      // A Java method's name comes before its `(`; a return type or modifier before it is not a
      // call, so annotations are kept until the method is found or a body or statement starts.
    } else if (match[0] === '{') {
      depth += 1;
      if (declared !== null) {
        classes.push(declared.cls);
        open.push({ cls: declared.cls, depth, disabled: declared.disabled });
        declared = null;
      }
      annotations = [];
    } else if (match[0] === '}') {
      if (open.length > 0 && open[open.length - 1].depth === depth) {
        open.pop();
      }
      depth -= 1;
      annotations = [];
    } else {
      annotations = [];
      declared = null;
    }
    match = token.exec(code);
  }
  return { packageName, classes };
}
