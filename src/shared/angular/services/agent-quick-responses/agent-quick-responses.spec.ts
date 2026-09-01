import { TestBed } from '@angular/core/testing';

import { AgentQuickResponses, QuickResponse } from './agent-quick-responses';

describe('AgentQuickResponses', () => {
  let responses: AgentQuickResponses;

  beforeEach(() => {
    localStorage.clear();
    responses = TestBed.inject(AgentQuickResponses);
  });

  /**
   * Reads the saved replies as plain text, which is all the order-sensitive assertions need.
   * @param library The library to read.
   * @returns Returns the reply texts, in saved order.
   */
  function texts(library: AgentQuickResponses): readonly string[] {
    return library.responses().map((response: QuickResponse): string => response.text);
  }

  it('responses_onFirstRun_areEmpty_soNothingIsStockedInAdvance', () => {
    expect(responses.responses()).toHaveLength(0);
  });

  it('add_whenCalled_appendsAndPersistsAcrossInstances', () => {
    expect(responses.add('Ship it')).toBe(true);

    expect(texts(responses).at(-1)).toBe('Ship it');

    // A fresh instance rehydrates from the store.
    TestBed.resetTestingModule();
    const fresh: AgentQuickResponses = TestBed.inject(AgentQuickResponses);
    expect(texts(fresh).at(-1)).toBe('Ship it');
  });

  it('add_whenTheTextSpansLines_flattensItToOne', () => {
    responses.add('  Rebase   onto main\nthen push  ');

    expect(texts(responses).at(-1)).toBe('Rebase onto main then push');
  });

  it('add_whenBlankOrAlreadySaved_refuses', () => {
    responses.add('Okay');

    expect(responses.add('   \n  ')).toBe(false);
    expect(responses.add('Okay')).toBe(false);
    expect(responses.responses()).toHaveLength(1);
  });

  it('remove_whenCalled_deletesTheResponse', () => {
    responses.add('Okay');
    const target: QuickResponse = responses.responses()[0];

    responses.remove(target.id);

    expect(texts(responses)).not.toContain(target.text);
  });

  it('reorder_whenCalled_movesTheReplyAndPersistsTheNewOrder', () => {
    responses.add('First');
    responses.add('Second');
    responses.add('Third');
    const [first, , third] = responses.responses();

    responses.reorder(third.id, first.id);

    expect(texts(responses)).toEqual(['Third', 'First', 'Second']);

    // The order is the user's arrangement, so it has to outlive the session the dragging happened in.
    TestBed.resetTestingModule();
    const fresh: AgentQuickResponses = TestBed.inject(AgentQuickResponses);
    expect(texts(fresh)).toEqual(['Third', 'First', 'Second']);
  });

  it('reorder_whenAnIdIsUnknownOrTheSame_leavesTheOrderAlone', () => {
    responses.add('First');
    responses.add('Second');
    const [first, second] = responses.responses();

    responses.reorder(first.id, first.id);
    responses.reorder(first.id, 'no-such-id');
    responses.reorder('no-such-id', second.id);

    expect(texts(responses)).toEqual(['First', 'Second']);
  });

  it('remove_whenTheLastOneGoes_staysEmptyAcrossRestarts', () => {
    responses.add('Okay');
    responses.remove(responses.responses()[0].id);
    expect(responses.responses()).toHaveLength(0);

    TestBed.resetTestingModule();
    const fresh: AgentQuickResponses = TestBed.inject(AgentQuickResponses);
    expect(fresh.responses()).toHaveLength(0);
  });
});
