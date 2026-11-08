// Readers for the report formats test tools write (#1351): JUnit XML — written by pytest, Vitest, Jest,
// Playwright, CTest, Gradle and Maven Surefire — and Visual Studio's TRX, written by `dotnet test`.
// Each reader answers what the report says and nothing else; mapping a case onto a node of the tree is
// the adapter's, because only it knows how its ecosystem names tests.
import { child, descendants, parseXml, XmlElement } from './xml';
import type { TestOutcome } from './protocol';

/**
 * Describes one test case a JUnit report records.
 */
export interface JUnitCase {
  /**
   * Gets the name of the suite it sits in.
   */
  readonly suite: string;

  /**
   * Gets its `classname`, which tools fill differently: a class, a module, a file.
   */
  readonly classname: string;

  /**
   * Gets its name.
   */
  readonly name: string;

  /**
   * Gets the file it names, when the tool writes one.
   */
  readonly file?: string;

  /**
   * Gets the line it names, when the tool writes one.
   */
  readonly line?: number;

  /**
   * Gets how long it took, in milliseconds.
   */
  readonly durationMs?: number;

  /**
   * Gets how it came out.
   */
  readonly outcome: TestOutcome;

  /**
   * Gets the failure's or skip's message.
   */
  readonly message?: string;

  /**
   * Gets the failure's body, usually the stack.
   */
  readonly details?: string;

  /**
   * Gets what it wrote to stdout and stderr.
   */
  readonly output?: string;
}

/**
 * Reads a number of seconds as milliseconds.
 * @param value The attribute.
 * @returns Returns the milliseconds, or undefined when it is not a number.
 */
function seconds(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed: number = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 1000) : undefined;
}

/**
 * Joins the text of the named children.
 * @param element The element.
 * @param names The children's names.
 * @returns Returns the text, or undefined when there is none.
 */
function joinedText(element: XmlElement, names: readonly string[]): string | undefined {
  const text: string = element.children
    .filter((candidate: XmlElement): boolean => names.includes(candidate.name))
    .map((candidate: XmlElement): string => candidate.text.trim())
    .filter((part: string): boolean => part.length > 0)
    .join('\n');
  return text.length > 0 ? text : undefined;
}

/**
 * Reads a JUnit XML report.
 * @param source The report's text.
 * @returns Returns its test cases, in document order; empty when it is not a report.
 */
export function readJUnit(source: string): readonly JUnitCase[] {
  const root: XmlElement | null = parseXml(source);
  if (root === null) {
    return [];
  }
  const suites: readonly XmlElement[] =
    root.name === 'testsuite'
      ? [root, ...descendants(root, 'testsuite')]
      : descendants(root, 'testsuite');
  const cases: JUnitCase[] = [];
  for (const suite of suites) {
    for (const testcase of suite.children.filter(
      (node: XmlElement): boolean => node.name === 'testcase',
    )) {
      const failure: XmlElement | undefined = child(testcase, 'failure');
      const error: XmlElement | undefined = child(testcase, 'error');
      const skipped: XmlElement | undefined = child(testcase, 'skipped');
      const problem: XmlElement | undefined = failure ?? error ?? skipped;
      const outcome: TestOutcome =
        failure !== undefined
          ? 'failed'
          : error !== undefined
            ? 'errored'
            : skipped !== undefined
              ? 'skipped'
              : 'passed';
      const line: number = Number(testcase.attributes['line']);
      const message: string | undefined = problem?.attributes['message'];
      const details: string = problem?.text.trim() ?? '';
      const output: string | undefined = joinedText(testcase, ['system-out', 'system-err']);
      const duration: number | undefined = seconds(testcase.attributes['time']);
      cases.push({
        suite: suite.attributes['name'] ?? '',
        classname: testcase.attributes['classname'] ?? '',
        name: testcase.attributes['name'] ?? '',
        ...(testcase.attributes['file'] === undefined ? {} : { file: testcase.attributes['file'] }),
        ...(Number.isInteger(line) && line > 0 ? { line } : {}),
        ...(duration === undefined ? {} : { durationMs: duration }),
        outcome,
        ...(message === undefined || message.length === 0 ? {} : { message }),
        ...(details.length === 0 ? {} : { details }),
        ...(output === undefined ? {} : { output }),
      });
    }
  }
  return cases;
}

