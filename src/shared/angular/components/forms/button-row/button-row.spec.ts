import { Component, signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Button } from '@shared/angular/components/forms/button/button';
import { ButtonRow } from './button-row';

/**
 * Hosts a row of two buttons, the primary first, as every action row in Studio is written.
 */
@Component({
  imports: [Button, ButtonRow],
  template: `
    <app-button-row [align]="align()">
      <app-button variant="solid" label="Delete branch" />
      <app-button label="Cancel" />
    </app-button-row>
  `,
})
class HostComponent {
  public readonly align: WritableSignal<'end' | 'start' | 'fill'> = signal<
    'end' | 'start' | 'fill'
  >('end');
}

describe('ButtonRow', () => {
  let fixture: ComponentFixture<HostComponent>;
  let row: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    row = (fixture.nativeElement as HTMLElement).querySelector('app-button-row')!;
  });

  it('keepsTheButtonsInTheOrderTheyAreWritten', () => {
    const labels: string[] = [...row.querySelectorAll('button')].map(
      (button: HTMLButtonElement): string => button.textContent?.trim() ?? '',
    );

    expect(labels).toEqual(['Delete branch', 'Cancel']);
  });

  it('isAGroup', () => {
    expect(row.getAttribute('role')).toBe('group');
  });

  it('align_marksTheRowForTheLeadingEdgeOrTheFullWidth', () => {
    expect(row.classList.contains('button-row--start')).toBe(false);

    fixture.componentInstance.align.set('start');
    fixture.detectChanges();
    expect(row.classList.contains('button-row--start')).toBe(true);

    fixture.componentInstance.align.set('fill');
    fixture.detectChanges();
    expect(row.classList.contains('button-row--fill')).toBe(true);
  });
});
