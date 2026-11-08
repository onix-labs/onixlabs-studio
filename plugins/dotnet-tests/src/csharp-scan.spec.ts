import { describe, expect, it } from 'vitest';
import { attributeNames, blankCommentsAndStrings, scanCSharp, ScannedTest } from './csharp-scan';

/**
 * The attributes every scan here looks for.
 */
const ATTRIBUTES: ReadonlySet<string> = new Set<string>([
  'Fact',
  'Theory',
  'Test',
  'TestCase',
  'TestMethod',
  'DataTestMethod',
]);

/**
 * Reads the scan's answer as `Class.Method:line`.
 * @param source The source.
 * @returns Returns one line per test.
 */
function names(source: string): readonly string[] {
  return scanCSharp(source, ATTRIBUTES).map(
    (test: ScannedTest): string => `${test.className}.${test.method}:${test.line}`,
  );
}

describe('C# test scan (#1353)', () => {
  it('blankCommentsAndStrings_keepsLinesAndBlanksEveryLiteralKind', () => {
    const source: string =
      '// [Fact]\nvar a = "[Fact]"; /* [Test]\n */ var b = @"x""[Test]"; var c = """[Fact]"""; var d = \'[\';\nvar e = $"{x}[Fact]";';

    const code: string = blankCommentsAndStrings(source);

    expect(code.split('\n').length).toBe(source.split('\n').length);
    expect(code).not.toMatch(/Fact|Test|\[/);
    expect(code).toContain('var a =');
  });

  it.each<[string, readonly string[]]>([
    ['Fact', ['Fact']],
    ['Test, Ignore("x")', ['Test', 'Ignore']],
    ['InlineData(1, 2)', ['InlineData']],
    ['Xunit.FactAttribute', ['Fact']],
    ['method: Fact', ['Fact']],
    ['MemberData(nameof(Cases), Max = 3)', ['MemberData']],
  ])('attributeNames reads [%s]', (list: string, expected: readonly string[]) => {
    expect(attributeNames(list)).toEqual(expected);
  });

  it('scanCSharp_readsAFileScopedNamespace', () => {
    expect(
      names(`using Xunit;

namespace Shop.Tests;

public class CartTests
{
    [Fact]
    public void Adds() => Assert.True(true);

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    public async Task AddsMany(int count) { await Task.Yield(); }

    public void Helper() { }
}
`),
    ).toEqual(['Shop.Tests.CartTests.Adds:8', 'Shop.Tests.CartTests.AddsMany:13']);
  });

  it('scanCSharp_readsBlockNamespacesNestedTypesAndStackedAttributes', () => {
    expect(
      names(`namespace Outer
{
    namespace Inner
    {
        [TestFixture]
        public class Fixture
        {
            [Test, Category("slow")]
            public void One() { if (true) { Assert.Pass(); } }

            public class Nested
            {
                [TestCase(1, 2)]
                [TestCase(3, 4)]
                public void Two(int a, int b) { }
            }

            [Test]
            public void Three() { }
        }
    }
}
`),
    ).toEqual([
      'Outer.Inner.Fixture.One:9',
      'Outer.Inner.Fixture+Nested.Two:15',
      'Outer.Inner.Fixture.Three:19',
    ]);
  });

  it('scanCSharp_readsMSTestAndIgnoresWhatIsNotATest', () => {
    expect(
      names(`namespace M;

[TestClass]
public sealed class Tests
{
    // [TestMethod] public void Commented() { }
    private const string Text = "[TestMethod] public void InAString()";

    [TestInitialize]
    public void Setup() { }

    [TestMethod]
    [Ignore("later")]
    public void Skipped() { }

    [DataTestMethod]
    [DataRow(1)]
    public void Data(int x) { }
}

public record Positional(int Value);

public interface IShape
{
    [TestMethod]
    void NotInAClass();
}
`),
    ).toEqual(['M.Tests.Skipped:14', 'M.Tests.Data:18']);
  });

  it('scanCSharp_aClassWithoutANamespace_isNamedByItself', () => {
    expect(names('public class Bare { [Fact] public void Works() { } }')).toEqual(['Bare.Works:1']);
  });

  it('scanCSharp_genericMethodsAreFound', () => {
    expect(names('namespace G; class T { [Fact] public void Of<TItem>() { } }')).toEqual([
      'G.T.Of:1',
    ]);
  });
});
