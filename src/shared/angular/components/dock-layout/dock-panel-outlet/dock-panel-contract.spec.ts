import { reflectComponentType, Type } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { WORKSPACE_DOCK_BLUEPRINT } from '@features/workspace/angular/directory-view/workspace-dock-blueprint';
import { REPOSITORY_DOCK_BLUEPRINT } from '@shared/angular/components/panels/repository-dock-blueprint';
import { DockBlueprint } from '@shared/angular/services/dock-layout/dock-blueprint';

/**
 * Guards the contract every dock panel component is held to: the outlet binds the panel descriptor on
 * ALL of them, so a component that does not declare the input fails at runtime with NG0303 — a console
 * error in a panel nobody opened during testing, which is exactly how it goes unnoticed.
 *
 * The blueprints are the registries of what the outlet can project, so they are the list to check.
 */
describe('dock panel contract', () => {
  const BLUEPRINTS: readonly (readonly [string, DockBlueprint])[] = [
    ['workspace', WORKSPACE_DOCK_BLUEPRINT],
    ['repository', REPOSITORY_DOCK_BLUEPRINT],
  ];

  for (const [name, blueprint] of BLUEPRINTS) {
    it(`${name}_everyPanelComponentDeclaresThePanelInput`, () => {
      const missing: string[] = [];
      for (const panel of blueprint.panels) {
        const component: Type<unknown> | undefined = panel.component;
        if (component === undefined) {
          continue;
        }
        const declaresPanel: boolean =
          reflectComponentType(component)?.inputs.some(
            (input: { propName: string; templateName: string }): boolean =>
              input.templateName === 'panel',
          ) ?? false;
        if (!declaresPanel) {
          missing.push(`${panel.id} (${component.name})`);
        }
      }

      expect(missing).toEqual([]);
    });
  }
});
