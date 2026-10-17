import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ProgressBar } from './progress-bar';

describe('ProgressBar', () => {
  let fixture: ComponentFixture<ProgressBar>;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ProgressBar] }).compileComponents();
    fixture = TestBed.createComponent(ProgressBar);
    host = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
  });

  it('render_always_isAnIndeterminateProgressbar', () => {
    expect(host.getAttribute('role')).toBe('progressbar');
    expect(host.getAttribute('aria-busy')).toBe('true');
    expect(host.hasAttribute('aria-valuenow')).toBe(false);
    expect(host.classList.contains('progress-bar--accent')).toBe(true);
    expect(host.querySelector('.progress-bar__label')).toBeNull();
  });

  it('label_whenGiven_isShownAndNamesTheBarUnlessAnAriaLabelOverrides', async () => {
    fixture.componentRef.setInput('label', 'Installing…');
    await fixture.whenStable();
    expect(host.querySelector('.progress-bar__label')?.textContent).toBe('Installing…');
    expect(host.getAttribute('aria-label')).toBe('Installing…');

    fixture.componentRef.setInput('ariaLabel', 'Installing clangd');
    await fixture.whenStable();
    expect(host.getAttribute('aria-label')).toBe('Installing clangd');
  });

  it('inputs_whenGiven_nameTheWorkAndColourTheSweep', async () => {
    fixture.componentRef.setInput('ariaLabel', 'Installing clangd');
    fixture.componentRef.setInput('tone', 'success');
    await fixture.whenStable();

    expect(host.getAttribute('aria-label')).toBe('Installing clangd');
    expect(host.classList.contains('progress-bar--success')).toBe(true);
    expect(host.classList.contains('progress-bar--accent')).toBe(false);
  });
});
