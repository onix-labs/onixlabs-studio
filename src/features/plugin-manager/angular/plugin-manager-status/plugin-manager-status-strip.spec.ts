import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PluginSummary } from '@shared/api/plugin-channels';
import { PluginBrowse } from '../plugin-browse/plugin-browse';
import { PluginManagerStatusStrip } from './plugin-manager-status-strip';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<PluginManagerStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

/**
 * Builds a catalogue entry.
 * @param state The plugin's state.
 * @param version The catalogue's version.
 * @param installedVersion The installed version, if installed.
 * @returns Returns the summary.
 */
function plugin(
  state: string,
  version: string = '1.0.0',
  installedVersion: string | null = null,
): PluginSummary {
  return { state, version, installedVersion } as unknown as PluginSummary;
}

describe('PluginManagerStatusStrip (#882)', () => {
  let fixture: ComponentFixture<PluginManagerStatusStrip>;
  let all: WritableSignal<readonly PluginSummary[]>;
  let narrowed: WritableSignal<boolean>;
  let visible: WritableSignal<readonly PluginSummary[]>;

  beforeEach(() => {
    all = signal<readonly PluginSummary[]>([
      plugin('installed', '1.0.0', '1.0.0'),
      plugin('installed', '2.0.0', '1.0.0'),
      plugin('available'),
      plugin('available'),
    ]);
    narrowed = signal<boolean>(false);
    visible = signal<readonly PluginSummary[]>([]);
    TestBed.configureTestingModule({
      providers: [
        {
          provide: PluginBrowse,
          useValue: {
            all,
            installedCount: signal<number>(2),
            narrowed,
            visible,
          },
        },
      ],
    });
    fixture = TestBed.createComponent(PluginManagerStatusStrip);
  });

  it('saysHowMuchOfTheCatalogueIsInstalled', () => {
    fixture.detectChanges();

    // On the right, first, so it is the last to drop out of a narrow strip.
    expect(segmentsOf(fixture, 0)).toEqual([]);
    expect(segmentsOf(fixture, 1)[0]).toBe('2 of 4 installed');
  });

  it('countsUpdates_byTheRuleTheUpdateButtonsFollow', () => {
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual(['2 of 4 installed', '1 update available']);
  });

  it('reportsWorkInProgress_andTheFilteredCount_whileTheyApply', () => {
    all.set([...all(), plugin('busy')]);
    narrowed.set(true);
    visible.set([plugin('available')]);
    fixture.detectChanges();

    expect(segmentsOf(fixture, 1)).toEqual([
      '2 of 5 installed',
      'Installing 1',
      '1 update available',
      'Showing 1 of 5',
    ]);
  });
});
