import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApiEnvironment, ApiHistoryEntry } from '@shared/api/api-client-types';
import { ApiWorkspace } from '../api-workspace/api-workspace';
import { ApiExplorerStatus } from './api-explorer-status';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<ApiExplorerStatus>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('ApiExplorerStatus (#882)', () => {
  let fixture: ComponentFixture<ApiExplorerStatus>;
  let filePath: WritableSignal<string | null>;
  let dirty: WritableSignal<boolean>;
  let history: WritableSignal<readonly ApiHistoryEntry[]>;
  let inFlight: WritableSignal<ReadonlySet<string>>;

  beforeEach(() => {
    filePath = signal<string | null>('/apis/github.api.json');
    dirty = signal<boolean>(false);
    history = signal<readonly ApiHistoryEntry[]>([]);
    inFlight = signal<ReadonlySet<string>>(new Set<string>());
    TestBed.configureTestingModule({
      providers: [
        {
          provide: ApiWorkspace,
          useValue: {
            filePath,
            dirty,
            history,
            inFlight,
            activeEnvironment: signal<ApiEnvironment | null>({
              id: 'env',
              name: 'Localhost',
              variables: [],
            }),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(ApiExplorerStatus);
  });

  it('namesTheDocumentsPath_markedWhileUnsaved_orNewDocument', () => {
    fixture.detectChanges();
    expect(segmentsOf(fixture, 0)).toEqual(['/apis/github.api.json']);

    dirty.set(true);
    fixture.detectChanges();
    expect(segmentsOf(fixture, 0)).toEqual(['/apis/github.api.json ●']);

    filePath.set(null);
    dirty.set(false);
    fixture.detectChanges();
    expect(segmentsOf(fixture, 0)).toEqual(['New Document']);
  });

  it('showsOnlyTheEnvironment_beforeAnythingIsSent', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual(['Localhost']);
  });

  it('leadsWithWhatIsInFlight_thenTheLastSendWithItsMethod', () => {
    inFlight.set(new Set<string>(['a', 'b']));
    history.set([
      {
        id: 'h1',
        requestId: 'r1',
        name: 'List users',
        method: 'GET',
        url: 'https://api.test/users',
        at: 0,
        outcome: { kind: 'response', status: 200, timings: { totalMs: 141.6 } },
      } as unknown as ApiHistoryEntry,
    ]);
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual(['Sending 2 requests', 'GET 200 · 142 ms', 'Localhost']);
  });
});
