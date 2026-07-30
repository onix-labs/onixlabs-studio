# Control refactor — every control becomes an atom

## The rule

**A feature template never writes a raw `<button>`, `<input>`, `<select>`, `<textarea>`, checkbox or
radio.** It uses the atom from `src/shared/angular/components/forms/`, and the atom owns the styling.
A call site may pass a _variant_; it may never restyle a control locally. Where no atom exists, the
atom gets written — the element is not inlined "just this once".

This exists because the same control has been hand-rolled repeatedly and drifted: `.agent__btn`,
`.welcome__confirm-button`, `.worktrees__confirm-button` and `.directory-ribbon__confirm-button` were
four near-identical confirm buttons with different padding, radius, hover treatment, and a
coral-versus-accent primary.

## Button variants

| Variant     | Rest                          | Hover                                   | Reference today                     |
| ----------- | ----------------------------- | --------------------------------------- | ----------------------------------- |
| **Solid**   | Filled accent, no border      | Accent, brightened                      | Clear recent items → **Clear**      |
| **Outline** | Transparent fill, grey border | Accent border + translucent accent fill | Clear recent items → **Cancel**     |
| **None**    | No fill, no border            | Accent border + translucent accent fill | Tool-strip and ribbon-strip buttons |

The Clear-recent-items pair is the reference for padding, spacing and radius as well as colour.

## Scale

**273 raw `<button>`s across 57 templates**, 14 raw `<input>`s outside the form atoms, and 4 raw
`<textarea>`s. `<select>` is already clean — it appears only inside `app-dropdown` and
`app-language-select`.

---

## Phase 0 — the missing atoms

Nothing else can start until these exist.

- [x] **`app-button`** — `variant` (`solid` | `outline` | `none`, default outline), `label`, `icon`,
      `ariaLabel`, `tooltip`, `disabled`, `type`, plus content projection for adornments. Owns
      padding, radius, corner shape, gap, hover and disabled state for all three variants.
      **Icon-only is derived, not declared**: a glyph with no label is square, so shape and content
      cannot disagree. Measured from the clear-recent-items pair.
- [x] **`app-button` pressed state** — `pressed`, for toggle buttons (the diff-layout switch, the
      problems severity filter, the default-preset star, a pinned recent item). Sets `aria-pressed`
      and wears the hover treatment while on.
- [x] **`app-button` size axis** — `medium` (default) and `small`, for the dense chrome revealed on a
      hovered row or hung off a chip. Independent of variant: any variant can be either size.
- [x] **`app-textarea`** — multi-line sibling of `app-text-field`: `rows`, `placeholder`,
      `ariaLabel`, `disabled`, plus `keyDown`/`pasted` outputs and an `element()` accessor for a
      caller that grows with its content.
- [x] **`app-text-field` grows a `search` kind** rather than a separate atom — the leading glyph and
      the search treatment, plus `ariaLabel`, `enter`/`escape`/`blurred` outputs and a `focus()`
      method, which is what the call sites actually needed.
