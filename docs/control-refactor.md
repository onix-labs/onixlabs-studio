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
- [x] **`app-button` size axis** — `medium` (default) and `small`, for the dense chrome revealed on a
      hovered row or hung off a chip. Independent of variant: any variant can be either size.
- [ ] **`app-textarea`** — multi-line sibling of `app-text-field`; `rows`, `placeholder`,
      `readonly`, auto-grow where callers need it.
- [ ] **`app-search-field`** — `app-text-field` with the leading glyph and clear affordance that four
      call sites currently rebuild by hand. (Could be a `search` variant of `app-text-field`
      instead — decide when writing it.)
- [ ] **`app-slider`** — one `<input type="range">` exists (the reader panel's scrubber). Lowest
      priority; fold in if a second appears.

## Phase 1 — dialog and confirmation buttons

The worst divergence, and the reason this document exists. Each line is one component, testable on
its own.

- [x] `welcome-screen` — 2 × `welcome__confirm-button` (**the reference pair**; the atom was measured
      from it, and both hand-rolled classes are gone)
- [ ] `worktrees-panel` — 4 × `worktrees__confirm-button`
- [ ] `directory-ribbon` — 10 × `directory-ribbon__confirm-button`
- [x] `agent-chat` — **whole component done**: 12 × `agent__btn`, 4 × `agent__copy`, 4 ×
      `agent__queue-btn`, `agent__attachment-remove`, `agent__image-remove`, `agent__md`, 4 ×
      `agent__send`. Eight hand-rolled classes deleted. Left raw: `agent__action-more` (an inline
      link, see below) and `agent__suggest-item` (a listbox option)
- [x] `agent-conversation-list` — 8 × `history__button`, 2 × `history__manage-action`, 4 ×
      `history__tool--icon`. Two classes deleted. Left raw: the Filters menu trigger, the row
      overflow trigger, and 10 CDK menu items (all structural)
- [x] `agent-request-card` — 6 × `request__btn`, class deleted (small, since the card is compact)
- [ ] `source-control-sidebar` — 4 × `rail__dialog-button`
- [ ] `configure-dialog` — 4 × `configure__button`
- [ ] `ai-connection-editor` — 5 × `conn-editor__button`, 1 × `conn-editor__text-button`
- [ ] `code-document` — 3 × `breakpoint-editor__button`
- [ ] `commit-detail` — 2 × `detail__commit-button`
- [ ] `title-strip-tab-menu` — 12 × `title-strip-tab-menu__request-btn`
- [ ] `toast-host` — 1 × `toast__action`
- [ ] `settings-view` — 1 × `settings__restart-action`
- [ ] `mission-control-panel` — 1 × `panel__add`
- [ ] `editor-profiles` — `profiles__add`, `profiles__delete`
- [ ] `ai-settings` — `ai-connections__add-button`, `__restore-button`, `__toggle`
- [ ] `ai-write-paths` — 2 × `write-paths__add`
- [ ] `worktrees-panel` — `worktrees__add`
- [ ] `markdown-review-panel` — `rv-suggestion`, `rv-ghost`, `rv-ignore`
- [ ] `keyboard-settings` — `keyboard__reset`

## Phase 2 — icon and tool buttons (the None variant)

Mostly icon-only chrome that already behaves like the None variant, but each rebuilds the hover.

- [ ] `panel-toolbar__button` (shared class used by output, problems, terminal, commit-detail,
      source-control — 12 uses; check whether it should become the atom or wrap it)
- [ ] `explorer-toolbar` — 3
- [ ] `find-panel` — `find-panel__button` ×5, `find-panel__icon-button`
- [ ] `debug-panel` — 6 × `debug-toolbar__button`, `debug-watch__remove`
- [x] `agent-chat` — done with Phase 1 above
- [x] `agent-conversation-list` — done with Phase 1 above (the two menu triggers stay)
- [ ] `configure-dialog` — 3 × `configure__tool`
- [ ] `worktrees-panel` — `worktrees__remove`, `worktrees__refresh`
- [ ] `directory-ribbon` — `__preset-default`, `__preset-delete`
- [ ] `ai-connection-editor` — 2 × `conn-editor__icon-button`
- [ ] `ai-settings` — 2 × `ai-connections__move`
- [ ] `ai-write-paths` — 2 × `write-paths__remove`
- [ ] `mission-control-agent-tile` — 2 × `tile__action`
- [ ] `mission-control-panel` — `panel__gear`
- [ ] `markdown-reader-panel` — `ra-play`, `ra-skip` ×2
- [ ] `markdown-review-panel` — `rv-refresh`
- [ ] `commit-detail` — `detail__ai`, `detail__notice-dismiss`
- [ ] `source-control-sidebar` / `commit-detail` — `tree-row-action` ×6
- [ ] `welcome-screen` — 2 × `welcome__recent-action`
- [ ] `status-strip-lsp-menu` — `lsp-status-menu__restart`
- [ ] `status-strip-notifications-menu` — `notifications-menu__clear`, `__remove`
- [ ] `terminal-panel`, `code-terminal-panel` — 5 unclassed icon buttons
- [ ] `binary-disasm-panel`, `binary-agent-panel`, `code-agent-panel`, `terminal-agent-panel`,
      `problems-panel` — 1 unclassed icon button each

## Phase 3 — segmented controls

`app-button-group` already exists (`segmented__option`). These are hand-rolled equivalents.

- [ ] `dock-status-strip` — 8 × `dock-status-strip__segment`
- [ ] `binary-inspector` — 4 × `inspector__seg-btn`
- [ ] `find-panel` — 2 × `find-panel__segment`
- [ ] `markdown-reader-panel` — 3 × `ra-segment`
- [ ] `markdown-review-panel` — 2 × `rv-chip`
- [ ] `mission-control-panel` — 2 × `panel__tab`
- [ ] `welcome-screen` — `welcome__filter` (filter pills)

## Phase 4 — text inputs and text areas

- [ ] `agent-chat` — `agent__input` (textarea), `agent__prompts-field` (input + textarea)
- [ ] `commit-detail` — `detail__message` (textarea)
- [ ] `configure-dialog` — `configure__env` (textarea)
- [ ] `agent-conversation-list` — `history__search`, `history__modal-input` ×2
- [ ] `source-control-sidebar` — `rail__filter` (search), `rail__dialog-input`
- [ ] `worktrees-panel` — 2 × `worktrees__prompt-input`
- [ ] `directory-ribbon` — `__prompt-input`, `__preset-input`
- [ ] `welcome-screen` — `welcome__searchbox-input`
- [ ] `explorer-toolbar` — `explorer-toolbar__search`
- [ ] `terminal-panel` — `terminal-panel__rename`
- [ ] `title-strip-container` — `window-lock__input` (checkbox → `app-checkbox` or `app-toggle`)
- [ ] `markdown-reader-panel` — `ra-scrubber` (range)

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
`dock-floating-layer` chrome · `window-controls__button` · `welcome__action` (the six big cards) ·
`welcome__recent-open` (recent row) · `commit-graph__row` · `markdown-outline-panel__item` ·
`agent__suggest-item` · `find-panel__result` · `settings__nav-item` · `tile__name` ·
`*-menu__trigger` (LSP, notifications, tab menu) · `configure__item` · `tree-open-btn` ·
`rv-card-head` · `keyboard__chord` (the chord-capture field — arguably an input)

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