/**
 * Describes one test result a TRX report records.
 */
export interface TrxResult {
  /**
   * Gets the fully qualified name of the test method, `Namespace.Class.Method`, without arguments.
   */
  readonly fullName: string;

  /**
   * Gets the name the run displayed, which for a data-driven case carries its arguments.
   */
  readonly displayName: string;

  /**
   * Gets how it came out.
   */
  readonly outcome: TestOutcome;

  /**
   * Gets how long it took, in milliseconds.
   */
  readonly durationMs?: number;

  /**
   * Gets the failure's or skip's message.
   */
  readonly message?: string;

  /**
   * Gets the failure's stack trace.
   */
  readonly stackTrace?: string;

  /**
   * Gets what it wrote.
   */
  readonly output?: string;
}

/**
 * Reads a TRX duration, `hh:mm:ss.fffffff`, as milliseconds.
 * @param value The attribute.
 * @returns Returns the milliseconds, or undefined when it is not a duration.
 */
function trxDuration(value: string | undefined): number | undefined {
  const match: RegExpExecArray | null = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(value ?? '');
  if (match === null) {
    return undefined;
  }
  return Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
}

/**
 * Maps a TRX outcome onto the protocol's.
 * @param outcome The TRX outcome.
 * @returns Returns the protocol's outcome.
 */
function trxOutcome(outcome: string | undefined): TestOutcome {
  switch ((outcome ?? '').toLowerCase()) {
    case 'passed':
      return 'passed';
    case 'failed':
      return 'failed';
    case 'notexecuted':
    case 'inconclusive':
    case 'skipped':
      return 'skipped';
    default:
      return 'errored';
  }
}

/**
 * Reads a TRX report.
 * @param source The report's text.
 * @returns Returns its results, in document order; empty when it is not a report.
 */
export function readTrx(source: string): readonly TrxResult[] {
  const root: XmlElement | null = parseXml(source);
  if (root === null) {
    return [];
  }
  const methods: Map<string, string> = new Map<string, string>();
  for (const unitTest of descendants(root, 'UnitTest')) {
    const method: XmlElement | undefined = child(unitTest, 'TestMethod');
    const className: string = (method?.attributes['className'] ?? '').split(',')[0].trim();
    const name: string = method?.attributes['name'] ?? '';
    if (unitTest.attributes['id'] !== undefined && name.length > 0) {
      methods.set(unitTest.attributes['id'], className.length > 0 ? `${className}.${name}` : name);
    }
  }
  return descendants(root, 'UnitTestResult').map((result: XmlElement): TrxResult => {
    const output: XmlElement | undefined = child(result, 'Output');
    const errorInfo: XmlElement | undefined =
      output === undefined ? undefined : child(output, 'ErrorInfo');
    const message: string | undefined =
      errorInfo === undefined ? undefined : child(errorInfo, 'Message')?.text.trim();
    const stackTrace: string | undefined =
      errorInfo === undefined ? undefined : child(errorInfo, 'StackTrace')?.text.trim();
    const stdout: string | undefined =
      output === undefined ? undefined : joinedText(output, ['StdOut', 'StdErr']);
    const displayName: string = result.attributes['testName'] ?? '';
    const duration: number | undefined = trxDuration(result.attributes['duration']);
    return {
      fullName: methods.get(result.attributes['testId'] ?? '') ?? displayName.replace(/\(.*$/, ''),
      displayName,
      outcome: trxOutcome(result.attributes['outcome']),
      ...(duration === undefined ? {} : { durationMs: duration }),
      ...(message === undefined || message.length === 0 ? {} : { message }),
      ...(stackTrace === undefined || stackTrace.length === 0 ? {} : { stackTrace }),
      ...(stdout === undefined ? {} : { output: stdout }),
    };
  });
}
