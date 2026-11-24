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
    fixture.componentRef.setInput('fixedSize', '1.875rem');
    fixture.detectChanges();

    expect(host.style.flexGrow).toBe('0');
    expect(host.style.flexBasis).toBe('1.875rem');
  });

  it('render_whenNoLongerFixed_returnsToItsShare', () => {
    fixture.componentRef.setInput('fixedSize', '0');
    fixture.detectChanges();
    fixture.componentRef.setInput('fixedSize', null);
    fixture.detectChanges();

    expect(host.style.flexGrow).toBe('3');
  });

  it('clearPreview_afterAPreview_returnsToItsShare', () => {
    fixture.componentInstance.previewShare(7);
    expect(host.style.flexGrow).toBe('7');

    fixture.componentInstance.clearPreview();

    expect(host.style.flexGrow).toBe('3');
  });
});
