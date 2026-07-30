import { readFileSync } from 'node:fs';
import { describe, expect, it, Mock, vi } from 'vitest';
import { ICON_FONT_FAMILIES, warmIconFonts } from './icon-fonts';

/**
 * Builds a document stand-in carrying a font set that records what was asked for.
 * @param load The load implementation, defaulting to one that resolves.
 * @returns Returns the stand-in document and the recorded load requests.
 */
function fakeDocument(load?: (font: string) => Promise<unknown>): {
  document: Document;
  requests: string[];
} {
  const requests: string[] = [];
  const fonts: Partial<FontFaceSet> = {
    load: (font: string): Promise<FontFace[]> => {
      requests.push(font);
      return (load?.(font) ?? Promise.resolve([])) as Promise<FontFace[]>;
    },
  };
  return { document: { fonts } as Document, requests };
}

/**
 * Reads the Phosphor font families the build actually registers: every `@phosphor-icons/web`
 * stylesheet in `angular.json`'s `styles` array, resolved to the `font-family` each one declares.
 *
 * Derived rather than restated, so the assertion cannot drift into agreeing with a stale copy of the
 * mapping it is supposed to be checking.
 * @returns Returns the registered families.
 */
function registeredFamilies(): string[] {
  const angular: { projects: Record<string, unknown> } = JSON.parse(
    readFileSync('angular.json', 'utf8'),
  ) as { projects: Record<string, unknown> };
  const project: unknown = Object.values(angular.projects)[0];
  const styles: string[] = (project as { architect: { build: { options: { styles: string[] } } } })
    .architect.build.options.styles;

  return styles
    .filter((style: string): boolean => style.includes('@phosphor-icons/web'))
    .map((style: string): string => {
      const css: string = readFileSync(style, 'utf8');
      const family: RegExpExecArray | null = /font-family:\s*"([^"]+)"/.exec(css);
      if (family === null) {
        throw new Error(`No font-family declared in ${style}`);
      }
      return family[1];
    });
}

describe('icon fonts', () => {
  it('warmIconFonts_requestsEveryRegisteredWeightUpFront', () => {
    // The whole point: the weights are fetched at startup rather than when a glyph is first painted,
    // which for the main window is not until its first tab opens.
    const { document, requests } = fakeDocument();

    warmIconFonts(document);

    expect(requests).toEqual(
      ICON_FONT_FAMILIES.map((family: string): string => `1rem "${family}"`),
    );
  });

  it('families_areExactlyTheWeightsTheBuildRegisters', () => {
    // A weight added to angular.json but not here goes back to being fetched lazily — silently, and
    // only noticed as a blank view seconds into a cold start.
    expect([...ICON_FONT_FAMILIES].sort()).toEqual(registeredFamilies().sort());
  });

  it('theRendererEntryPoint_warmsTheFontsBeforeItBootstraps', () => {
    // Asserted against the source text because `main.ts` bootstraps the application on import, so a
    // spec cannot run it. Crude, but it guards the thing that actually matters: a warm-up nothing
    // calls is a warm-up that silently does nothing, and the symptom — a blank first tab seconds
    // into a cold start — looks nothing like a missing function call.
    const main: string = readFileSync('src/shared/app/main.ts', 'utf8');
    const call: number = main.indexOf('warmIconFonts()');
    const bootstrap: number = main.indexOf('bootstrapApplication(');

    expect(main).toContain("from './icon-fonts'");
    expect(call).toBeGreaterThan(-1);
    // Ordering is the point: the downloads have to overlap bootstrap, not follow it.
    expect(call).toBeLessThan(bootstrap);
  });

  it('warmIconFonts_whenTheEnvironmentOffersNoFontSet_doesNothing', () => {
    // The warm-up is a courtesy; it must never be the reason the application fails to start.
    expect((): void => warmIconFonts({} as Document)).not.toThrow();
  });

  it('warmIconFonts_whenAFaceFailsToLoad_swallowsTheRejection', async () => {
    const unhandled: Mock = vi.fn();
    process.on('unhandledRejection', unhandled);
    const { document } = fakeDocument((): Promise<never> => Promise.reject(new Error('offline')));

    warmIconFonts(document);
    // Let the rejection settle and any unhandled-rejection report fire.
    await new Promise((resolve): void => void setTimeout(resolve, 0));
    process.off('unhandledRejection', unhandled);

    expect(unhandled).not.toHaveBeenCalled();
  });
});
