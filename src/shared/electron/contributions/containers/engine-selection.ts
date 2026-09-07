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
 * @param catalogue The engines to consider; defaults to the whole catalogue.
 * @returns Returns the available descriptors.
 */
export function availableEngines(
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
  catalogue: readonly ContainerEngineDescriptor[] = containerEngineCatalogue(),
): readonly ContainerEngineDescriptor[] {
  return catalogue.filter((descriptor: ContainerEngineDescriptor): boolean =>
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
 *
 * **Null when the catalogue is empty**, which is not a defensive nicety: once the built-in engines
 * leave core (#596, #597), a Studio with no engine plugin installed has nothing to select, and that
 * state has to be nameable rather than crash on the first element of an empty list.
 * @param environment The discovery environment; defaults to the running process.
 * @param catalogue The engines to choose between; defaults to the whole catalogue. Injected rather
 * than read, so the empty case — the one #596 and #597 create — is testable before it is reachable.
 * @returns Returns the descriptor of the engine in effect, or null when no engine is installed.
 */
export function selectedEngine(
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
  catalogue: readonly ContainerEngineDescriptor[] = containerEngineCatalogue(),
): ContainerEngineDescriptor | null {
  chosen ??= loadChoice();
  if (catalogue.length === 0) {
    return null;
  }
  const available: readonly ContainerEngineDescriptor[] = availableEngines(environment, catalogue);
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
 * @param catalogue The engines to describe; defaults to the whole catalogue.
 * @returns Returns the engine descriptions.
 */
export function describeEngines(
  environment: DiscoveryEnvironment = processDiscoveryEnvironment(),
  catalogue: readonly ContainerEngineDescriptor[] = containerEngineCatalogue(),
): readonly ContainerEngineInfo[] {
  // Undefined when no engine is installed, which matches no engine's id — so an empty catalogue
  // describes nothing rather than naming an engine that is not there.
  const inEffect: string | undefined = selectedEngine(environment, catalogue)?.id;
  const platform: NodeJS.Platform = environment.platform;
  return catalogue.map((engine: ContainerEngineDescriptor): ContainerEngineInfo => ({
    id: engine.id,
    displayName: engine.displayName,
    available: isEngineAvailable(engine, environment),
    inEffect: engine.id === inEffect,
    cli: engine.cli,
    startCommand: engine.startCommand(platform),
  }));
}
