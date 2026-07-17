# Tests & Improvements — Mission Control / Agent (2026-07-17)

A working log of the performance fixes and the test coverage added for the recent
Mission Control "live agent rail" work, plus the gaps still worth filling.

## 1. Performance improvements (shipped)

### 1.1 Backgrounded agent mirrors no longer render per token
**Commit:** `a0f8b0b`

**Symptom:** the whole UI became sluggish, worst while an agent was streaming.

**Root cause:** views are mount-all / hide-inactive and the app is zoneless, so once
Mission Control had been opened it stayed mounted, and it mirrors *every* live agent
as a full `AgentChat`. On each streaming token every mirror re-folded its transcript,
re-parsed the growing message as markdown, and wrote `scrollTop`/`scrollHeight` — even
while backgrounded or hidden. With N agents that was N wasted full renders per token,
app-wide.

**Fix:** gate the tile's mirror body on `@if (active() && !hidden())`
(`mission-control-agent-tile.html`). A backgrounded view or a hidden (Hide Idle/Empty)
tile now mounts no chat and does zero per-token work; the tile stays registered so the
rail can still scroll to its column, and focus mode keeps its own `focusOpen()`-gated
copy.

**Verified (CDP):** with two agents, mirror chats counted 2 (MC active) → 0
(backgrounded) → 2 (reactivated).

### 1.2 The always-mounted rail stopped rebuilding per token
**Commit:** `a0f8b0b`

**Root cause:** `mission-control-panel.items()` read `host.agent.items().length` for
every host, so one token from one agent rebuilt the whole rail array (and, after the
ListView migration, re-mapped it into `rows()`), continuously, in the background.

**Fix:** added a memoized `Agent.hasMessages` signal and read it in the rail's status
label instead of `items().length`. The boolean is stable across a run, so the rail no
longer takes a per-token dependency on any transcript.

### 1.3 Rail refactor (same commit)
The agent rail now renders through the shared `ListView` (edge-to-edge rows, 1rem
content padding) rather than a hand-rolled `<ul>`.

### 1.4 Follow-up refinements (done)
- **`MissionControlTiles.refreshSpacer()` now dedupes its write.** It builds the target
  `flex` value and only assigns `spacer.style.flex` when it differs from the live inline
  value, so a no-op `ResizeObserver` tick or a repeated render no longer invalidates
  layout. Correct even if the engine normalises the string (a mismatch just writes, as
  before). Covered by `mission-control-tiles.spec.ts`.
- **The streaming transcript append is now tail-targeted.** `appendText` folds a chunk
  into the trailing item via a new `Agent.updateLast()` (a single tail copy) instead of
  `update(id, …)`'s whole-array `.map` predicate pass on every token. The other callers
  (tool end, sub-agent tokens, dismiss) keep `update(id, …)` since they target arbitrary
  items. The O(n) array copy is unavoidable for signal identity, but the per-token
  per-element scan is gone. Existing `agent.spec.ts` streaming tests cover it.

## 2. Tests added

Vitest (`@angular/build:unit-test`). Naming follows the repo convention
`method_whenCondition_expected`. Full suite green after each batch.

