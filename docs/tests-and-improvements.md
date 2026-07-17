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

### 1.4 Not addressed (deliberate)
- `MissionControlTiles.refreshSpacer()` does a forced layout read (`offsetWidth`/
  `clientWidth`), but only on resize / host-set change — frequency-bound, reads batched
  before the single write. Minor.
- The origin transcript's O(n)-per-token `log.update(...map)` is **pre-existing**, not
  part of this regression. Converting it to append-oriented updates is a separate win.

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
| `mission-control-view/mission-control-view.spec.ts` | 5 | _pending_ | `injectorFor` caching (same injector per host → tiles not rebuilt) and provider resolution (Agent / AgentConversation / AGENT_HOST resolve to the host's own instances); `tileInputs` forwards `isActive` |

**Total: 47 tests across 7 files.** Full suite: 292 files / 2008 passing.

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

In rough priority order:

1. **`mission-control-ribbon.ts`**, **`agent-host-registration.ts`** — untested.
2. **`claude-agent-provider.ts`** (main process) — the usage/occupancy snapshot path
   from `df8d0d3` is untested.

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

Still worth doing when convenient: `Display` / `modernUiFeatures` have **no unit tests**
(the `applyDisplayPolicy` resolution — `off`→reduce, `on`→full, `auto`→GPU recommendation —
is pure and easily testable).
