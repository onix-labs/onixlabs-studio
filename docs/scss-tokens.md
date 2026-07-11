# SCSS Custom-Property (Design Token) Audit

_Audited: 2026-07-06 · Scope: `src/**/*.{scss,ts,html}` (109 SCSS files + TS-embedded component styles)._

> **Status: Phases 1 & 2 complete (2026-07-06).** The silent-fallback fixes (`--font-mono`,
> `--code-view-grip`, `--warning-color`) and the 7 dead-token deletions are done and committed.
> Phases 3 (palette policy) and 4 (lint guardrail) remain open. Themes are still symmetric (80/80).

## TL;DR — it's healthier than the devtools view suggests

The "lots of missing tokens" seen in devtools is mostly **fallbacks doing their job**, not breakage.
Concretely:

- **No token resolves to empty/invalid.** Every consumed-but-undefined token has a fallback, so
  nothing renders broken.
- **The two themes are perfectly symmetric** — `_theme-light.scss` and `_theme-dark.scss` each
  define the **same 86 tokens**, zero asymmetry. (A token defined in one theme but not the other is
  the classic cause of a "missing" value in devtools; we have none.)
- The real cleanup is small: **~4 intended-themeable tokens silently fall through to fallbacks**,
  **7 tokens are genuinely dead**, and the rest of the "unused" list is **intentional** (vendor API,
  palette scales).

| Metric                                                | Count                             |
| ----------------------------------------------------- | --------------------------------- |
| Distinct tokens **defined** (incl. component + TS)    | ~214                              |
| Distinct tokens **consumed** via `var()`              | ~188                              |
| **Missing** (consumed, never defined) — real          | 3 actionable + 1 intentional hook |
| **Missing** — false positives (actually defined)      | 4                                 |
| **Unused** (defined, never consumed) — genuinely dead | 7                                 |
| **Unused** — intentional (vendor / palette)           | ~24                               |
| **Unused** — false positives (BEM selectors)          | 2                                 |

## Method & caveats

Definitions were collected from SCSS `--x:` declarations, TS `styles: [...]`-embedded CSS,
`element.style.setProperty('--x', …)`, and `[style.--x]` template bindings. Consumers were collected
from every `var(--x, …)` across SCSS/TS/HTML, tracking whether a fallback is present.

Three blind spots produce _apparent_ problems that aren't real, and the audit accounts for them:

1. **Vendor-consumed tokens.** Milkdown Crepe (`--crepe-*`) and Monaco read tokens from their own
   CSS in `node_modules`. A source-only scan sees these as "unused" — they are not.
2. **Runtime-injected tokens.** `--markdown-font-size` is set at runtime by
   `services/milkdown/milkdown.ts` (`getCssCustomProperties()`), so it looks "missing" to a static scan.
3. **BEM pseudo-class selectors.** `&--close:hover` / `&--selected:hover` look like `--close:` /
   `--selected:` declarations to a regex. They are selectors, not tokens.

---

## 1. Missing tokens (consumed but never defined)

### Actionable (works today via fallback, but the theme hook is dead)

| Token              | Uses                             | Current fallback  | Verdict / fix                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | -------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--font-mono`      | 3                                | monospace stacks  | **Add** alongside `--font-sans` in `_variables.scss`. `--font-sans` exists; the mono sibling was never created, so every mono surface hardcodes its own stack.                                                                                                                                                                                                                         |
| `--warning-color`  | 2 (`agent-chat.scss:167,228`)    | `#e0a030`         | **Add a semantic color set.** There are _no_ semantic status tokens (`--warning/-error/-success/-info-color`) at all. Introduce them (theme-aware) and repoint.                                                                                                                                                                                                                        |
| `--code-view-grip` | 1 (`code-terminal-panel.scss:3`) | `var(--gray-200)` | **Name-mismatch bug.** The comment says the grip "is defined on the code-view host," but `code-view.scss` defines `--code-view-background` (gray-100 / gray-900), _not_ `--code-view-grip`. The terminal bar therefore silently uses gray-200 and the intended "one surface" look is broken. Fix: consume `--code-view-background`, or actually define `--code-view-grip` on the host. |

### Intentional (keep as-is)

| Token                       | Uses                    | Fallback | Note                                          |
| --------------------------- | ----------------------- | -------- | --------------------------------------------- |
| `--dropdown-menu-max-items` | 1 (`dropdown.scss:108`) | `16`     | Deliberate numeric override hook; fine unset. |

### False positives — actually defined, no action

- `--markdown-font-size` — runtime-injected (`milkdown.ts:78`).
- `--tool-panel-bar-background`, `--tool-panel-bar-foreground`, `--tool-panel-body-background` —
  defined in `markdown-tool-panel.ts` embedded styles (light `:host` base + `data-theme-mode='dark'`
  override). The scan didn't parse TS-embedded CSS _definitions_.

