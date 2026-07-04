import { Component, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Menu, MenuItem } from './menu';
import { MENU_POSITIONS } from './menu-position';

/**
 * Hosts the menu with a trigger bound to its exposed panel and position, mirroring a real call site.
 */
@Component({
  imports: [Menu],
  template: `<app-menu [items]="items" placement="up-end" />`,
})
class HostComponent {
  public items: readonly MenuItem[] = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Bravo', active: true },
  ];
}

describe('Menu', () => {
  let fixture: ComponentFixture<HostComponent>;
  let menu: Menu;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    menu = fixture.debugElement.query(By.directive(Menu)).componentInstance as Menu;
  });

  it('position_forPlacement_mapsToTheSharedPosition', () => {
    expect(menu.position()).toBe(MENU_POSITIONS['up-end']);
  });

  it('panel_afterRender_resolvesToATemplateForTheTrigger', () => {
    // The call site binds its trigger to this template ref; it must resolve after the view renders,
    // or cdkMenuTriggerFor has nothing to open.
    expect(menu.panel()).toBeInstanceOf(TemplateRef);
  });
});
