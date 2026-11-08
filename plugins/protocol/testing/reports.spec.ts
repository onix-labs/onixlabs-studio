import { describe, expect, it } from 'vitest';
import { JUnitCase, readJUnit, readTrx, TrxResult } from './reports';
import { parseXml, XmlElement } from './xml';

describe('test report readers (#1351)', () => {
  describe('parseXml', () => {
    it('readsElementsAttributesTextAndCdata_droppingPrefixesAndComments', () => {
      const root: XmlElement | null = parseXml(
        `<?xml version="1.0"?><!-- a comment --><t:a x='1' t:y="&lt;2&gt;"><b>one &amp; two</b><c/><![CDATA[<raw>]]></t:a>`,
      );

      expect(root).toEqual({
        name: 'a',
        attributes: { x: '1', y: '<2>' },
        children: [
          { name: 'b', attributes: {}, children: [], text: 'one & two' },
          { name: 'c', attributes: {}, children: [], text: '' },
        ],
        text: '<raw>',
      });
    });

    it('readsAQuotedGreaterThanInsideAnAttribute', () => {
      expect(parseXml(`<a v="x > y"/>`)?.attributes).toEqual({ v: 'x > y' });
    });

    it.each(['<a><b></a>', '<a>', '<a', 'not xml'])(
      'refusesADocumentThatIsNotWellFormed: %s',
      (source: string) => {
        expect(parseXml(source)).toBeNull();
      },
    );

    it('decodesCharacterReferences', () => {
      expect(parseXml('<a>&#65;&#x42;</a>')?.text).toBe('AB');
    });
  });

  describe('readJUnit', () => {
    it('readsEveryOutcome_fromNestedSuites', () => {
      const cases: readonly JUnitCase[] = readJUnit(`<?xml version="1.0" encoding="utf-8"?>
<testsuites>
  <testsuite name="pytest" tests="4">
    <testcase classname="tests.test_math" name="test_adds" file="tests/test_math.py" line="3" time="0.012"/>
    <testcase classname="tests.test_math" name="test_fails" time="0.5">
      <failure message="assert 1 == 2">def test_fails():
&gt;       assert 1 == 2
E       assert 1 == 2

tests/test_math.py:8: AssertionError</failure>
      <system-out>hello</system-out>
    </testcase>
    <testcase classname="tests.test_math" name="test_skipped"><skipped message="not today"/></testcase>
    <testcase classname="tests.test_math" name="test_errors"><error message="boom"/></testcase>
  </testsuite>
</testsuites>`);

      expect(cases).toEqual([
        {
          suite: 'pytest',
          classname: 'tests.test_math',
          name: 'test_adds',
          file: 'tests/test_math.py',
          line: 3,
          durationMs: 12,
          outcome: 'passed',
        },
        {
          suite: 'pytest',
          classname: 'tests.test_math',
          name: 'test_fails',
          durationMs: 500,
          outcome: 'failed',
          message: 'assert 1 == 2',
          details:
            'def test_fails():\n>       assert 1 == 2\nE       assert 1 == 2\n\ntests/test_math.py:8: AssertionError',
          output: 'hello',
        },
        {
          suite: 'pytest',
          classname: 'tests.test_math',
          name: 'test_skipped',
          outcome: 'skipped',
          message: 'not today',
        },
        {
          suite: 'pytest',
          classname: 'tests.test_math',
          name: 'test_errors',
          outcome: 'errored',
          message: 'boom',
        },
      ]);
    });

    it('readsASingleSuiteAsTheRoot', () => {
      expect(
        readJUnit('<testsuite name="ctest"><testcase name="adds" classname="adds"/></testsuite>'),
      ).toEqual([{ suite: 'ctest', classname: 'adds', name: 'adds', outcome: 'passed' }]);
    });

    it('answersNothingForSomethingThatIsNotAReport', () => {
      expect(readJUnit('{"json": true}')).toEqual([]);
    });
  });

  describe('readTrx', () => {
    it('readsResults_namingEachByItsMethod', () => {
      const results: readonly TrxResult[] = readTrx(`<?xml version="1.0" encoding="utf-8"?>
<TestRun xmlns="http://microsoft.com/schemas/VisualStudio/TeamTest/2010">
  <Results>
    <UnitTestResult testId="1" testName="Shop.Tests.CartTests.Adds" outcome="Passed" duration="00:00:00.0123000"/>
    <UnitTestResult testId="2" testName="Shop.Tests.CartTests.Theory(value: 2)" outcome="Failed" duration="00:00:01.5000000">
      <Output>
        <StdOut>printed</StdOut>
        <ErrorInfo>
          <Message>Assert.Equal() Failure</Message>
          <StackTrace>   at Shop.Tests.CartTests.Theory(Int32 value) in /repo/Shop.Tests/CartTests.cs:line 14</StackTrace>
        </ErrorInfo>
      </Output>
    </UnitTestResult>
    <UnitTestResult testId="3" testName="Ignored" outcome="NotExecuted"/>
  </Results>
  <TestDefinitions>
    <UnitTest id="1" name="Adds"><TestMethod className="Shop.Tests.CartTests, Shop.Tests, Version=1.0.0.0" name="Adds"/></UnitTest>
    <UnitTest id="2" name="Theory"><TestMethod className="Shop.Tests.CartTests" name="Theory"/></UnitTest>
  </TestDefinitions>
</TestRun>`);

      expect(results).toEqual([
        {
          fullName: 'Shop.Tests.CartTests.Adds',
          displayName: 'Shop.Tests.CartTests.Adds',
          outcome: 'passed',
          durationMs: 12,
        },
        {
          fullName: 'Shop.Tests.CartTests.Theory',
          displayName: 'Shop.Tests.CartTests.Theory(value: 2)',
          outcome: 'failed',
          durationMs: 1500,
          message: 'Assert.Equal() Failure',
          stackTrace:
            'at Shop.Tests.CartTests.Theory(Int32 value) in /repo/Shop.Tests/CartTests.cs:line 14',
          output: 'printed',
        },
        { fullName: 'Ignored', displayName: 'Ignored', outcome: 'skipped' },
      ]);
    });
  });
});
