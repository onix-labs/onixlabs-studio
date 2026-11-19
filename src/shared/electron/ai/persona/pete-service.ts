import { BrowserWindow, ipcMain, IpcMainInvokeEvent } from 'electron';
import type {
  AgentConversationSummary,
  StoredAgentConversation,
} from '@shared/api/agent-conversation-channels';
import { normalizeTags, personaIdFor, type PersonaEntry } from '@shared/api/persona-channels';
import { planPeteChanges, type PetePlan } from '@shared/api/pete-plan';
import {
  PETE_BATCH_CHARACTERS,
  PETE_MESSAGE_CHARACTERS,
  PeteChannel,
  readChange,
  type PersonaChange,
  type PersonaReviewMode,
  type PeteAnswerRequest,
  type PeteBatch,
  type PeteBeginRequest,
  type PeteExcerpt,
  type PeteFinishRequest,
  type PeteOutcome,
  type PeteProposal,
  type PeteProposedChange,
  type PeteQuestion,
  type PeteReviewRequest,
  type PeteState,
} from '@shared/api/pete-protocol';
import { redactSecrets } from '@shared/api/redaction';
import { GLOBAL_SCOPE } from '@shared/api/ai-types';
import { logger } from '@shared/electron/logger';
import type { PersonaLibrary } from './persona-library';
import { PeteStore, type PeteRecords } from './pete-store';

/**
 * The conversations, as far as Pete reads them.
 */
export interface PeteConversationSource {
  listAll(): readonly AgentConversationSummary[];
  load(id: unknown): Promise<StoredAgentConversation | null>;
}

/**
 * How long a claimed batch is held for one run before another window may claim the messages again.
 */
const CLAIM_MS: number = 10 * 60_000;

/**
 * How many failed runs on a conversation's messages before they are marked read and passed over.
 */
const FAILURE_LIMIT: number = 3;

/**
 * A batch handed out and not yet finished.
 */
interface Claim {
  readonly batchId: string;
  readonly excerpts: readonly PeteExcerpt[];
  readonly expires: number;
}

/**
 * Pete's side in the main process (#1516, #1517): hands out what the user typed that he has not read,
 * checks what the model proposed against the rules before any of it lands, applies it or holds it for
 * review as the user chose, and keeps the history that lets each change be looked through and undone.
 *
 * ⛔ Only the user's own messages are read: the transcript's `user` items. Tool output, fetched pages,
 * file contents and the agent's replies never reach Pete, so text written to mislead a model cannot be
 * copied into a persona every future session reads (#1513 §3, "What Pete reads").
 */
export class PeteService {
  /**
   * Holds the batch a run is working on, or null.
   */
  private claim: Claim | null = null;

