import { ComponentFixture, TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type {
  ReferenceItem,
  ReferenceList,
} from '@shared/angular/services/references/reference-list';
import { EditorReferencesPanel } from './editor-references-panel';
import { headingFor, ReferencesView } from './references-view';

/**
 * Builds a range on one line.
 * @param line The line.
 * @param start The first column.
 * @param end The column after the last.
 * @returns Returns the range.
 */
function span(line: number, start: number, end: number): MonacoApi.IRange {
  return { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end };
}

/**
 * Twelve references to `Foo` across four files, the first file's twice over.
 */
const ITEMS: readonly ReferenceItem[] = [
  { path: '/root/src/foo.ts', range: span(3, 14, 17), preview: 'export class Foo {}' },
  { path: '/root/src/app.ts', range: span(1, 10, 13), preview: 'import { Foo } from "./foo";' },
  { path: '/root/src/app.ts', range: span(8, 15, 18), preview: 'const f = new Foo();' },
  { path: '/root/src/foo.ts', range: span(9, 21, 24), preview: '  public clone(): Foo {' },
  {
    path: '/root/test/foo.spec.ts',
    range: span(2, 10, 13),
    preview: 'import { Foo } from "../src/foo";',
  },
  { path: '/elsewhere/lib.d.ts', range: span(5, 1, 4), preview: 'Foo;' },
  ...Array.from({ length: 6 }, (_unused: unknown, index: number): ReferenceItem => ({
    path: '/root/src/app.ts',
    range: span(20 + index, 1, 4),
    preview: 'Foo.make();',
  })),
];

/**
 * A finished list of references to `Foo`.
 */
const REFERENCES: ReferenceList = {
  kind: 'references',
  symbol: 'Foo',
  status: 'done',
  items: ITEMS,
};

describe('ReferencesView (#1014)', () => {
  let fixture: ComponentFixture<ReferencesView>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ReferencesView] }).compileComponents();
    fixture = TestBed.createComponent(ReferencesView);
    host = fixture.nativeElement as HTMLElement;
  });

  /**
   * Shows a list and waits for it to render.
   * @param list The list.
   * @param root The folder files are named relative to.
   */
  async function show(list: ReferenceList | null, root: string | null = '/root'): Promise<void> {
    fixture.componentRef.setInput('list', list);
    fixture.componentRef.setInput('relativeTo', root);
    await fixture.whenStable();
  }

  /**
   * Reads the heading's text.
   * @returns Returns it.
   */
  function heading(): string {
    return host.querySelector('.references-view__heading')?.textContent ?? '';
  }

  /**
   * Reads the results tree's rows.
   * @returns Returns the rows.
   */
  function rows(): HTMLElement[] {
    return Array.from(host.querySelectorAll<HTMLElement>('.references-view__results .tree-row'));
  }

  it('heading_namesTheSymbolAsCode_withHowManyInHowManyFiles', async () => {
    await show(REFERENCES);

    expect(heading()).toBe('12 references to Foo in 4 files');
    expect(host.querySelector('.references-view__symbol')?.textContent).toBe('Foo');
  });

  it('groupsByFile_inTheOrderFirstFound_namedRelativeToTheRoot_eachRowItsLine', async () => {
    await show(REFERENCES);

    const files: string[] = rows()
      .filter((row: HTMLElement): boolean => row.querySelector('.tree-count') !== null)
      .map((row: HTMLElement): string => row.querySelector('.tree-name')?.textContent ?? '');
    expect(files).toEqual(['src/foo.ts', 'src/app.ts', 'test/foo.spec.ts', '/elsewhere/lib.d.ts']);
    // Four files and twelve references, every file open.
    expect(rows().length).toBe(16);
    const first: HTMLElement = rows()[1];
    expect(first.querySelector('.search-results__line')?.textContent).toBe('3');
    expect(first.querySelector('.search-results__text')?.textContent).toBe('Foo');
    expect(first.querySelector('.search-results__after')?.textContent).toBe(' {}');
  });

  it('choosingARow_reportsItsPlace_andMarksIt', async () => {
    await show(REFERENCES);
    const chosen: ReferenceItem[] = [];
    fixture.componentInstance.chosen.subscribe(
      (item: ReferenceItem): void => void chosen.push(item),
    );

    // foo.ts's row and its two references come first; then app.ts's row, and its first reference.
    rows()[4].click();
    await fixture.whenStable();

    expect(chosen).toEqual([ITEMS[1]]);
    expect(host.querySelector('.references-view__results .tree-row.active')).toBe(rows()[4]);
  });

  it('aNewList_replacesTheLast_withNothingChosen', async () => {
    await show(REFERENCES);
    rows()[1].click();
    await fixture.whenStable();

    await show({ kind: 'references', symbol: 'Bar', status: 'done', items: [ITEMS[1]] });

    expect(heading()).toBe('1 reference to Bar in 1 file');
    expect(rows().length).toBe(2);
    expect(host.querySelector('.references-view__results .tree-row.active')).toBeNull();
  });

  it('emptyStates_sayWhatHappened_inPlainWords', async () => {
    await show(null);
    expect(host.querySelector('.references-view__empty')?.textContent).toContain(
      'Find All References on a symbol',
    );

    await show({ kind: 'references', symbol: 'Foo', status: 'searching', items: [] });
    expect(heading()).toBe('Finding references to Foo…');

    await show({ kind: 'references', symbol: 'Foo', status: 'done', items: [] });
    expect(heading()).toBe('0 references to Foo');
    expect(host.querySelector('.references-view__empty')?.textContent).toContain(
      'No references were found.',
    );

    await show({ kind: 'references', symbol: 'Foo', status: 'unavailable', items: [] });
    expect(host.querySelector('.references-view__empty')?.textContent).toContain(
      'Nothing can find references in this file.',
    );
    expect(rows()).toEqual([]);
  });

  it('heading_forSeveralDefinitions', () => {
    expect(
      headingFor({ kind: 'definitions', symbol: 'Foo', status: 'done', items: ITEMS.slice(0, 3) }),
    ).toEqual({ lead: '3 definitions of ', symbol: 'Foo', tail: ' in 2 files' });
  });
});

describe('EditorReferencesPanel (#1014)', () => {
  it('showsTheList_inAToolPanel_andEscapeAsksToClose', async () => {
    await TestBed.configureTestingModule({ imports: [EditorReferencesPanel] }).compileComponents();
    const fixture: ComponentFixture<EditorReferencesPanel> =
      TestBed.createComponent(EditorReferencesPanel);
    fixture.componentRef.setInput('list', REFERENCES);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    let closed: number = 0;
    fixture.componentInstance.closed.subscribe((): void => void (closed += 1));

    expect(host.querySelector('.tool-panel__title')?.textContent).toBe('References');
    // Outside a workspace, files are named in full.
    expect(host.querySelector('.tree-name')?.textContent).toBe('/root/src/foo.ts');
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closed).toBe(1);
  });
});
