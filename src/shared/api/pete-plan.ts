import { GLOBAL_SCOPE } from './ai/ai-prompt-scope';
import {
  clampConfidence,
  coreLineCount,
  coreLinesOf,
  normalizeTags,
  PERSONA_CORE_LINE_LIMIT,
  personaDay,
  personaIdFor,
  type PersonaEntry,
} from './persona-channels';
import type { PersonaChange, PeteProposal, PeteProposedChange } from './pete-protocol';
import { redactSecrets } from './redaction';

// Turning what the model proposed into changes Studio will make (#1516). The model is asked to keep
// the rules; this is where they are kept whatever it answers, because a model can be wrong, and a
// message the user typed can still carry text written to mislead it. Pure, so it is easy to test and
// the main process can run it on every proposal before anything touches the disk.
// Keep this module platform-neutral (types and pure functions only).

/**
 * The most changes one run may make: a run that wants more is more likely confused than insightful.
 */
export const PETE_CHANGE_LIMIT: number = 20;

/**
 * The most memories a persona holds before Pete may only merge and trim, not add.
 */
export const PETE_MEMORY_LIMIT: number = 1_000;

/**
 * Bounds on what Pete writes into one entry.
 */
const NAME_LIMIT: number = 80;
const TEXT_LIMIT: number = 800;
const WHY_LIMIT: number = 400;
const TAG_LIMIT: number = 8;

/**
 * How much a confirmation raises confidence.
 */
const CONFIRM_STEP: number = 0.2;

/**
 * Wording that grants a permission rather than states a preference. The persona holds preferences,
 * never permissions (#1513 §5.7), so an entry that reads like one is refused however it was proposed.
 */
