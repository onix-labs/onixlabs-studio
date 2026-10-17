import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DropdownOption } from '@shared/angular/components/forms/dropdown/dropdown';
import { MenuItem } from '@shared/angular/components/menu/menu';
import { Icon } from '@shared/angular/icons/icon';
import { DockPanel } from '@shared/angular/services/dock-layout/dock-panel';
import { FileSystem } from '@shared/angular/services/file-system/file-system';
import { ApiEnvironment } from '@shared/api/api-client-types';
import { ApiPrompts } from '../../api-prompts/api-prompts';
import { ApiWorkspace } from '../../api-workspace/api-workspace';
import { ApiEnvironmentPanel } from './api-environment-panel';

describe('ApiEnvironmentPanel (#882)', () => {
  let fixture: ComponentFixture<ApiEnvironmentPanel>;
  let workspace: ApiWorkspace;
  let confirmation: boolean;

  /**
   * Reads the panel's protected members, which are what the template binds to.
   */
  interface PanelInternals {
    readonly environmentOptions: () => readonly DropdownOption[];
    readonly menuItems: () => readonly MenuItem[];
    activate(id: string): void;
    onMenu(id: string): Promise<void>;
  }

  /**
   * Gets the panel's internals for assertion.
   * @returns Returns the panel, typed to its protected surface.
   */
  function panel(): PanelInternals {
    return fixture.componentInstance as unknown as PanelInternals;
  }

  /**
   * Gets the active environment, which every strip command acts on.
   * @returns Returns the active environment.
   */
  function active(): ApiEnvironment {
    return workspace.activeEnvironment()!;
  }

  beforeEach(async () => {
    globalThis.localStorage?.clear();
    confirmation = true;
    await TestBed.configureTestingModule({
      imports: [ApiEnvironmentPanel],
      providers: [
        ApiWorkspace,
        ApiPrompts,
        {
          provide: FileSystem,
          useValue: { confirmDestructive: (): Promise<boolean> => Promise.resolve(confirmation) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ApiEnvironmentPanel);
    workspace = TestBed.inject(ApiWorkspace);
    workspace.activateEnvironment(workspace.addEnvironment('Staging').id);
    fixture.componentRef.setInput('panel', {
      id: 'environment',
      title: 'Environment',
      icon: Icon.API_ENVIRONMENT,
      role: 'tool',
      component: ApiEnvironmentPanel,
    } satisfies DockPanel);
    fixture.detectChanges();
  });

  it('drawsItsStrip_withTheSwitcherNewAndMore', () => {
    const host: HTMLElement = fixture.nativeElement as HTMLElement;
    const labels: (string | null)[] = Array.from(
      host.querySelectorAll('app-panel-toolbar button[aria-label]'),
      (button: Element): string | null => button.getAttribute('aria-label'),
    );

    expect(host.querySelector('app-panel-toolbar app-dropdown')).not.toBeNull();
    expect(labels).toContain('New Environment');
    expect(labels).toContain('More Actions');
  });

  it('switcher_offersNoEnvironmentThenEveryEnvironment', () => {
    const labels: string[] = panel()
      .environmentOptions()
      .map((option: DropdownOption): string => option.label);

    expect(labels[0]).toBe('No Environment');
    expect(labels).toEqual([
      'No Environment',
      ...workspace.environments().map((environment: ApiEnvironment): string => environment.name),
    ]);
  });

  it('switcher_setsTheSameActiveEnvironmentAsTheExplorer', () => {
    const other: ApiEnvironment = workspace.addEnvironment('Production');

    panel().activate(other.id);
    expect(workspace.activeEnvironmentId()).toBe(other.id);

    panel().activate('');
    expect(workspace.activeEnvironmentId()).toBeNull();
  });

  it('menu_isDisabled_whileNoEnvironmentIsActive', () => {
    workspace.activateEnvironment(null);

    const enabled: MenuItem[] = panel()
      .menuItems()
      .filter((item: MenuItem): boolean => item.separator !== true && item.disabled !== true);
    expect(enabled).toEqual([]);
  });

  it('duplicate_copiesTheActiveEnvironment_andSwitchesToTheCopy', async () => {
    const original: ApiEnvironment = active();
    const before: number = workspace.environments().length;

    await panel().onMenu('environment.duplicate');

    expect(active().id).not.toBe(original.id);
    expect(workspace.environments()).toHaveLength(before + 1);
    expect(
      workspace.environments().some((e: ApiEnvironment): boolean => e.id === original.id),
    ).toBe(true);
  });

  it('delete_removesTheActiveEnvironment_onlyOnceConfirmed', async () => {
    const target: ApiEnvironment = active();

    confirmation = false;
    await panel().onMenu('environment.delete');
    expect(workspace.environments().some((e: ApiEnvironment): boolean => e.id === target.id)).toBe(
      true,
    );

    confirmation = true;
    await panel().onMenu('environment.delete');
    expect(workspace.environments().some((e: ApiEnvironment): boolean => e.id === target.id)).toBe(
      false,
    );
  });
});