| Spec | Tests | Commit | Covers |
| --- | --- | --- | --- |
| `mission-control-view/mission-control-tiles.spec.ts` | 12 | `5ad4ca9` | Scroll registry + left-align spacer maths: register/unregister identity guards, into-view vs absolute-left reveal, spacer sizing (fits / overflows / ignores off-screen columns) |
| `mission-control-view/mission-control-panel/mission-control-panel.spec.ts` | 7 | `5ad4ca9` | Rail renders via shared ListView, `hasMessages`-driven status label (Working/Idle/Ready), row-click → reveal |
| `mission-control-view/mission-control-agent-tile/mission-control-agent-tile.spec.ts` | 8 | `5ad4ca9` | The `isEmpty`/`isIdle`/`hidden` state that gates the mirror body (the perf fix), read without mounting the heavy child tree |
| `services/agent/agent.spec.ts` (added) | 2 | `5ad4ca9` | The new `hasMessages` signal |
| `services/agent-hosts/agent-hosts.spec.ts` | 7 | `f76149b` | The app-wide live-host registry: id assignment + order, **dedup-by-agent** guard, re-registration after unregister, per-host unregister, `runningCount`, `stopAll` (running only) |
| `components/agent-request-card/agent-request-card.spec.ts` | 6 | `f76149b` | Heading per request kind (permission / edit-decision / question + fallbacks) and each action routing to the right `respond*` on the entry's agent/item |
| `mission-control-view/mission-control-view.spec.ts` | 5 | `29796e4` | `injectorFor` caching (same injector per host → tiles not rebuilt) and provider resolution (Agent / AgentConversation / AGENT_HOST resolve to the host's own instances); `tileInputs` forwards `isActive` |
| `mission-control-ribbon/mission-control-ribbon.spec.ts` | 10 | _pending_ | `runningCount` / `pendingPermissions` / `policyLabel` computeds; bulk actions (Stop All, Allow/Deny All answer only permission requests), reset widths, Hide Empty/Idle toggles, and policy-label → posture mapping |
| `services/agent-hosts/agent-host-registration.spec.ts` | 4 | `84a8d4f` | `createAgentHostRegistrar` registers the host + request source with the right agent/surface/tab attribution, resolves the label reactively (rename + fallback to "Agent"), and unregisters from both registries on destroy |
| `electron/ai/claude-agent-provider.spec.ts` | 11 | _pending_ | `describeAvailability` (local login / API key / neither); message translation (text/thinking/tool-start with subagent_type, tool-end success+failure); and the **`df8d0d3` occupancy/cost path** — result reports the assistant snapshot (not the inflated aggregate), cost as a per-turn delta, sub-agent usage on its own lane without touching top-level occupancy, and the no-assistant fallback |

**Total: 72 tests across 10 files.** Full suite: 295 files / 2033 passing.

### Testing techniques worth reusing
- **Read component computeds without rendering.** `mission-control-agent-tile` mirrors a
  heavy `AgentChat` subtree; the spec `createComponent`s it but never `detectChanges()`,
  then reads the derived signals (`hidden`, `isEmpty`, …) directly via a cast. This
  exercises the gating logic without instantiating the child tree.
- **Fake DOM elements for layout maths.** `mission-control-tiles` measures real geometry
  (`offsetWidth`, `getBoundingClientRect`, `scrollBy`); the spec passes plain objects
  cast to `HTMLElement` with the needed props/recorders, so the scroll/spacer logic is
  testable without a layout engine.
- **Component input + recorded stubs.** `agent-request-card` is rendered via
  `componentRef.setInput('entry', …)`; its agent stub records `respond*` calls so a
  click can be traced to the right answer on the right item.

## 3. Remaining test gaps (recent work)

None outstanding for this pass. The Mission Control / agent live-rail work that prompted
it is now covered end-to-end (tiles registry, rail panel, tile state, view injectors,
ribbon actions, host registration, and the provider's usage/occupancy path).

`Display` / `modernUiFeatures` is **already covered** by `display.spec.ts` (the
`applyDisplayPolicy` resolution — `off`→reduce, `on`→full, `auto`→GPU recommendation —
asserted via the `data-corners` / `data-reduced-gpu` root attributes), so it is not a gap.

Partially covered:
- **`mission-control-view.ts`** — the cached per-host injectors and `tileInputs` are now
  unit-tested (`mission-control-view.spec.ts`). The `afterRenderEffect` + `ResizeObserver`
  + spacer wiring is **not** unit-tested (it needs the row and tiles to actually render);
  it was exercised via CDP during the perf verification and is better covered there than
  in jsdom.

## 4. Note: welcome-screen paint cost (resolved)

The welcome-screen paint sluggishness was chased down and **resolved separately** (the
fix lived outside this test/perf batch). Background for context: the `Display` service
resolves `appearance.modernUiFeatures` (`auto`/`on`/`off`) against a GPU-derived
recommendation and toggles `data-corners='round'` / `data-reduced-gpu` on the root; the
"full" path enables `corner-shape: squircle` on ~62 element types plus the heavier
decorative effects (e.g. the welcome glow — two ~700px blobs each `filter: blur(6rem)`).
These are paint/GPU-bound (they cost even at ~0% JS CPU) and scale with painted area × DPR.
The resolution logic itself is covered by `display.spec.ts`.
