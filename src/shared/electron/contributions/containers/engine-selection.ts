import { app } from 'electron';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { ContainerEngineInfo } from '@shared/api/container-types';
import { resolveSlot } from '@shared/api/slot';
import { logger } from '../../logger';
import {
  ContainerEngineDescriptor,
  containerEngineCatalogue,
  isEngineAvailable,
} from './container-engine';
import { DiscoveryEnvironment, processDiscoveryEnvironment } from './socket-discovery';

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
 *
 * The discovery environment is taken once and threaded through rather than rebuilt per engine: it
 * reads the Docker configuration off disk, and one snapshot means every engine in an answer was judged
 * against the same machine state.
 * @param environment The discovery environment; defaults to the running process.
 * @returns Returns the available descriptors.
 */
export function availableEngines(
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
): readonly ContainerEngineDescriptor[] {
  return containerEngineCatalogue().filter((descriptor: ContainerEngineDescriptor): boolean =>
    isEngineAvailable(descriptor, environment),
  );
}

/**
 * Gets the engine in effect: the user's choice when they have made one and it is present, otherwise
 * the highest-priority engine that is.
 *
 * When none is present at all the choice still decides, because an engine that is installed but not
 * running is exactly the case the surface has to describe — falling through to the catalogue default
 * there is what told a Podman user that Docker was not running. Only a user who has never chosen gets
 * the default.
 * @param environment The discovery environment; defaults to the running process.
 * @returns Returns the descriptor of the engine in effect.
 */
export function selectedEngine(
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
): ContainerEngineDescriptor {
  chosen ??= loadChoice();
  const catalogue: readonly ContainerEngineDescriptor[] = containerEngineCatalogue();
  const available: readonly ContainerEngineDescriptor[] = availableEngines(environment);
  const id: string | null = resolveSlot(available, chosen ?? undefined);
  return (
    available.find((engine: ContainerEngineDescriptor): boolean => engine.id === id) ??
    catalogue.find((engine: ContainerEngineDescriptor): boolean => engine.id === chosen) ??
    catalogue[0]
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
 * Describes the engines to the renderer: what exists, what is present here, which is in effect, and how
 * an engine that is not running is started. Mirrors the plugin catalogue exactly — the surface offers a
 * choice only when more than one engine is actually available, and an engine that is not installed is
 * never offered.
 *
 * `inEffect` is deliberately independent of `available`: the engine in effect is the one the surface is
 * talking to, and it has the most to say precisely when that engine is not answering.
 * @param environment The discovery environment; defaults to the running process.
 * @returns Returns the engine descriptions.
 */
export function describeEngines(
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
): readonly ContainerEngineInfo[] {
  const inEffect: string = selectedEngine(environment).id;
  const platform: NodeJS.Platform = environment.platform;
  return containerEngineCatalogue().map(
    (engine: ContainerEngineDescriptor): ContainerEngineInfo => ({
      id: engine.id,
      displayName: engine.displayName,
      available: isEngineAvailable(engine, environment),
      inEffect: engine.id === inEffect,
      cli: engine.cli,
      canLaunch: engine.canLaunch(platform),
      startCommand: engine.startCommand(platform),
    }),
  );
}
