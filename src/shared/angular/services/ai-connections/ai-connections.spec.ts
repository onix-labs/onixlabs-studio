import { TestBed } from '@angular/core/testing';

import type { AiConnection } from '@shared/api/ai-types';
import { Settings } from '@shared/angular/services/settings/settings';
import { AiConnections } from './ai-connections';

describe('AiConnections', () => {
  let service: AiConnections;
  let settings: Settings;

  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as { bridge?: unknown }).bridge;
    service = TestBed.inject(AiConnections);
    settings = TestBed.inject(Settings);
  });

  it('connections_whenUnconfigured_reflectsTheSeed', () => {
    expect(service.connections()).toEqual(settings.aiConnections());
    expect(service.connections().length).toBeGreaterThan(0);
  });

  it('isAvailable_whenBridgeAbsent_isFalse', () => {
    expect(service.isAvailable).toBe(false);
  });

  it('add_whenCalled_appendsWithAUniqueIdAndKindDefaults', () => {
    const before: number = service.connections().length;

    const openai: AiConnection = service.add('openai');
    const ollama: AiConnection = service.add('ollama');
    const openaiTwo: AiConnection = service.add('openai');

    expect(service.connections().length).toBe(before + 3);
    expect(openai.auth).toBe('api-key');
    expect(ollama.auth).toBe('none');
    expect(openai.id).not.toBe(openaiTwo.id);
  });

  it('update_whenCalled_patchesTheConnection', () => {
    const created: AiConnection = service.add('openai');

    service.update(created.id, { label: 'My OpenAI', baseUrl: 'https://example/v1' });

    const updated: AiConnection | undefined = service
      .connections()
      .find((connection: AiConnection): boolean => connection.id === created.id);
    expect(updated?.label).toBe('My OpenAI');
    expect(updated?.baseUrl).toBe('https://example/v1');
  });

  it('remove_whenSeedConnection_dropsItLikeAnyOther', () => {
    // Seed connections are ordinary defaults with no privileged status; every one is removable.
    const seed: AiConnection = service.connections()[0];

    service.remove(seed.id);

    expect(
      service.connections().some((connection: AiConnection): boolean => connection.id === seed.id),
    ).toBe(false);
  });

  it('remove_whenUserConnection_dropsIt', () => {
    const created: AiConnection = service.add('openai');

    service.remove(created.id);

    expect(
      service
        .connections()
        .some((connection: AiConnection): boolean => connection.id === created.id),
    ).toBe(false);
  });

  it('move_whenCalled_reordersTheConnection', () => {
    const created: AiConnection = service.add('openai');
    const lastIndex: number = service.connections().length - 1;
    expect(service.connections()[lastIndex].id).toBe(created.id);

    service.move(created.id, -1);

    expect(service.connections()[lastIndex - 1].id).toBe(created.id);
  });

  it('addModel_whenCalled_appendsAModelOnce', () => {
    const created: AiConnection = service.add('openai');

    service.addModel(current(created.id), 'gpt-4o');
    service.addModel(current(created.id), 'gpt-4o');
    service.addModel(current(created.id), '   ');

    expect(current(created.id).models.map((model): string => model.id)).toEqual(['gpt-4o']);
  });

  it('removeModel_whenDefault_clearsOrReassignsTheDefault', () => {
    const created: AiConnection = service.add('openai');
    service.addModel(current(created.id), 'a');
    service.addModel(current(created.id), 'b');
    service.setDefaultModel(current(created.id), 'a');

    service.removeModel(current(created.id), 'a');

    expect(current(created.id).defaultModelId).toBe('b');
  });

  it('togglePinnedAndHidden_whenCalled_flipTheFlags', () => {
    const created: AiConnection = service.add('openai');
    service.addModel(current(created.id), 'a');

    service.togglePinned(current(created.id), 'a');
    service.toggleHidden(current(created.id), 'a');

    expect(current(created.id).models[0].pinned).toBe(true);
    expect(current(created.id).models[0].hidden).toBe(true);
  });

  it('authStatus_whenUnresolved_isPending', () => {
    const created: AiConnection = service.add('openai');

    expect(service.authStatus(created.id).available).toBe(false);
    expect(service.authStatus(created.id).detail).toBe('Checking…');
  });

  /**
   * Reads the current persisted connection for the given id.
   * @param id The connection id.
   * @returns Returns the connection.
   */
  function current(id: string): AiConnection {
    const connection: AiConnection | undefined = service
      .connections()
      .find((candidate: AiConnection): boolean => candidate.id === id);
    if (connection === undefined) {
      throw new Error(`No connection "${id}"`);
    }
    return connection;
  }
});
