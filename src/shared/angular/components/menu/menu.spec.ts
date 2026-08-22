import { CdkMenuTrigger } from '@angular/cdk/menu';
import { Component, TemplateRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { Menu, MenuItem } from './menu';
import { MENU_POSITIONS } from './menu-position';

/**
 * Hosts the menu with a trigger bound to its exposed panel and position, mirroring a real call site.
 */
@Component({
  imports: [Menu, CdkMenuTrigger],
  template: `
    <button
      type="button"
      [cdkMenuTriggerFor]="menu.panel() ?? null"
      [cdkMenuPosition]="menu.position()"
    >
      Open
    </button>
    <app-menu #menu [items]="items" placement="up-end" (selected)="chosen.push($event)" />
  `,
})
class HostComponent {
  public items: readonly MenuItem[] = [
    { id: 'a', label: 'Alpha' },
    { id: 'b', label: 'Bravo', active: true },
  ];
  public readonly chosen: string[] = [];
}

describe('Menu', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let menu: Menu;

  /**
   * Opens the menu by clicking the host's trigger.
   */
  function open(): void {
    (fixture.nativeElement as HTMLElement).querySelector('button')?.click();
    fixture.detectChanges();
  }

  /**
   * Reads the rows rendered across every open panel, innermost last.
   * @returns Returns the rendered row elements.
   */
  function rows(): readonly HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>('.app-menu-panel__item'));
  }

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
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

  describe('rows', () => {
    it('render_aPlainRow_isAnOrdinaryMenuItemWithNoCheckbox', () => {
      open();

      expect(rows().map((row: HTMLElement): string | null => row.getAttribute('role'))).toEqual([
        'menuitem',
        'menuitem',
      ]);
      expect(document.querySelector('.app-menu-panel__item-check')).toBeNull();
    });

    it('render_aCheckedRow_isACheckboxCarryingItsState', () => {
      host.items = [
        { id: 'on', label: 'On', checked: true },
        { id: 'off', label: 'Off', checked: false },
      ];
      fixture.detectChanges();
      open();

      // The role and aria-checked matter as much as the box: a switch that only looks like one is
      // invisible to a screen reader.
      expect(rows().map((row: HTMLElement): string | null => row.getAttribute('role'))).toEqual([
        'menuitemcheckbox',
        'menuitemcheckbox',
      ]);
      expect(
        rows().map((row: HTMLElement): string | null => row.getAttribute('aria-checked')),
      ).toEqual(['true', 'false']);

      // `false` still draws a box — an unchecked switch is a switch — but only `true` fills it.
      const boxes: NodeListOf<Element> = document.querySelectorAll('.app-menu-panel__item-check');
      expect(boxes.length).toBe(2);
      expect(boxes[0].classList).toContain('app-menu-panel__item-check--checked');
      expect(boxes[1].classList).not.toContain('app-menu-panel__item-check--checked');
    });

    it('render_aRowWithChildren_opensThemAsANestedPanel', () => {
      host.items = [
        { id: 'options', label: 'Options', children: [{ id: 'nested', label: 'Nested' }] },
      ];
      fixture.detectChanges();
      open();

      expect(rows().map((row: HTMLElement): string => row.textContent?.trim() ?? '')).toEqual([
        'Options',
      ]);

      rows()[0].click();
      fixture.detectChanges();

      // The submenu renders through the same recursive surface template, so its rows are ordinary
      // rows of a second panel rather than anything the parent had to declare.
      expect(document.querySelectorAll('.app-menu-panel').length).toBe(2);
      expect(rows().map((row: HTMLElement): string => row.textContent?.trim() ?? '')).toEqual([
        'Options',
        'Nested',
      ]);
    });

    it('render_everyPanel_isAPopupRatherThanAnInlineMenu', () => {
      host.items = [
        { id: 'options', label: 'Options', children: [{ id: 'nested', label: 'Nested' }] },
      ];
      fixture.detectChanges();
      open();
      rows()[0].click();
      fixture.detectChanges();

      // Each level is instantiated by its own trigger's portal, which is what carries MENU_TRIGGER
      // and MENU_STACK into the `cdkMenu`. Reach one through a wrapper template instead and CDK
      // reads it as an inline menu: it builds its own stack, so nothing can dismiss it and it lays
      // out as a stretched strip. The class is the visible tell, so both levels are checked.
      const panels: NodeListOf<Element> = document.querySelectorAll('.app-menu-panel');
      expect(panels.length).toBe(2);
      panels.forEach((panel: Element): void => {
        expect(panel.classList.contains('cdk-menu-inline')).toBe(false);
      });
    });

    it('select_aRowWithChildren_emitsNothing', () => {
      host.items = [
        { id: 'options', label: 'Options', children: [{ id: 'nested', label: 'Nested' }] },
      ];
      fixture.detectChanges();
      open();

      rows()[0].click();
      fixture.detectChanges();

      // Choosing a container opens it; only its leaves are actions.
      expect(host.chosen).toEqual([]);

      rows()[1].click();
      fixture.detectChanges();

      expect(host.chosen).toEqual(['nested']);
    });
  });
});
