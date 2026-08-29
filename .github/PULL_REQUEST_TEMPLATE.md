<!--
Title: `type(scope): subject` — it becomes the commit subject and the release-note line.
Label the PR with its kind: feature / enhancement / bug / documentation.
-->

## What changes, and why

<!-- What a user or developer gains. Link the issue: "Closes #123". -->

## How it was verified

<!-- Which tests were added or changed; what was exercised in the running app. -->

## Checklist

- [ ] The green gate passes locally: `format:check` · `lint` · `test:coverage` · `build` · `build:electron`.
- [ ] Every class member has an explicit access modifier; every parameter, return and local is typed; no `any`.
- [ ] Every member — including private ones — has genuine TSDoc. Comments explain _why_; no commented-out code, no untracked `TODO`s.
- [ ] Angular: standalone, signals/`computed`, `OnPush`, `inject()`, built-in control flow, control atoms rather than raw form elements.
- [ ] The architecture invariants hold: `shared` names no feature; a feature imports only `@shared`/`@features`; the renderer crosses the Bridge, never Node.
- [ ] Tests are AAA + `method_condition_expectation`, exercising behaviour through the public API; coverage does not drop.
- [ ] If `src/shared/api/plugin-manifest.ts` changed, `PLUGIN_API_VERSION` moved with it and the reason is recorded above the constant.
- [ ] No dead code: no stubs or seed data on production paths, no unreferenced exports.