  /**
   * Initializes a new instance of the {@link PeteService} class.
   * @param library The persona.
   * @param store Pete's records.
   * @param conversations The conversations.
   * @param personaChanged Tells the windows the persona changed.
   * @param now The clock, injected for tests.
   */
  public constructor(
    private readonly library: PersonaLibrary,
    private readonly store: PeteStore,
    private readonly conversations: PeteConversationSource,
    private readonly personaChanged: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Registers the IPC handlers.
   */
  public register(): void {
    logger.info('PeteService', 'Registering Pete IPC handlers');
    ipcMain.handle(
      PeteChannel.Begin,
      (_event: IpcMainInvokeEvent, value: unknown): Promise<PeteBatch | null> =>
        this.begin(readBegin(value)),
    );
    ipcMain.handle(
      PeteChannel.Finish,
      async (_event: IpcMainInvokeEvent, value: unknown): Promise<PeteOutcome | null> => {
        const request: PeteFinishRequest | null = readFinish(value);
        return request === null ? null : this.finish(request);
      },
    );
    ipcMain.handle(
      PeteChannel.Abandon,
      (_event: IpcMainInvokeEvent, value: unknown): Promise<void> =>
        typeof value === 'string' ? this.abandon(value) : Promise.resolve(),
    );
    ipcMain.handle(PeteChannel.State, (): Promise<PeteState> => this.store.state());
    ipcMain.handle(
      PeteChannel.Undo,
      (_event: IpcMainInvokeEvent, value: unknown): Promise<boolean> =>
        typeof value === 'string' ? this.undo(value) : Promise.resolve(false),
    );
    ipcMain.handle(
      PeteChannel.Review,
      (_event: IpcMainInvokeEvent, value: unknown): Promise<number> => {
        const request: PeteReviewRequest | null = readReview(value);
        return request === null ? Promise.resolve(0) : this.review(request);
      },
    );
    ipcMain.handle(
      PeteChannel.RuleOut,
      (_event: IpcMainInvokeEvent, value: unknown): Promise<void> =>
        Array.isArray(value)
          ? this.ruleOut(value.filter((item: unknown): item is string => typeof item === 'string'))
          : Promise.resolve(),
    );
    ipcMain.handle(
      PeteChannel.AnswerQuestion,
      (_event: IpcMainInvokeEvent, value: unknown): Promise<boolean> => {
        const request: PeteAnswerRequest | null = readAnswer(value);
        return request === null ? Promise.resolve(false) : this.answer(request);
      },
    );
  }

  /**
   * Claims the next batch of unread messages: from conversations idle for long enough (or the one
   * named), oldest first, until the batch is full.
   * @param request What to read.
   * @returns Returns the batch, or null when there is nothing to read or a run already holds a claim.
   */
  public async begin(request: PeteBeginRequest): Promise<PeteBatch | null> {
    const now: number = this.now();
    if (this.claim !== null && this.claim.expires > now) {
      logger.debug('PeteService.begin', 'A run already holds a batch');
      return null;
    }
    const records: PeteRecords = await this.store.read();
    const cutoff: number = now - Math.max(0, request.idleMinutes) * 60_000;
    const candidates: readonly AgentConversationSummary[] = this.conversations
      .listAll()
      .filter((summary: AgentConversationSummary): boolean =>
        request.conversationId === null
          ? summary.updatedAt <= cutoff
          : summary.id === request.conversationId,
      )
      .slice()
      .sort(
        (a: AgentConversationSummary, b: AgentConversationSummary): number =>
          a.updatedAt - b.updatedAt,
      );
    const excerpts: PeteExcerpt[] = [];
    let budget: number = PETE_BATCH_CHARACTERS;
    for (const summary of candidates) {
      if (budget <= 0) {
        break;
      }
      const conversation: StoredAgentConversation | null = await this.conversations.load(
        summary.id,
      );
      if (conversation === null) {
        continue;
      }
      const read: ReadonlySet<string> = new Set<string>(records.read[summary.id] ?? []);
      const excerpt: PeteExcerpt | null = excerptOf(summary.id, conversation.items, read, budget);
      if (excerpt !== null) {
        excerpts.push(excerpt);
        budget -= excerpt.messages.reduce(
          (total: number, message: string): number => total + message.length,
          0,
        );
      }
    }
    if (excerpts.length === 0) {
      return null;
    }
    const batchId: string = PeteStore.newId();
    this.claim = { batchId, excerpts, expires: now + CLAIM_MS };
    const persona: readonly PersonaEntry[] = (await this.library.list()).entries;
    logger.info(
      'PeteService.begin',
      `Batch ${batchId}: ${excerpts.length} conversation(s), ${excerpts.reduce((total: number, excerpt: PeteExcerpt): number => total + excerpt.messages.length, 0)} message(s)`,
    );
    return {
      batchId,
      persona,
      ruledOut: records.ruledOut,
      openQuestions: records.questions.map((question: PeteQuestion): string => question.text),
      excerpts,
    };
  }

  /**
   * Finishes a run: checks what the model proposed, applies it or holds it for review, and marks the
   * batch's messages read.
   * @param request The model's proposal for a batch.
   * @returns Returns what was done, or null when the batch is not the one claimed.
   */
  public async finish(request: PeteFinishRequest): Promise<PeteOutcome | null> {
    const claim: Claim | null = this.claim;
    if (claim?.batchId !== request.batchId) {
      logger.warn('PeteService.finish', `Batch ${request.batchId} is not the one claimed`);
      return null;
    }
    this.claim = null;
    const outcome: PeteOutcome = await this.land(request.proposal, request.review, claim.excerpts);
    logger.info(
      'PeteService.finish',
      `Batch ${request.batchId}: ${outcome.applied} applied, ${outcome.pending} for review, ${outcome.refused} refused`,
    );
    this.announce(outcome.applied > 0);
    return outcome;
  }

  /**
   * Gives a batch back unread after the model failed. Messages that keep failing are marked read after
   * a few tries, so one bad conversation cannot stop Pete for good.
   * @param batchId The batch.
   * @returns Resolves once recorded.
   */
  public async abandon(batchId: string): Promise<void> {
    const claim: Claim | null = this.claim;
    if (claim?.batchId !== batchId) {
      return;
    }
    this.claim = null;
    await this.store.update((records: PeteRecords): [PeteRecords, void] => {
      const failures: Record<string, number> = { ...records.failures };
      const read: Record<string, readonly string[]> = { ...records.read };
      for (const excerpt of claim.excerpts) {
        const count: number = (failures[excerpt.conversationId] ?? 0) + 1;
        if (count >= FAILURE_LIMIT) {
          logger.warn('PeteService.abandon', 'Passing over messages that failed repeatedly');
          read[excerpt.conversationId] = [
            ...(read[excerpt.conversationId] ?? []),
            ...excerpt.messageIds,
          ];
          delete failures[excerpt.conversationId];
        } else {
          failures[excerpt.conversationId] = count;
        }
      }
      return [{ ...records, failures, read }, undefined];
    });
  }

  /**
   * Undoes a change Pete made: the entry goes back to what it was before.
   * @param changeId The change.
   * @returns Returns true when it was undone.
   */
  public async undo(changeId: string): Promise<boolean> {
    const undone: boolean = await this.store.update(
      async (records: PeteRecords): Promise<[PeteRecords, boolean]> => {
        const change: PersonaChange | undefined = records.recent.find(
          (candidate: PersonaChange): boolean => candidate.id === changeId,
        );
        if (change === undefined) {
          return [records, false];
        }
        await this.restore(change.entryId, change.before);
        return [
          {
            ...records,
            recent: records.recent.filter(
              (candidate: PersonaChange): boolean => candidate !== change,
            ),
          },
          true,
        ];
      },
    );
    if (undone) {
      this.announce(true);
    }
    return undone;
  }

  /**
   * Accepts and rejects changes waiting for review. An accepted change whose entry the user has since
   * locked is dropped: the lock is the later word.
   * @param request The decision.
   * @returns Returns how many were applied.
   */
  public async review(request: PeteReviewRequest): Promise<number> {
    const accept: ReadonlySet<string> = new Set<string>(request.accept);
    const reject: ReadonlySet<string> = new Set<string>(request.reject);
    const applied: number = await this.store.update(
      async (records: PeteRecords): Promise<[PeteRecords, number]> => {
        const landed: PersonaChange[] = [];
        for (const change of records.pending) {
          if (!accept.has(change.id)) {
            continue;
          }
          const current: PersonaEntry | null = await this.library.read(change.entryId);
          if (current?.locked === true) {
            continue;
          }
          await this.restore(change.entryId, change.after);
          landed.push({ ...change, at: this.now() });
        }
        return [
          {
            ...records,
            pending: records.pending.filter(
              (change: PersonaChange): boolean => !accept.has(change.id) && !reject.has(change.id),
            ),
            recent: [...records.recent, ...landed],
          },
          landed.length,
        ];
      },
    );
    this.announce(applied > 0);
    return applied;
  }

  /**
   * Sets the topics Pete never learns about.
   * @param topics The topics.
   * @returns Resolves once recorded.
   */
  public async ruleOut(topics: readonly string[]): Promise<void> {
    const cleaned: readonly string[] = [
      ...new Set<string>(
        topics
          .map((topic: string): string => topic.trim().slice(0, 100))
          .filter((topic: string): boolean => topic.length > 0),
      ),
    ].slice(0, 100);
    await this.store.update((records: PeteRecords): [PeteRecords, void] => [
      { ...records, ruledOut: cleaned },
      undefined,
    ]);
    this.announce(false);
  }

  /**
   * Answers one of Pete's questions, or dismisses it with an empty answer. An answer becomes a memory
   * the user wrote, locked like anything else they write; Pete reads it on his next run and can work
   * the reason into the entries it explains.
   * @param request The answer.
   * @returns Returns true when the question was there.
   */
  public async answer(request: PeteAnswerRequest): Promise<boolean> {
    const question: PeteQuestion | null = await this.store.update(
      (records: PeteRecords): [PeteRecords, PeteQuestion | null] => {
        const found: PeteQuestion | undefined = records.questions.find(
          (candidate: PeteQuestion): boolean => candidate.id === request.questionId,
        );
        return found === undefined
          ? [records, null]
          : [
              {
                ...records,
                questions: records.questions.filter(
                  (candidate: PeteQuestion): boolean => candidate !== found,
                ),
              },
              found,
            ];
      },
    );
    if (question === null) {
      return false;
    }
    const answer: string = redactSecrets(request.answer).trim().slice(0, 800);
    if (answer.length > 0) {
      const ids: readonly string[] = await this.library.ids();
      const entry: PersonaEntry = {
        id: personaIdFor(question.text.slice(0, 60), ids),
        name: question.text.slice(0, 80),
        text: answer,
        why: '',
        tags: normalizeTags(['answers']),
        links: [],
        scope: GLOBAL_SCOPE,
        layer: 'memory',
        enabled: true,
        confidence: 1,
        confirmed: new Date(this.now()).toISOString().slice(0, 10),
        author: 'user',
        locked: true,
      };
      await this.library.save(entry);
    }
    this.announce(answer.length > 0);
    return true;
  }

  /**
   * Gets Pete's records for the Persona page.
   * @returns Returns them.
   */
  public state(): Promise<PeteState> {
    return this.store.state();
  }

  /**
   * Lands a proposal: plans it against the persona and the rules, applies it or holds it, records the
   * questions, and marks the messages read.
   * @param proposal The proposal.
   * @param review Whether changes apply at once or wait.
   * @param excerpts What was read.
   * @returns Returns what was done.
   */
  private async land(
    proposal: PeteProposal,
    review: PersonaReviewMode,
    excerpts: readonly PeteExcerpt[],
  ): Promise<PeteOutcome> {
    return this.store.update(async (records: PeteRecords): Promise<[PeteRecords, PeteOutcome]> => {
      const persona: readonly PersonaEntry[] = (await this.library.list()).entries;
      const plan: PetePlan = planPeteChanges(
        persona,
        proposal,
        records.ruledOut,
        new Date(this.now()),
        (): string => PeteStore.newId(),
      );
      if (review === 'automatic') {
        for (const change of plan.changes) {
          await this.restore(change.entryId, change.after);
        }
      }
      const read: Record<string, readonly string[]> = { ...records.read };
      const failures: Record<string, number> = { ...records.failures };
      for (const excerpt of excerpts) {
        read[excerpt.conversationId] = [
          ...(read[excerpt.conversationId] ?? []),
          ...excerpt.messageIds,
        ];
        delete failures[excerpt.conversationId];
      }
      const known: ReadonlySet<string> = new Set<string>(
        this.conversations.listAll().map((summary: AgentConversationSummary): string => summary.id),
      );
      for (const conversation of Object.keys(read)) {
        if (!known.has(conversation)) {
          delete read[conversation];
        }
      }
      const asked: ReadonlySet<string> = new Set<string>(
        records.questions.map((question: PeteQuestion): string => question.text.toLowerCase()),
      );
      const questions: readonly PeteQuestion[] = [
        ...records.questions,
        ...proposal.questions
          .filter((text: string): boolean => !asked.has(text.toLowerCase()))
          .map((text: string): PeteQuestion => ({
            id: PeteStore.newId(),
            text: redactSecrets(text),
            asked: this.now(),
          })),
      ];
      const next: PeteRecords = {
        ...records,
        read,
        failures,
        questions,
        lastRun: this.now(),
        recent: review === 'automatic' ? [...records.recent, ...plan.changes] : records.recent,
        pending: review === 'automatic' ? records.pending : [...records.pending, ...plan.changes],
      };
      return [
        next,
        {
          applied: review === 'automatic' ? plan.changes.length : 0,
          pending: review === 'automatic' ? 0 : plan.changes.length,
          refused: plan.refused,
          messagesRead: excerpts.reduce(
            (total: number, excerpt: PeteExcerpt): number => total + excerpt.messageIds.length,
            0,
          ),
        },
      ];
    });
  }

  /**
   * Puts an entry into a given state: written, or removed when there is none.
   * @param entryId The entry.
   * @param entry The state, or null to remove it.
   * @returns Resolves once on disk.
   */
  private async restore(entryId: string, entry: PersonaEntry | null): Promise<void> {
    if (entry === null) {
      await this.library.delete(entryId);
      return;
    }
    const error: string | null = await this.library.save(entry);
    if (error !== null) {
      logger.warn('PeteService.restore', `Could not write entry ${entryId}: ${error}`);
    }
  }

  /**
   * Tells the windows Pete's records changed, and the persona too when it did.
   * @param persona Whether the persona changed.
   */
  private announce(persona: boolean): void {
    if (persona) {
      this.personaChanged();
    }
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(PeteChannel.Changed);
      }
    }
  }
}

