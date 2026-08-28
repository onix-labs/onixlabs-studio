import { describe, expect, it } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AppMenu } from '@shared/angular/services/app-menu/app-menu';
import { MENU_SEPARATOR, MenuContribution } from '@shared/angular/services/app-menu/app-menu-model';
import {
  ApplicationMenuAppearance,
  ApplicationMenuMode,
  Settings,
} from '@shared/angular/services/settings/settings';
import { TitleStripMenu } from './title-strip-menu';

/**
 * Reads the component's sections, which are protected but are the whole contract this component has:
 * the translation from the shared menu model into the bar's buttons and their rows.
 * @param fixture The mounted component.
 * @returns Returns the sections.
 */
function sectionsOf(fixture: ComponentFixture<TitleStripMenu>): readonly Record<string, unknown>[] {
  const component: { sections: () => readonly Record<string, unknown>[] } =
    fixture.componentInstance as unknown as { sections: () => readonly Record<string, unknown>[] };
  return component.sections();
}

/**
 * Mounts the trigger over a menu carrying the given sections.
 * @param sections The contributed sections.
 * @param mode The application-menu mode to render under, defaulting to the registry's.
 * @param appearance The button's appearance, defaulting to the registry's.
 * @returns Returns the fixture and the menu it reads.
 */
function mount(
  sections: readonly MenuContribution[],
  mode?: ApplicationMenuMode,
  appearance?: ApplicationMenuAppearance,
): {
  fixture: ComponentFixture<TitleStripMenu>;
  menu: AppMenu;
} {
  TestBed.configureTestingModule({ imports: [TitleStripMenu], providers: [AppMenu] });
  const menu: AppMenu = TestBed.inject(AppMenu);
  const settings: Settings = TestBed.inject(Settings);
  if (mode !== undefined) {
    settings.set('application.menuMode', mode);
  }
  if (appearance !== undefined) {
    settings.set('application.menuAppearance', appearance);
  }
  menu.contribute('test', sections, 0);
  const fixture: ComponentFixture<TitleStripMenu> = TestBed.createComponent(TitleStripMenu);
  fixture.detectChanges();
  return { fixture, menu };
}

/**
 * A pair of sections, enough to tell a bar of buttons from a single trigger.
 */
const TWO_SECTIONS: readonly MenuContribution[] = [
  {
    id: 'file',
    label: 'File',
    items: [{ id: 'file.save', label: 'Save', run: (): void => undefined }],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [{ id: 'edit.undo', label: 'Undo', run: (): void => undefined }],
  },
];

/**
 * A File section whose first entry opens a submenu, which is the shape #460 misbehaves on.
 */
const NESTED_SECTIONS: readonly MenuContribution[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      {
        id: 'file.new',
        label: 'New',
        items: [{ id: 'file.new.code', label: 'Code File', run: (): void => undefined }],
      },
      { id: 'file.open', label: 'Open File…', run: (): void => undefined },
    ],
  },
];

/**
 * Counts the menu panels currently on screen.
 * @returns Returns the number of open panels.
 */
function panels(): number {
  return document.querySelectorAll('.app-menu-panel').length;
}

/**
 * Sends the pointer onto the first row of the innermost open panel, as the browser does when a panel
 * materialises beneath a cursor that has not moved.
 */
function hoverFirstRow(): void {
  document
    .querySelector<HTMLElement>('.app-menu-panel__item')
    ?.dispatchEvent(new MouseEvent('mouseenter'));
}

