import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SplitPane } from './split-pane';

describe('SplitPane', () => {
  let fixture: ComponentFixture<SplitPane>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SplitPane] }).compileComponents();
    fixture = TestBed.createComponent(SplitPane);
    host = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('share', 3);
    fixture.detectChanges();
  });

  it('render_whenSizedByItsShare_growsByIt', () => {
    expect(host.style.flexGrow).toBe('3');
    expect(host.style.flexShrink).toBe('1');
  });

  it('render_whenFixed_keepsItsSizeWhateverItsShare', () => {
    fixture.componentRef.setInput('lockedSize', '1.875rem');
    fixture.detectChanges();

    expect(host.style.flexGrow).toBe('0');
    expect(host.style.flexBasis).toBe('1.875rem');
  });

  it('render_whenNoLongerFixed_returnsToItsShare', () => {
    fixture.componentRef.setInput('lockedSize', '0');
    fixture.detectChanges();
    fixture.componentRef.setInput('lockedSize', null);
    fixture.detectChanges();

    expect(host.style.flexGrow).toBe('3');
  });

  it('clearPreview_afterAPreview_returnsToItsShare', () => {
    fixture.componentInstance.previewShare(7);
    expect(host.style.flexGrow).toBe('7');

    fixture.componentInstance.clearPreview();

    expect(host.style.flexGrow).toBe('3');
  });

  it('render_whenGivenASize_keepsItInPixels', () => {
    fixture.componentRef.setInput('defaultSize', 320);
    fixture.detectChanges();

    expect(host.style.flexGrow).toBe('0');
    expect(host.style.flexBasis).toBe('320px');
    expect(fixture.componentInstance.sized()).toBe(true);
  });

  it('render_whenTheDefaultChangesAfterOpening_keepsTheSizeItOpenedAt', () => {
    fixture.componentRef.setInput('defaultSize', 320);
    fixture.detectChanges();
    fixture.componentRef.setInput('defaultSize', 500);
    fixture.detectChanges();

    expect(fixture.componentInstance.size()).toBe(320);
  });

  it('render_whenSizedInPixels_carriesItsMinimumAndNeverPassesHalfTheWindow', () => {
    fixture.componentRef.setInput('defaultSize', 320);
    fixture.componentRef.setInput('minSize', 120);
    fixture.componentRef.setInput('maxSize', 400);
    fixture.detectChanges();

    expect(host.style.minInlineSize).toBe('120px');
    expect(host.style.maxInlineSize).toBe('min(400px, 50vw)');
    expect(fixture.componentInstance.limit()).toBe(Math.min(400, window.innerWidth / 2));
  });

  it('render_whenSizedByShare_hasNoMaximum', () => {
    expect(host.style.maxInlineSize).toBe('');
    expect(fixture.componentInstance.limit()).toBe(Number.POSITIVE_INFINITY);
  });

  it('render_whenGivenAFraction_takesItUntilItHasRoomToMeasure', () => {
    fixture.componentRef.setInput('defaultFraction', 0.4);
    fixture.detectChanges();

    expect(host.style.flexBasis).toBe('40%');
    expect(fixture.componentInstance.size()).toBeNull();
  });

  it('render_whenHidden_isOutOfTheLayoutButStillThere', () => {
    fixture.componentRef.setInput('visible', false);
    fixture.detectChanges();

    expect(host.classList.contains('split-pane--hidden')).toBe(true);
  });

  it('commitSize_setsAWholeNumberOfPixelsAndReportsIt', () => {
    const reported: number[] = [];
    fixture.componentInstance.sizeChange.subscribe((size: number): number => reported.push(size));
    fixture.componentRef.setInput('defaultSize', 320);
    fixture.detectChanges();

    fixture.componentInstance.commitSize(200.4);
    fixture.detectChanges();

    expect(host.style.flexBasis).toBe('200px');
    expect(reported).toEqual([200]);
  });

  it('render_whenItsHostKeepsTheSize_followsIt', () => {
    fixture.componentRef.setInput('defaultSize', 320);
    fixture.componentRef.setInput('hostSize', 240);
    fixture.detectChanges();
    expect(host.style.flexBasis).toBe('240px');

    fixture.componentRef.setInput('hostSize', 260);
    fixture.detectChanges();
    expect(host.style.flexBasis).toBe('260px');

    fixture.componentRef.setInput('hostSize', null);
    fixture.detectChanges();
    expect(host.style.flexBasis).toBe('320px');
  });

  it('commitSize_whenItsHostKeepsTheSize_reportsItAndChangesNothing', () => {
    const reported: number[] = [];
    fixture.componentInstance.sizeChange.subscribe((size: number): number => reported.push(size));
    fixture.componentRef.setInput('hostSize', 240);
    fixture.detectChanges();
    fixture.componentInstance.previewSize(300.4);

    fixture.componentInstance.commitSize(300.4);

    expect(reported).toEqual([300]);
    expect(host.style.flexBasis).toBe('240px');
  });
});
