import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ModelManagerSummary, ModelManagerView } from '../model-manager-view/model-manager-view';
import { ModelManagerStatusStrip } from './model-manager-status-strip';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<ModelManagerStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('ModelManagerStatusStrip (#882)', () => {
  let fixture: ComponentFixture<ModelManagerStatusStrip>;
  let summary: WritableSignal<ModelManagerSummary>;

  beforeEach(() => {
    summary = signal<ModelManagerSummary>({
      runtime: 'Ollama',
      version: '0.12.3',
      state: 'running',
      downloading: 0,
      installed: 6,
      loaded: 0,
      disk: '24.3 GB',
    });
    TestBed.configureTestingModule({
      providers: [{ provide: ModelManagerView, useValue: { summary } }],
    });
    fixture = TestBed.createComponent(ModelManagerStatusStrip);
  });

  it('namesTheRuntimeAndVersion_thenTheInstalledModelsAndDisk', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['Ollama 0.12.3']);
    expect(segmentsOf(fixture, 1)).toEqual(['6 installed', '24.3 GB on disk']);
  });

  it('countsDownloadsAndLoadedModels_whileThereAreAny', () => {
    summary.set({ ...summary(), downloading: 2, loaded: 1 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual([
      'Downloading 2',
      '6 installed',
      '1 loaded',
      '24.3 GB on disk',
    ]);
  });

  it('saysTheRuntimeIsNotRunning_orNotInstalled', () => {
    summary.set({ ...summary(), state: 'stopped', installed: 0 });
    fixture.detectChanges();
    expect(segmentsOf(fixture, 0)).toEqual(['Ollama (not running)']);
    // The server lists the models, so with it down the count is unknown, not zero; the disk still is.
    expect(segmentsOf(fixture, 1)).toEqual(['24.3 GB on disk']);

    summary.set({ ...summary(), state: 'absent' });
    fixture.detectChanges();
    expect(segmentsOf(fixture, 0)).toEqual(['Ollama not installed']);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });
});
