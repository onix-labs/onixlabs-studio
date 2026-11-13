import { CdkMenu, CdkMenuItem, CdkMenuTrigger } from '@angular/cdk/menu';
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { MenuKeepOpen } from './menu-keep-open';

/**
 * A menu with one ordinary item and one that keeps the menu open.
 */
@Component({
  imports: [CdkMenu, CdkMenuItem, CdkMenuTrigger, MenuKeepOpen],
  template: `
    <button type="button" class="trigger" [cdkMenuTriggerFor]="menu">Open</button>
    <ng-template #menu>
      <div class="panel" cdkMenu>
        <button
          type="button"
          class="ordinary"
          cdkMenuItem
          (cdkMenuItemTriggered)="log.push('ordinary')"
        >
          Ordinary
        </button>
        <button type="button" class="kept" cdkMenuItem (appMenuKeepOpen)="log.push('kept')">
          Kept
        </button>
      </div>
    </ng-template>
  `,
})
class Host {
  /**
   * Gets what was chosen, in order.
   */
  public readonly log: string[] = [];
}

describe('MenuKeepOpen', () => {
  /**
   * Mounts the host and opens its menu.
   * @returns Returns the fixture.
   */
  function openMenu(): ComponentFixture<Host> {
    const fixture: ComponentFixture<Host> = TestBed.createComponent(Host);
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.trigger')?.click();
    fixture.detectChanges();
    return fixture;
  }

  it('click_onAKeptItem_actsWithoutClosingTheMenu', () => {
    const fixture: ComponentFixture<Host> = openMenu();

    document.querySelector<HTMLButtonElement>('.kept')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.log).toEqual(['kept']);
    expect(document.querySelector('.panel')).not.toBeNull();
  });

  it('click_onAnOrdinaryItem_stillClosesTheMenu', () => {
    const fixture: ComponentFixture<Host> = openMenu();

    document.querySelector<HTMLButtonElement>('.ordinary')?.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.log).toEqual(['ordinary']);
    expect(document.querySelector('.panel')).toBeNull();
  });
});
