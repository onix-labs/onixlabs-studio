import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RibbonHost } from './ribbon-host';

/**
 * Represents a minimal host that attaches {@link RibbonHost} the way a feature ribbon does, so the
 * directive's host layout can be asserted on a real element.
 */
@Component({
  selector: 'app-ribbon-host-test',
  template: '',
  hostDirectives: [RibbonHost],
})
class RibbonHostTestComponent {}

describe('RibbonHost', () => {
  let fixture: ComponentFixture<RibbonHostTestComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RibbonHostTestComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RibbonHostTestComponent);
    fixture.detectChanges();
  });

  it('attach_whenHostRendered_appliesRibbonFlexLayout', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;

    expect(host.style.display).toBe('flex');
    expect(host.style.alignItems).toBe('stretch');
    expect(host.style.flexGrow || host.style.flex).toBeTruthy();
    expect(host.style.minInlineSize).toBeTruthy();
  });
});
