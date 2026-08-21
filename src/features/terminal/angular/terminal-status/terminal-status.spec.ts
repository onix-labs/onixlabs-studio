import { describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { TerminalStatusStrip } from './terminal-status-strip';
import { TerminalStatus } from './terminal-status';

/**
 * Reads the rendered segment texts from one of the strip's two groups.
 * @param fixture The mounted status-strip fixture.
 * @param group The group to read: 0 for the leading group, 1 for the trailing one.
 * @returns Returns the segment texts in render order.
 */
function segmentsOf(fixture: ComponentFixture<TerminalStatusStrip>, group: number): string[] {
  const host: HTMLElement = fixture.nativeElement as HTMLElement;
  const groups: NodeListOf<Element> = host.querySelectorAll('.status-strip-segments__group');
  return [...(groups.item(group)?.querySelectorAll('.status-strip-segment') ?? [])].map(
    (element: Element): string => (element.textContent ?? '').trim(),
  );
}

describe('TerminalStatusStrip', () => {
  let status: TerminalStatus;
  let fixture: ComponentFixture<TerminalStatusStrip>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [TerminalStatus] });
    status = TestBed.inject(TerminalStatus);
    fixture = TestBed.createComponent(TerminalStatusStrip);
  });

  it('publish_whenContextSet_showsAddressLeadingAndShellTrailing', () => {
    status.publish({ address: 'john@machine:~/Projects', shell: 'zsh' });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['john@machine:~/Projects']);
    expect(segmentsOf(fixture, 1)).toEqual(['zsh']);
  });

  it('publish_whenAddressUnknown_showsOnlyTheShell', () => {
    status.publish({ address: null, shell: 'bash' });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual([]);
    expect(segmentsOf(fixture, 1)).toEqual(['bash']);
  });

  it('publish_whenShellUnknown_showsOnlyTheAddress', () => {
    status.publish({ address: 'john@machine:~', shell: null });
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual(['john@machine:~']);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });

  it('clear_whenCalled_removesEverySegment', () => {
    status.publish({ address: 'john@machine:~', shell: 'zsh' });
    fixture.detectChanges();

    status.clear();
    fixture.detectChanges();

    expect(segmentsOf(fixture, 0)).toEqual([]);
    expect(segmentsOf(fixture, 1)).toEqual([]);
  });
});
