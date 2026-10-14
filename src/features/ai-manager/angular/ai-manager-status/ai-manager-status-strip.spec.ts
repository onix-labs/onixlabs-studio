import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AiManagerSection } from '@shared/angular/services/ai-manager-navigation/ai-manager-navigation';
import { AiManagerView, LibraryCounts } from '../ai-manager-view/ai-manager-view';
import { ModelManagerSummary } from '../model-manager-view/model-manager-view';
import { AiManagerStatusStrip } from './ai-manager-status-strip';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<AiManagerStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('AiManagerStatusStrip (#882, #948)', () => {
  let fixture: ComponentFixture<AiManagerStatusStrip>;
  let summary: WritableSignal<ModelManagerSummary>;
  let section: WritableSignal<AiManagerSection>;
  let skillCounts: WritableSignal<LibraryCounts>;

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
    section = signal<AiManagerSection>('models');
    skillCounts = signal<LibraryCounts>({ total: 0, enabled: 0 });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AiManagerView,
          useValue: {
            section,
            modelSummary: summary,
            profileCounts: signal<LibraryCounts>({ total: 1, enabled: 1 }),
            skillCounts,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(AiManagerStatusStrip);
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

  it('countsTheSkillsAndThoseSwitchedOn_whileTheSkillsSectionIsShown', () => {
    section.set('skills');
    skillCounts.set({ total: 3, enabled: 2 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['3 skills']);
    expect(segmentsOf(fixture, 1)).toEqual(['2 switched on']);

    skillCounts.set({ total: 0, enabled: 0 });
    fixture.detectChanges();
    expect(segmentsOf(fixture, 0)).toEqual(['0 skills']);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });
});
