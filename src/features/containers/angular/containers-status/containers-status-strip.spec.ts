import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContainersSummary, ContainersView } from '../containers-view/containers-view';
import { ContainersStatusStrip } from './containers-status-strip';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<ContainersStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('ContainersStatusStrip (#882)', () => {
  let fixture: ComponentFixture<ContainersStatusStrip>;
  let summary: WritableSignal<ContainersSummary>;

  beforeEach(() => {
    summary = signal<ContainersSummary>({
      engine: 'Docker',
      available: true,
      containers: 5,
      images: 12,
    });
    TestBed.configureTestingModule({
      providers: [{ provide: ContainersView, useValue: { summary } }],
    });
    fixture = TestBed.createComponent(ContainersStatusStrip);
  });

  it('namesTheEngine_thenCountsContainersAndImages', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['Docker']);
    expect(segmentsOf(fixture, 1)).toEqual(['5 containers', '12 images']);
  });

  it('saysTheEngineIsNotRunning_andCountsNothing_whenItDoesNotAnswer', () => {
    summary.set({ engine: 'Podman', available: false, containers: 0, images: 0 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['Podman (not running)']);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });

  it('saysNoEngineIsInstalled_whenThereIsNone', () => {
    summary.set({ engine: null, available: false, containers: 0, images: 0 });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['No engine installed']);
  });
});