/**
 * Picks out the messages the user typed that have not been read: the transcript's `user` items, and
 * nothing else. Each is cleaned of secrets and cut to length; the excerpt stops at the budget.
 * @param conversationId The conversation.
 * @param items The transcript.
 * @param read The ids already read.
 * @param budget The most characters to take.
 * @returns Returns the excerpt, or null when nothing is unread.
 */
export function excerptOf(
  conversationId: string,
  items: readonly unknown[],
  read: ReadonlySet<string>,
  budget: number,
): PeteExcerpt | null {
  const messageIds: string[] = [];
  const messages: string[] = [];
  let used: number = 0;
  for (const item of items) {
    if (item === null || typeof item !== 'object') {
      continue;
    }
    const record: Record<string, unknown> = item as Record<string, unknown>;
    const id: unknown = record['id'];
    const text: unknown = record['text'];
    if (
      record['kind'] !== 'user' ||
      typeof id !== 'string' ||
      typeof text !== 'string' ||
      read.has(id)
    ) {
      continue;
    }
    const cleaned: string = redactSecrets(text).trim().slice(0, PETE_MESSAGE_CHARACTERS);
    if (used + cleaned.length > budget && messages.length > 0) {
      break;
    }
    messageIds.push(id);
    if (cleaned.length > 0) {
      messages.push(cleaned);
      used += cleaned.length;
    }
  }
  return messageIds.length === 0 ? null : { conversationId, messageIds, messages };
}

