import { describe, expect, it } from 'vitest';
import { Declaration, scanDeclarations } from './scan';

/**
 * Reduces declarations to `kind name:line`, nested, for readable expectations.
 * @param declarations The declarations.
 * @returns Returns the outline.
 */
function outline(declarations: readonly Declaration[]): unknown[] {
  return declarations.map((declaration: Declaration): unknown =>
    declaration.children.length > 0
      ? {
          [`${declaration.kind} ${declaration.name}:${declaration.line}`]: outline(
            declaration.children,
          ),
        }
      : `${declaration.kind} ${declaration.name}:${declaration.line}${declaration.table ? ' (table)' : ''}`,
  );
}

describe('scanDeclarations (#1354)', () => {
  it('nestsSuitesAndTestsWithTheirLines', () => {
    const source: string = `import { describe, it, test } from 'vitest';

describe('math', () => {
  it('adds', () => {});
  it.skip("skips", () => {});
  describe.only(\`nested\`, () => {
    test.concurrent('deep', async () => {});
  });
});

test('top', () => {});
`;

    expect(outline(scanDeclarations(source))).toEqual([
      {
        'suite math:3': ['test adds:4', 'test skips:5', { 'suite nested:6': ['test deep:7'] }],
      },
      'test top:11',
    ]);
  });

  it('readsPlaywrightsDescribeAndIgnoresItsHooksAndSteps', () => {
    const source: string = `import { test } from '@playwright/test';
test.describe('checkout', () => {
  test.beforeEach(async () => {});
  test('pays', async () => {
    await test.step('adds card', async () => {});
  });
  test.describe.serial('later', () => {
    test.fixme('refunds', () => {});
  });
});
`;

    expect(outline(scanDeclarations(source))).toEqual([
      { 'suite checkout:2': ['test pays:4', { 'suite later:7': ['test refunds:8'] }] },
    ]);
  });

  it('skipsWhatIsNotADeclaration', () => {
    const source: string = `// it('in a comment', () => {});
/* test('in a block comment') */
const s = "it('in a string')";
const r = /test\\('in a regex'\\)/;
const t = \`describe('in a template')\`;
obj.it('a method', () => {});
it(name, () => {});
it(\`template \${name}\`, () => {});
expect(it).toBeDefined();
`;

    expect(scanDeclarations(source)).toEqual([]);
  });

  it('marksTableDrivenTests_whoseCasesARunNames', () => {
    const source: string = `it.each([1, 2])('handles %i', (n) => {});
describe.each\`a | b\`('table $a', () => {
  it('inside', () => {});
});
test.skipIf(process.env.CI)('local only', () => {});
`;

    expect(outline(scanDeclarations(source))).toEqual([
      'test handles %i:1 (table)',
      { 'suite table $a:2': ['test inside:3'] },
      'test local only:5',
    ]);
  });

  it('keepsGoingPastBracesInStringsAndTemplates', () => {
    const source: string = `describe('a', () => {
  const x = '}';
  const y = \`\${{ z: '}' }.z}\`;
  it('still inside', () => {});
});
it('outside', () => {});
`;

    expect(outline(scanDeclarations(source))).toEqual([
      { 'suite a:1': ['test still inside:4'] },
      'test outside:6',
    ]);
  });
});