const PERMISSION_WORDING: RegExp =
  /\b(without (asking|confirm\w*|permission)|no need to (ask|confirm)|don'?t (ask|confirm)|never ask|always allow|auto-?(approve|accept|confirm)|skip (the )?(confirm\w*|prompt|permission)|go ahead and (delete|push|publish|deploy))\b/i;

/**
 * The outcome of planning: the changes to make, and how many proposals were turned away.
 */
export interface PetePlan {
  readonly changes: readonly PersonaChange[];
  readonly refused: number;
}

/**
 * Makes ids for changes; injected so a test can predict them.
 */
export type ChangeIdSource = () => string;

/**
 * Plans the changes a proposal makes to a persona, applying each to a working copy in turn so later
 * proposals see earlier ones. Refuses any proposal that touches a locked entry, concerns a ruled-out
 * topic, reads like a permission, or names an entry that is not there; demotes to a memory anything
 * that would push the core past its limit; and bounds every field.
 * @param entries The persona as it stands.
 * @param proposal What the model proposed.
 * @param ruledOut The topics never to learn about.
 * @param now The moment of the run.
 * @param nextId Makes an id for each change.
 * @returns Returns the plan.
 */
export function planPeteChanges(
  entries: readonly PersonaEntry[],
  proposal: PeteProposal,
  ruledOut: readonly string[],
  now: Date,
  nextId: ChangeIdSource,
): PetePlan {
  const working: Map<string, PersonaEntry> = new Map<string, PersonaEntry>(
    entries.map((entry: PersonaEntry): [string, PersonaEntry] => [entry.id, entry]),
  );
  const changes: PersonaChange[] = [];
  let refused: number = 0;
  const day: string = personaDay(now);
  for (const proposed of proposal.changes.slice(0, PETE_CHANGE_LIMIT)) {
    const planned: PersonaChange | null = planOne(proposed, working, ruledOut, day, now, nextId);
    if (planned === null) {
      refused += 1;
      continue;
    }
    if (planned.after === null) {
      working.delete(planned.entryId);
    } else {
      working.set(planned.entryId, planned.after);
    }
    changes.push(planned);
  }
  refused += Math.max(0, proposal.changes.length - PETE_CHANGE_LIMIT);
  return { changes: collapse(changes), refused };
}

/**
 * Plans one proposed change against the working copy.
 * @param proposed The proposal.
 * @param working The persona with earlier changes applied.
 * @param ruledOut The ruled-out topics.
 * @param day Today.
 * @param now The moment.
 * @param nextId Makes change ids.
 * @returns Returns the change, or null when it is refused.
 */
function planOne(
  proposed: PeteProposedChange,
  working: ReadonlyMap<string, PersonaEntry>,
  ruledOut: readonly string[],
  day: string,
  now: Date,
  nextId: ChangeIdSource,
): PersonaChange | null {
  const at: number = now.getTime();
  const reason: string = clean(proposed.reason ?? '', WHY_LIMIT);
  if (proposed.op === 'add') {
    const name: string = clean(proposed.name ?? '', NAME_LIMIT);
    const text: string = clean(proposed.text ?? '', TEXT_LIMIT);
    if (name.length === 0 || text.length === 0) {
      return null;
    }
    const memories: number = [...working.values()].filter(
      (entry: PersonaEntry): boolean => entry.layer === 'memory',
    ).length;
    if (memories >= PETE_MEMORY_LIMIT) {
      return null;
    }
    const draft: PersonaEntry = {
      id: personaIdFor(name, [...working.keys()]),
      name,
      text,
      why: clean(proposed.why ?? '', WHY_LIMIT),
      tags: normalizeTags(proposed.tags ?? []).slice(0, TAG_LIMIT),
      links: [],
      scope: GLOBAL_SCOPE,
      layer: proposed.layer ?? 'memory',
      enabled: true,
      confidence: clampConfidence(proposed.confidence ?? 0.5),
      confirmed: day,
      author: 'pete',
      locked: false,
    };
    const entry: PersonaEntry = fitCore(draft, working, null);
    if (isForbidden(entry, ruledOut)) {
      return null;
    }
    return { id: nextId(), at, kind: 'add', entryId: entry.id, before: null, after: entry, reason };
  }
  const target: PersonaEntry | undefined =
    proposed.id === undefined ? undefined : working.get(proposed.id);
  if (target === undefined || target.locked) {
    return null;
  }
  if (proposed.op === 'remove') {
    return {
      id: nextId(),
      at,
      kind: 'remove',
      entryId: target.id,
      before: target,
      after: null,
      reason,
    };
  }
  if (proposed.op === 'confirm') {
    const after: PersonaEntry = {
      ...target,
      confidence: clampConfidence(target.confidence + CONFIRM_STEP),
      confirmed: day,
    };
    return {
      id: nextId(),
      at,
      kind: 'change',
      entryId: target.id,
      before: target,
      after,
      reason: reason || 'Seen again.',
    };
  }
  const name: string = clean(proposed.name ?? '', NAME_LIMIT);
  const text: string = clean(proposed.text ?? '', TEXT_LIMIT);
  const draft: PersonaEntry = {
    ...target,
    ...(name.length === 0 ? {} : { name }),
    ...(text.length === 0 ? {} : { text }),
    ...(proposed.why === undefined ? {} : { why: clean(proposed.why, WHY_LIMIT) }),
    ...(proposed.tags === undefined
      ? {}
      : { tags: normalizeTags(proposed.tags).slice(0, TAG_LIMIT) }),
    ...(proposed.layer === undefined ? {} : { layer: proposed.layer }),
    ...(proposed.confidence === undefined
      ? {}
      : { confidence: clampConfidence(proposed.confidence) }),
    confirmed: day,
    author: 'pete',
  };
  const after: PersonaEntry = fitCore(draft, working, target);
  if (isForbidden(after, ruledOut)) {
    return null;
  }
  return { id: nextId(), at, kind: 'change', entryId: target.id, before: target, after, reason };
}

/**
 * Keeps the core within its limit: an entry that would push the enabled core past it is filed as a
 * memory instead. Nothing is cut; it is only moved to where size does not cost every conversation.
 * @param entry The entry as proposed.
 * @param working The persona.
 * @param replacing The entry it replaces, or null for a new one.
 * @returns Returns the entry, in the core only if it fits.
 */
function fitCore(
  entry: PersonaEntry,
  working: ReadonlyMap<string, PersonaEntry>,
  replacing: PersonaEntry | null,
): PersonaEntry {
  if (entry.layer !== 'core' || !entry.enabled) {
    return entry;
  }
  const others: readonly PersonaEntry[] = [...working.values()].filter(
    (other: PersonaEntry): boolean => other.id !== replacing?.id,
  );
  return coreLineCount(others) + coreLinesOf(entry) > PERSONA_CORE_LINE_LIMIT
    ? { ...entry, layer: 'memory' }
    : entry;
}

/**
 * Determines whether an entry may not be written: it concerns a ruled-out topic, or reads like a
 * permission.
 * @param entry The entry.
 * @param ruledOut The ruled-out topics.
 * @returns Returns true when it is forbidden.
 */
export function isForbidden(entry: PersonaEntry, ruledOut: readonly string[]): boolean {
  const content: string = `${entry.name}\n${entry.text}\n${entry.why}\n${entry.tags.join(' ')}`;
  if (PERMISSION_WORDING.test(content)) {
    return true;
  }
  return concernsRuledOut(content, ruledOut);
}

/**
 * Determines whether a text concerns any ruled-out topic: the topic's words all appear in it.
 * @param content The text.
 * @param ruledOut The ruled-out topics.
 * @returns Returns true when it does.
 */
export function concernsRuledOut(content: string, ruledOut: readonly string[]): boolean {
  const lower: string = content.toLowerCase();
  return ruledOut.some((topic: string): boolean => {
    const words: readonly string[] = topic
      .toLowerCase()
      .split(/\s+/)
      .filter((word: string): boolean => word.length > 0);
    return words.length > 0 && words.every((word: string): boolean => lower.includes(word));
  });
}

/**
 * Collapses several changes to one entry into one, so the user reviews one change per entry: an add
 * then an update is an add of the final form; anything then a remove of an entry that was added is
 * nothing at all.
 * @param changes The changes in order.
 * @returns Returns the collapsed changes, in the order each entry was first touched.
 */
function collapse(changes: readonly PersonaChange[]): readonly PersonaChange[] {
  const byEntry: Map<string, PersonaChange> = new Map<string, PersonaChange>();
  for (const change of changes) {
    const earlier: PersonaChange | undefined = byEntry.get(change.entryId);
    if (earlier === undefined) {
      byEntry.set(change.entryId, change);
      continue;
    }
    const before: PersonaEntry | null = earlier.before;
    if (before === null && change.after === null) {
      byEntry.delete(change.entryId);
      continue;
    }
    byEntry.set(change.entryId, {
      ...change,
      kind: before === null ? 'add' : change.after === null ? 'remove' : 'change',
      before,
      reason: [earlier.reason, change.reason]
        .filter((part: string): boolean => part.length > 0)
        .join(' '),
    });
  }
  return [...byEntry.values()];
}

/**
 * Cleans a field the model wrote: secrets removed, whitespace tidied, bounded.
 * @param text The text.
 * @param limit The most characters.
 * @returns Returns the cleaned text.
 */
function clean(text: string, limit: number): string {
  return redactSecrets(text).replace(/\r\n?/g, '\n').trim().slice(0, limit).trim();
}