/**
 * Reads a Begin request out of untrusted input.
 * @param value The value.
 * @returns Returns the request, defaulting to every idle conversation.
 */
function readBegin(value: unknown): PeteBeginRequest {
  const record: Record<string, unknown> =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const idle: unknown = record['idleMinutes'];
  const conversation: unknown = record['conversationId'];
  return {
    idleMinutes:
      typeof idle === 'number' && Number.isFinite(idle) ? Math.min(Math.max(idle, 0), 10_080) : 30,
    conversationId:
      typeof conversation === 'string' && conversation.length > 0 ? conversation : null,
  };
}

/**
 * Reads a Finish request out of untrusted input.
 * @param value The value.
 * @returns Returns the request, or null when malformed.
 */
function readFinish(value: unknown): PeteFinishRequest | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const proposal: unknown = record['proposal'];
  if (typeof record['batchId'] !== 'string' || proposal === null || typeof proposal !== 'object') {
    return null;
  }
  const fields: Record<string, unknown> = proposal as Record<string, unknown>;
  const changes: PeteProposedChange[] = [];
  for (const item of Array.isArray(fields['changes'])
    ? (fields['changes'] as unknown[]).slice(0, 100)
    : []) {
    const change: PeteProposedChange | null = readChange(item);
    if (change !== null) {
      changes.push(change);
    }
  }
  const questions: readonly string[] = (
    Array.isArray(fields['questions']) ? (fields['questions'] as unknown[]) : []
  )
    .filter((question: unknown): question is string => typeof question === 'string')
    .map((question: string): string => question.slice(0, 300))
    .slice(0, 2);
  return {
    batchId: record['batchId'],
    proposal: { changes, questions },
    review: record['review'] === 'automatic' ? 'automatic' : 'ask',
  };
}

/**
 * Reads a review decision out of untrusted input.
 * @param value The value.
 * @returns Returns the decision, or null when malformed.
 */
function readReview(value: unknown): PeteReviewRequest | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  const ids: (key: string) => readonly string[] = (key: string): readonly string[] =>
    Array.isArray(record[key])
      ? (record[key] as unknown[]).filter((id: unknown): id is string => typeof id === 'string')
      : [];
  return { accept: ids('accept'), reject: ids('reject') };
}

/**
 * Reads an answer out of untrusted input.
 * @param value The value.
 * @returns Returns the answer, or null when malformed.
 */
function readAnswer(value: unknown): PeteAnswerRequest | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const record: Record<string, unknown> = value as Record<string, unknown>;
  return typeof record['questionId'] === 'string' && typeof record['answer'] === 'string'
    ? { questionId: record['questionId'], answer: record['answer'] }
    : null;
}