- [ ] **`app-slider`** — one `<input type="range">` exists (the reader panel's scrubber). Lowest
      priority; fold in if a second appears.

## Phase 1 — dialog and confirmation buttons

The worst divergence, and the reason this document exists. Each line is one component, testable on
its own.

- [x] `welcome-screen` — 2 × `welcome__confirm-button` (**the reference pair**; the atom was measured
      from it, and both hand-rolled classes are gone)
- [x] `worktrees-panel` — 4 × `worktrees__confirm-button`
- [x] `directory-ribbon` — 10 × `directory-ribbon__confirm-button`
- [x] `agent-chat` — **whole component done**: 12 × `agent__btn`, 4 × `agent__copy`, 4 ×
      `agent__queue-btn`, `agent__attachment-remove`, `agent__image-remove`, `agent__md`, 4 ×
      `agent__send`. Eight hand-rolled classes deleted. Left raw: `agent__action-more` (an inline
      link, see below) and `agent__suggest-item` (a listbox option)
- [x] `agent-conversation-list` — 8 × `history__button`, 2 × `history__manage-action`, 4 ×
      `history__tool--icon`. Two classes deleted. Left raw: the Filters menu trigger, the row
      overflow trigger, and 10 CDK menu items (all structural)
- [x] `agent-request-card` — 6 × `request__btn`, class deleted (small, since the card is compact)
- [x] `source-control-sidebar` — 4 × `rail__dialog-button`, 5 × `panel-toolbar__button`, 4 ×
      `rail__item-action`. Three classes deleted; the uncommitted-changes badge keeps its own markup
      (a toggle carrying a count, not a button)
- [x] `configure-dialog` — 4 × `configure__button`
- [x] `ai-connection-editor` — 5 × `conn-editor__button`, 1 × `conn-editor__text-button`
- [x] `code-document` — 3 × `breakpoint-editor__button`
- [x] `commit-detail` — 2 × `detail__commit-button`
- [x] `title-strip-tab-menu` — 12 × `title-strip-tab-menu__request-btn`
- [x] `toast-host` — 1 × `toast__action`
- [x] `settings-view` — 1 × `settings__restart-action`
- [x] `mission-control-panel` — 1 × `panel__add`
- [x] `editor-profiles` — `profiles__add`, `profiles__delete`
- [x] `ai-settings` — `ai-connections__add-button`, `__restore-button`, `__toggle`
- [x] `ai-write-paths` — 2 × `write-paths__add`
- [x] `worktrees-panel` — `worktrees__add`
- [x] `markdown-review-panel` — `rv-suggestion`, `rv-ghost`, `rv-ignore`
- [x] `keyboard-settings` — `keyboard__reset`

## Phase 2 — icon and tool buttons (the None variant)

Mostly icon-only chrome that already behaves like the None variant, but each rebuilds the hover.

- [x] `panel-toolbar__button` (shared class used by output, problems, terminal, commit-detail,
      source-control — 12 uses; check whether it should become the atom or wrap it)
- [x] `explorer-toolbar` — 3
- [x] `find-panel` — `find-panel__button` ×5, `find-panel__icon-button`
- [x] `debug-panel` — 6 × `debug-toolbar__button`, `debug-watch__remove`
- [x] `agent-chat` — done with Phase 1 above
- [x] `agent-conversation-list` — done with Phase 1 above (the two menu triggers stay)
- [x] `configure-dialog` — 3 × `configure__tool`
- [x] `worktrees-panel` — `worktrees__remove`, `worktrees__refresh`
- [x] `directory-ribbon` — `__preset-default`, `__preset-delete`
- [x] `ai-connection-editor` — 2 × `conn-editor__icon-button`
- [x] `ai-settings` — 2 × `ai-connections__move`
- [x] `ai-write-paths` — 2 × `write-paths__remove`
- [x] `mission-control-agent-tile` — 2 × `tile__action`
- [x] `mission-control-panel` — `panel__gear`
- [x] `markdown-reader-panel` — `ra-play`, `ra-skip` ×2
- [x] `markdown-review-panel` — `rv-refresh`
- [x] `commit-detail` — `detail__ai`, `detail__notice-dismiss`
- [x] `commit-detail` — `tree-row-action` (the sidebar's are done; `.tree-row-action` stays as the
      global hover-reveal, which is placement rather than chrome)
- [x] `welcome-screen` — 2 × `welcome__recent-action`
- [x] `status-strip-lsp-menu` — `lsp-status-menu__restart`
- [x] `status-strip-notifications-menu` — `notifications-menu__clear`, `__remove`
- [x] `terminal-panel`, `code-terminal-panel` — 5 unclassed icon buttons
- [x] `binary-disasm-panel`, `binary-agent-panel`, `code-agent-panel`, `terminal-agent-panel`,
      `problems-panel` — 1 unclassed icon button each

## Phase 3 — segmented controls

`app-button-group` already exists (`segmented__option`). These are hand-rolled equivalents.

- [ ] ~~`dock-status-strip`~~ — NOT a segmented control: eight status readouts (error counts, line
      and column, word count), most without a click handler at all. Left as chrome.
- [x] `binary-inspector` — endianness and signedness, two groups
- [x] `find-panel` — the Find / Find-and-Replace mode picker
- [x] `markdown-reader-panel` — playback speed and highlight granularity, two groups
- [ ] `markdown-review-panel` — 2 × `rv-chip`. **Blocked**: each chip carries a kind-coloured dot
      and a count badge, which `ButtonGroupOption` (value, label, icon) cannot express. Needs either a
      `count` field and a colour-dot adornment on the atom, or a ruling that the chips lose them.
- [ ] ~~`mission-control-panel`~~ — `role="tab"` tabs, not a picker. Structural, by the ruling.
- [ ] ~~`welcome-screen`~~ — the filter pills are **deliberately bespoke**; see the exception below

## Phase 4 — text inputs and text areas

- [ ] `agent-chat` — `agent__input` (the composer) and `agent__prompts-field`. **Deferred**: the
      composer is wired to auto-grow, slash-command suggestions, image paste and a submit chord
      through the element itself. `app-textarea` exposes what it needs (`keyDown`, `pasted`,
      `element()`), so this is a careful conversion rather than a mechanical one.
- [x] `commit-detail` — `detail__message`
- [x] `configure-dialog` — `configure__env`
- [x] `agent-conversation-list` — `history__search` (search kind), `history__modal-input` ×2
- [x] `source-control-sidebar` — `rail__filter` (search kind), `rail__dialog-input`
- [x] `worktrees-panel` — 2 × `worktrees__prompt-input`
- [x] `directory-ribbon` — `__prompt-input` (focus now goes through the atom), `__preset-input`
- [ ] ~~`welcome-screen`~~ — the search box is **deliberately bespoke**; see the exception below
- [x] `explorer-toolbar` — `explorer-toolbar__search` (search kind)
- [x] `terminal-panel` — `terminal-panel__rename`
- [ ] `title-strip-container` — `window-lock__input`. **Blocked**: it is a bespoke switch whose
      sliding knob carries a lock glyph, drawn around the native checkbox. `app-toggle` draws its own
      switch, so converting silently drops the glyph. Needs a ruling, or a knob-content slot.
- [ ] `markdown-reader-panel` — `ra-scrubber` (range). Still the only slider; `app-slider` is unwritten.

---

## Already a control component — no call-site change

Their internal `<button>` **is** the implementation. They must consume the same tokens as
`app-button` so they cannot drift, but nothing about them moves:

`app-dropdown` (face) · `app-button-group` (option) · `app-accordion` (header) · `app-menu` (item) ·
`app-modal` (window controls) · `ribbon-strip-button` · `ribbon-strip-button-small` ·
`ribbon-strip-menu-button` · `ribbon-strip-split-button` · `ribbon-strip-overflow` ·
`title-strip-button` · `dock-tool-strip`

## Structural, not controls — needs your ruling

These are `<button>` for keyboard and screen-reader reasons, but they are tabs, list rows and menu
triggers rather than controls. My instinct is to leave them, and instead have them read the shared
tokens:

`title-strip-tab` · `dock-tab-group` tabs and close · `dock-collapsed-strip__tab` ·
`window-controls__button` · `welcome__action` (the six big cards) ·
`welcome__recent-open` (recent row) · `commit-graph__row` · `markdown-outline-panel__item` ·
`agent__suggest-item` · `find-panel__result` · `settings__nav-item` · `tile__name` ·
`*-menu__trigger` (LSP, notifications, tab menu) · `configure__item` · `tree-open-btn` ·
`rv-card-head` · `keyboard__chord` (the chord-capture field — arguably an input)

## The one sanctioned exception: the welcome screen

Its **search box**, **Clear pill** and **filter pills** stay hand-rolled. The welcome screen is the
application's one bespoke surface, drawn to its own palette (`--wl-*`) and geometry; the shared
controls would either look wrong there or have to be overridden from the call site, which is the
drift the atoms exist to prevent. Reverted knowingly (2026-07-29) and commented at both the markup
and the stylesheet, so a later reader does not "fix" it. Its confirm-dialog buttons and its pin
control DO use the atoms — only these three are excepted, and nothing else may follow.

## Rulings (2026-07-29)

1. **Destructive actions use the accent like everything else, for now.** No danger variant. Meaning —
   danger, warning, success — is a separate plan, and will arrive as a `tone` axis alongside the
   existing variants. The variants above are deliberately about SHAPE only, so adding tones later is
   additive rather than a rework.
2. **One atom, and icon-only is derived rather than declared.** A flag would be a second source of
   truth that can contradict the content; the button is square when it has a glyph and no label.
3. **`panel-toolbar__button` becomes `app-button variant="none"`.** It was a shared class the call
   sites hand-wrote, not a component.
4. **The structural set stays out of `app-button`** — a tab, a list row and a menu trigger are not
   buttons — **but repeated markup becomes its own component**, so the six welcome cards become one
   component rather than six copies. The threshold is repetition or sharing: a row that appears once
   inside a component is already componentised, and wrapping it again buys nothing.

## Still needed — an inline link

`agent__action-more` ("… 14 more lines") and its kin are inline text links, not buttons: no padding,
no box, accent text underlined on hover. `app-button variant="none"` would put a padded box around
them. They want an `app-link` atom (or a `link` variant), which does not exist yet — flagged rather
than forced.

## Phase 5 — repeated markup that should be its own component

- [ ] `welcome__action` — the six welcome cards (icon, label, hint, chevron), one component
- [ ] `title-strip-tab-menu__request-btn` — 12 copies of the same request row
- [ ] `tree-row-action` — 6 copies across the source-control sidebar and commit detail
- [ ] Audit the rest of the structural set for repetition once the phases above are done

### Done — dock panel title controls (2026-07-30)

- [x] The dock's own panel controls (Auto Hide, Float, Open in New Window, Close) are `app-button
    variant="none" size="small"` — the same button a tool panel's header wears. They had been a
      fourth hand-rolled variant: 1.125rem square, a `--dock-title-*--focused` hover, and in the
      floating panel a hardcoded `rgb(255 255 255 / 25%)`.
- [x] The same row in `dock-floating-layer` (Dock, Close) and the collapsed peek flyout
      (Dock, Float, Close) — three copies of one bar, now one control at three call sites.
- The atom gained `iconRotation`, for the auto-hide arrow that points at the edge it collapses
  towards. Rotation is a property of the glyph, and the button owns its glyph.
- The dock title bar is 2px taller as a result, which lands it exactly on the tool panel header's
  height — the two now agree rather than nearly agreeing.

### Done — docked panel chrome (2026-07-30)

- [x] `ToolPanel` is now the only chrome for a dockable panel in the editor views. Six hand-rolled
      title bars (`code-agent__bar`, `terminal-agent__bar`, `binary-agent__bar`, `disasm__bar`,
      `inspector__bar`, `code-terminal__bar`, `find-panel__header`) were byte-for-byte copies that had
      already drifted from the shared component: `ToolPanel` drew an UPPERCASE 600-weight title and a
      1.5rem close button, the copies a titlecase 500-weight title and a 1.25rem `app-button`.
      `ToolPanel` took the copies' appearance and grew the extension points they needed —
      `icon` (now optional), `dragTitle`, `header`, `closable`, `closeLabel`, and a `panelActions`
      content slot for panels with extra header controls.
- Each copy also carried a `button { … }` block styling its close button. That CSS was **dead**: it
  targets the atom's internal `<button>`, which view encapsulation puts out of the parent's reach. The
  hover and focus treatment it appeared to provide came from `app-button` all along.
- **A panel's appearance is not a call-site decision.** Extra header controls go in `panelActions`;
  a body that manages its own padding sets `[flush]="true"`. Neither is a reason for a new bar.
