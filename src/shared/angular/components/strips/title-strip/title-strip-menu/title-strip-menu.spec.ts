import { describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import { TitleStripMenu } from './title-strip-menu';

/**
 * Reads the component's rows, which are protected but are the whole contract this component has: the
 * translation from the shared menu model into the shared menu component's rows.
 * @param fixture The mounted component.
 * @returns Returns the rows.
 */
function rowsOf(fixture: ComponentFixture<TitleStripMenu>): readonly Record<string, unknown>[] {
  const component: { rows: () => readonly Record<string, unknown>[] } =
    fixture.componentInstance as unknown as { rows: () => readonly Record<string, unknown>[] };
  return component.rows();
}

/**
 * Mounts the trigger over a menu carrying the given sections.
 * @param sections The contributed sections.
 * @returns Returns the fixture and the menu it reads.
 */
function mount(sections: readonly MenuContribution[]): {
  fixture: ComponentFixture<TitleStripMenu>;
  menu: AppMenu;
} {
  TestBed.configureTestingModule({ imports: [TitleStripMenu], providers: [AppMenu] });
  const menu: AppMenu = TestBed.inject(AppMenu);
  menu.contribute('test', sections, 0);
  const fixture: ComponentFixture<TitleStripMenu> = TestBed.createComponent(TitleStripMenu);
  fixture.detectChanges();
  return { fixture, menu };
}

describe('TitleStripMenu', () => {
  it('rows_areOneSectionEach_withTheirCommandsAsASubmenu', () => {
    const { fixture } = mount([
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'file.save',
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            run: (): void => undefined,
          },
        ],
      },
    ]);

    const rows: readonly Record<string, unknown>[] = rowsOf(fixture);
    expect(rows.length).toBe(1);
    expect(rows[0]['label']).toBe('File');
    const children: readonly Record<string, unknown>[] = rows[0]['children'] as readonly Record<
      string,
      unknown
    >[];
    expect(children.length).toBe(1);
    expect(children[0]['id']).toBe('file.save');
  });

  it('rows_carryTheAcceleratorAsTheTrailingStatus', () => {
    const { fixture } = mount([
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'file.save',
            label: 'Save',
            accelerator: 'CmdOrCtrl+S',
            run: (): void => undefined,
          },
        ],
      },
    ]);

    // The accelerator belongs in the muted trailing slot, which is where a menu conventionally shows it.
    const children: readonly Record<string, unknown>[] = rowsOf(fixture)[0][
      'children'
    ] as readonly Record<string, unknown>[];
    expect(children[0]['status']).toBeTruthy();
  });

  it('rows_markACheckboxEntry_butLeavePlainCommandsUnchecked', () => {
    const { fixture } = mount([
      {
        id: 'view',
        label: 'View',
        items: [
          {
            id: 'view.wrap',
            label: 'Word Wrap',
            kind: 'checkbox',
            checked: true,
            run: (): void => undefined,
          },
          { id: 'view.other', label: 'Something', run: (): void => undefined },
        ],
      },
    ]);

    const children: readonly Record<string, unknown>[] = rowsOf(fixture)[0][
      'children'
    ] as readonly Record<string, unknown>[];
    expect(children[0]['checked']).toBe(true);
    // A plain command must leave `checked` undefined, or every row draws an empty checkbox gutter.
    expect('checked' in children[1]).toBe(false);
  });

  it('rows_carrySeparators_soLongMenusStayGrouped', () => {
    const { fixture } = mount([
      {
        id: 'file',
        label: 'File',
        items: [
          { id: 'file.a', label: 'A', run: (): void => undefined },
          MENU_SEPARATOR,
          { id: 'file.b', label: 'B', run: (): void => undefined },
        ],
      },
    ]);

    const children: readonly Record<string, unknown>[] = rowsOf(fixture)[0][
      'children'
    ] as readonly Record<string, unknown>[];
    expect(children[1]['separator']).toBe(true);
  });

  it('rows_dropAnEmptySection_ratherThanOpeningOntoNothing', () => {
    const { fixture } = mount([{ id: 'empty', label: 'Empty', items: [] }]);

    expect(rowsOf(fixture)).toEqual([]);
  });

  it('select_runsTheCommandThroughTheSharedDispatch', () => {
    let ran: boolean = false;
    const { fixture } = mount([
      {
        id: 'file',
        label: 'File',
        items: [
          {
            id: 'file.save',
            label: 'Save',
            run: (): void => {
              ran = true;
            },
          },
        ],
      },
    ]);

    // Both menu surfaces run a command the same way, so behaviour cannot drift between them.
    const component: { onSelect: (id: string) => void } = fixture.componentInstance as unknown as {
      onSelect: (id: string) => void;
    };
    component.onSelect('file.save');

    expect(ran).toBe(true);
  });
});
