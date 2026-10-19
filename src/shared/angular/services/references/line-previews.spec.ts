import { TestBed } from '@angular/core/testing';
import type * as MonacoApi from 'monaco-editor';
import type { FileInfo } from '@shared/api/file-channels';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { LinePreviews, MAX_PREVIEW_FILES, MAX_PREVIEW_LENGTH } from './line-previews';
import { CodeLocation, ReferenceItem } from './reference-list';

/**
 * Builds a place on the first line of a file.
 * @param path The file.
 * @returns Returns the place.
 */
function at(path: string): CodeLocation {
  return { path, range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 } };
}

describe('LinePreviews (#1014)', () => {
  let reads: string[];

  beforeEach(() => {
    reads = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: FileSystem,
          useValue: {
            read: (path: string): Promise<FileInfo | null> => {
              reads.push(path);
              return Promise.resolve(
                path.endsWith('missing.ts')
                  ? null
                  : ({ path, content: `line of ${path}\nsecond` } as FileInfo),
              );
            },
          },
        },
      ],
    });
  });

  it('readsOnlyTheFirstFilesNotOpen_andListsTheRestWithoutTheirLine', async () => {
    const paths: string[] = Array.from(
      { length: MAX_PREVIEW_FILES + 5 },
      (_unused: unknown, index: number): string => `/root/f${index}.ts`,
    );

    const items: readonly ReferenceItem[] = await TestBed.inject(LinePreviews).fill(
      paths.map(at),
      undefined,
    );

    expect(reads.length).toBe(MAX_PREVIEW_FILES);
    expect(items.length).toBe(paths.length);
    expect(items[0].preview).toBe('line of /root/f0.ts');
    expect(items.at(-1)?.preview).toBe('');
  });

  it('aFileThatCannotBeRead_isListedWithAnEmptyLine', async () => {
    const items: readonly ReferenceItem[] = await TestBed.inject(LinePreviews).fill(
      [at('/root/missing.ts')],
      undefined,
    );

    expect(items).toEqual([{ ...at('/root/missing.ts'), preview: '' }]);
  });

  it('aDocumentWithNoFile_isReadFromItsModel_andALongLineIsCut', async () => {
    const long: string = 'x'.repeat(MAX_PREVIEW_LENGTH + 40);
    const model: unknown = {
      uri: { toString: (): string => 'inmemory://model/9' },
      isDisposed: (): boolean => false,
      getLinesContent: (): string[] => [long],
    };
    const monaco: typeof MonacoApi = {
      editor: { getModels: (): unknown[] => [model] },
    } as unknown as typeof MonacoApi;

    const items: readonly ReferenceItem[] = await TestBed.inject(LinePreviews).fill(
      [at('inmemory://model/9')],
      monaco,
    );

    expect(reads).toEqual([]);
    expect(items[0].preview.length).toBe(MAX_PREVIEW_LENGTH);
  });
});
