import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { ContainerEngineInfo } from '@shared/api/docker-types';
import { resolveSlot } from '@shared/api/slot';
import { logger } from '../../logger';
import {
  ContainerEngineDescriptor,
  containerEngineCatalogue,
  isEngineAvailable,
} from './container-engine';

/**
 * Holds the user's chosen engine for this session, loaded lazily from disk.
 */
let chosen: string | null | undefined;

/**
 * Gets the file the engine choice is persisted in.
 * @returns Returns the store path.
 */
function storeFile(): string {
  return path.join(app.getPath('userData'), 'container-engine.json');
}

/**
 * Reads the persisted engine choice, defaulting to none.
 * @returns Returns the chosen engine identifier, or null when the user has not chosen.
 */
function loadChoice(): string | null {
  try {
    const file: string = storeFile();
    if (!existsSync(file)) {
      return null;
    }
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const engine: unknown = (parsed as { engine?: unknown })?.engine;
    return typeof engine === 'string' && engine.length > 0 ? engine : null;
  } catch (error: unknown) {
    // A corrupt store simply means no preference, which resolves to the default engine.
    logger.error('ContainerEngine', 'Failed to read the engine choice', error);
    return null;
  }
}

/**
 * Gets the engines present on this machine, in catalogue order.
 * @returns Returns the available descriptors.
 */
export function availableEngines(): readonly ContainerEngineDescriptor[] {
  return containerEngineCatalogue().filter(isEngineAvailable);
}

/**
 * Gets the engine in effect: the user's choice when they have made one and it is present, otherwise
 * the highest-priority engine that is — and, when none is present at all, the first in the catalogue
 * so the surface still has something to report a failed connection against.
 * @returns Returns the descriptor of the engine in effect.
 */
export function selectedEngine(): ContainerEngineDescriptor {
  chosen ??= loadChoice();
  const available: readonly ContainerEngineDescriptor[] = availableEngines();
  const id: string | null = resolveSlot(available, chosen ?? undefined);
  return (
    available.find((engine: ContainerEngineDescriptor): boolean => engine.id === id) ??
    containerEngineCatalogue()[0]
  );
}

/**
 * Chooses which engine to use, persisting it. Passing null clears the choice, returning the slot to
 * whichever available engine has the highest priority.
 * @param engineId The chosen engine identifier, or null to clear the choice.
 */
export function chooseEngine(engineId: string | null): void {
  chosen = engineId;
  try {
    writeFileSync(storeFile(), JSON.stringify({ engine: engineId }), {
      encoding: 'utf8',
      mode: 0o600,
    });
    logger.info('ContainerEngine', `Engine choice set to '${engineId ?? 'automatic'}'`);
  } catch (error: unknown) {
    // Persistence is best-effort; the choice still applies for this session.
    logger.error('ContainerEngine', 'Failed to persist the engine choice', error);
  }
}

/**
 * Describes the engines to the renderer: what exists, what is present here, and which is in effect.
 * Mirrors the plugin catalogue exactly — the surface offers a choice only when more than one engine is
 * actually available, and an engine that is not installed is never offered.
 * @returns Returns the engine descriptions.
 */
export function describeEngines(): readonly ContainerEngineInfo[] {
  const inEffect: string = selectedEngine().id;
  return containerEngineCatalogue().map(
    (engine: ContainerEngineDescriptor): ContainerEngineInfo => {
      const available: boolean = isEngineAvailable(engine);
      return {
        id: engine.id,
        displayName: engine.displayName,
        available,
        inEffect: available && engine.id === inEffect,
        cli: engine.cli,
      };
    },
  );
}
