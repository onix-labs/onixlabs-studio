import { Component, signal, viewChild, Signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplitDirection } from '../split-direction';
import { SplitPane } from '../split-pane/split-pane';
import { SplitPanel } from './split-panel';

/**
 * Hosts a split whose first pane holds a split of its own.
 */
@Component({
  imports: [SplitPanel, SplitPane],
  template: `
    <app-split-panel #outer [dir]="dir()">
      <app-split-pane>
        <app-split-panel dir="col">
          <app-split-pane />
          <app-split-pane />
          <app-split-pane />
        </app-split-panel>
      </app-split-pane>
      @if (second()) {
        <app-split-pane [share]="2" />
      }
    </app-split-panel>
  `,
})
class TestHost {
  public readonly dir: WritableSignal<SplitDirection> = signal<SplitDirection>('row');
  public readonly second: WritableSignal<boolean> = signal<boolean>(true);
  public readonly outer: Signal<SplitPanel> = viewChild.required<SplitPanel>('outer');
}

describe('SplitPanel', () => {
  let fixture: ComponentFixture<TestHost>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TestHost] }).compileComponents();
    fixture = TestBed.createComponent(TestHost);
    fixture.detectChanges();
  });

  it('render_whenRow_carriesTheRowModifierClass', () => {
    const host: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector(
      'app-split-panel',
    )!;

    expect(host.classList.contains('split-panel--row')).toBe(true);
    expect(host.classList.contains('split-panel--col')).toBe(false);
  });

  it('render_whenTheDirectionChanges_followsIt', () => {
    fixture.componentInstance.dir.set('col');
    fixture.detectChanges();

    const host: HTMLElement = (fixture.nativeElement as HTMLElement).querySelector(
      'app-split-panel',
    )!;
    expect(host.classList.contains('split-panel--col')).toBe(true);
  });

  it('panes_whenAPaneHoldsASplit_areItsOwnAndNotTheNestedOnes', () => {
    const shares: readonly number[] = fixture.componentInstance
      .outer()
      .panes()
      .map((pane: SplitPane): number => pane.share());

    expect(shares).toEqual([1, 2]);
  });

  it('panes_whenAPaneGoes_dropsIt', () => {
    fixture.componentInstance.second.set(false);
    fixture.detectChanges();

    expect(fixture.componentInstance.outer().panes().length).toBe(1);
  });
});