---

## 2. Unused tokens (defined but never consumed)

### Genuinely dead — safe to delete

Each is defined but has **0 `var()` consumers** anywhere in source. Theme entries are duplicated
across light + dark.

| Token                                       | Where       | Why dead                                                                              |
| ------------------------------------------- | ----------- | ------------------------------------------------------------------------------------- |
| `--dock-tab-background-color`               | both themes | Only the `--active` variant is consumed; the base bg is `transparent`.                |
| `--dock-tabstrip-background-color`          | both themes | The tabstrip is `background: transparent`; this was never wired.                      |
| `--title-strip-button-background-color`     | both themes | Only the `--hover` variant is used.                                                   |
| `--ribbon-divider-color`                    | both themes | No consumer.                                                                          |
| `--ribbon-control-background-color--active` | both themes | No consumer.                                                                          |
| `--welcome-backdrop-color`                  | both themes | Superseded — the welcome screen sets its own backdrop / now `--modal-backdrop-color`. |
| `--welcome-panel-background-color`          | both themes | Welcome uses `--modal-panel-background` (gradient) instead.                           |

### Intentional — keep (document, optionally prune)

| Group                           | Tokens                                                                                                                                      | Rationale                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Milkdown Crepe vendor API**   | `--crepe-color-{hover,inline-area,inline-code,inverse,on-inverse,on-secondary,secondary,selected,surface-low}`, `--crepe-font-{code,title}` | Consumed by Crepe's own CSS in `node_modules`. **Do not delete.**                                                                                                      |
| **Accent palette primitives**   | `--accent-{coral,cyan,green,orange,pink,teal,purple}-rgb`, `--accent-purple`                                                                | Exposed by design (see `_variables.scss` comment) as hex + RGB triplet for future accent fills/overlays. Keep for completeness, or prune the ones with no roadmap use. |
| **Neutral scale intermediates** | `--gray-{150,250,350,750,850,950}`                                                                                                          | Added this session to complete the 50-step scale; `-450/-550/-650` are already wired. Keep as scale.                                                                   |

### False positives — not real tokens

- `--close` (`window-controls.scss:34`) and `--selected` (`settings-view.scss:65`) are `&--close:hover`
  / `&--selected:hover` BEM selectors.

---

## 3. Remediation plan

**Phase 1 — Fix the silent fallbacks (small, correctness). ✅ Done 2026-07-06.**

1. ✅ Added `--font-mono` to `_variables.scss` (`:root`, JetBrains-Mono-led stack) and repointed the
   3 consumers (`problems-panel`, `agent-chat` ×2) to drop their hardcoded stacks.
2. ✅ Fixed `--code-view-grip`: the code-view host only ever defined `--code-view-background` and no
   grip token/element exists, so the dangling indirection was removed and `code-terminal-panel.scss`
   now sets its bar colour directly (unchanged values), with a corrected comment.
3. ✅ Added a theme-aware `--warning-color` (light `#b7791f`, dark `#e0a030`) to both themes and
   repointed the 2 `agent-chat` uses. `--error/--success/--info` were **not** added — nothing
   consumes them yet, and adding them would just create new dead tokens (the comment marks where to
   grow the set). `change-margin-*` and the platform-convention window-close red stay as-is.

**Phase 2 — Delete dead tokens (pure removal). ✅ Done 2026-07-06.**
Removed all 7 genuinely-dead tokens from both `_theme-light.scss` and `_theme-dark.scss`
(`--dock-tab-background-color`, `--dock-tabstrip-background-color`,
`--title-strip-button-background-color`, `--ribbon-divider-color`,
`--ribbon-control-background-color--active`, `--welcome-backdrop-color`,
`--welcome-panel-background-color`). No consumers, zero visual change; themes remain symmetric.

**Phase 3 — Decide palette policy (design call).**
Either (a) keep the full accent-RGB + gray-scale primitives as an intentional, documented palette,
or (b) prune primitives with no consumer and re-add on demand. Record the decision here so the next
audit doesn't re-flag them.

**Phase 4 — Guardrail (prevent regression).**
Add a lint step (CI or pre-commit) that re-runs this cross-reference and fails on a **new**
no-fallback missing token or a **new** dead theme token — with an allowlist for the intentional
vendor/palette groups above. The audit is a ~120-line script; see commit history for the throwaway
version used here.

---

## Appendix — reproducing the audit

The scan is a straightforward cross-reference: collect every `--x:` definition (SCSS + TS-embedded
CSS + `setProperty` + `[style.--x]`), collect every `var(--x, …)` consumer (tracking fallback
presence), then diff the two sets. Remember to exclude the three blind spots in _Method & caveats_
before trusting either list, and to diff `_theme-light` vs `_theme-dark` token names for asymmetry.