describe('TitleStripMenu', () => {
  it('sections_areOneSectionEach_withTheirCommandsAsASubmenu', () => {
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

    const rows: readonly Record<string, unknown>[] = sectionsOf(fixture);
    expect(rows.length).toBe(1);
    expect(rows[0]['label']).toBe('File');
    const children: readonly Record<string, unknown>[] = rows[0]['children'] as readonly Record<
      string,
      unknown
    >[];
    expect(children.length).toBe(1);
    expect(children[0]['id']).toBe('file.save');
  });

  it('sections_carryTheAcceleratorAsTheTrailingStatus', () => {
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
    const children: readonly Record<string, unknown>[] = sectionsOf(fixture)[0][
      'children'
    ] as readonly Record<string, unknown>[];
    expect(children[0]['status']).toBeTruthy();
  });

  it('sections_markACheckboxEntry_butLeavePlainCommandsUnchecked', () => {
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

    const children: readonly Record<string, unknown>[] = sectionsOf(fixture)[0][
      'children'
    ] as readonly Record<string, unknown>[];
    expect(children[0]['checked']).toBe(true);
    // A plain command must leave `checked` undefined, or every row draws an empty checkbox gutter.
    expect('checked' in children[1]).toBe(false);
  });

  it('sections_carrySeparators_soLongMenusStayGrouped', () => {
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

    const children: readonly Record<string, unknown>[] = sectionsOf(fixture)[0][
      'children'
    ] as readonly Record<string, unknown>[];
    expect(children[1]['separator']).toBe(true);
  });

  it('sections_dropAnEmptySection_ratherThanOpeningOntoNothing', () => {
    const { fixture } = mount([{ id: 'empty', label: 'Empty', items: [] }]);

    expect(sectionsOf(fixture)).toEqual([]);
  });

  it('render_byDefault_showsTheMenuButtonAlone', () => {
    // The default is the button, laid out vertically — what the menu did before it was configurable.
    const { fixture } = mount(TWO_SECTIONS);

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.title-strip-menu__trigger')).not.toBeNull();
    expect(host.querySelector('.title-strip-menu__bar')).toBeNull();
  });

  it('render_whenTheMenuIsHidden_drawsNothing', () => {
    const { fixture } = mount(TWO_SECTIONS, 'hidden');

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.title-strip-menu__trigger')).toBeNull();
    expect(host.querySelector('.title-strip-menu__bar')).toBeNull();
  });

  it('render_whenTheFullMenuIsShown_drawsTheSectionsAcrossABar', () => {
    const { fixture } = mount(TWO_SECTIONS, 'full');

    // A menu bar rather than a row of unrelated buttons: the role is what gives the sections one
    // keyboard stop and lets an open section hand over to its neighbour on hover.
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.title-strip-menu__trigger')).toBeNull();
    expect(host.querySelector('.title-strip-menu__bar')?.getAttribute('role')).toBe('menubar');
    expect(
      Array.from(host.querySelectorAll('.title-strip-menu__section')).map(
        (button: Element): string => button.textContent?.trim() ?? '',
      ),
    ).toEqual(['File', 'Edit']);
  });

  it('render_whenTheButtonIsHorizontal_keepsTheButton', () => {
    // The appearance changes what the button opens, not whether there is one.
    const { fixture } = mount(TWO_SECTIONS, 'icon', 'horizontal');

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.title-strip-menu__trigger')).not.toBeNull();
    expect(host.querySelector('.title-strip-menu__bar')).toBeNull();
  });

  it('open_aSectionOnTheBar_showsOnlyThatSectionsPanel', () => {
    // #460: the panel drops under a cursor that has not moved, so the browser re-runs its hit-testing
    // and the first row receives a `mouseenter` the user never performed. New carries a submenu, so
    // the section and its first entry would both be open — two panels for one click.
    const { fixture } = mount(NESTED_SECTIONS, 'full');

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLElement>('.title-strip-menu__section')?.click();
    fixture.detectChanges();
    hoverFirstRow();
    fixture.detectChanges();

    expect(panels()).toBe(1);
  });

  it('open_theButtonsFlyout_showsOnlyTheSectionList', () => {
    // The same on the burger, where the sections are the rows: File must not bring its commands with it.
    const { fixture } = mount(NESTED_SECTIONS, 'icon', 'vertical');

    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    host.querySelector<HTMLElement>('.title-strip-menu__trigger')?.click();
    fixture.detectChanges();
    hoverFirstRow();
    fixture.detectChanges();

    expect(panels()).toBe(1);
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
