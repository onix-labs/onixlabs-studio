# Repository governance

The rules that guard `main` and `release`, kept as files so they are reviewed like code and can be
re-applied with `.github/rulesets/apply.sh` (needs an admin `gh` login).

| File                        | What it does                                                                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `protect-main-release.json` | Applies to **everyone, admins included**: changes reach `main`/`release` only through a PR whose `Format · Lint · Test · Build` check passed; no force-push, no deletion. |
| `merge-by-admins.json`      | Only repository admins may update `main`/`release` — i.e. press Merge. Anyone else can open a PR; an admin merges it.                                                     |
| `release-tags.json`         | `v*` tags are created only by admins (the release workflow uses an admin token).                                                                                          |

Zero approving reviews are required because GitHub never lets a PR's author approve it and the
project has one maintainer; the CI check is the gate.

The script also sets the merge options (squash and merge-commit; branches deleted on merge),
switches on Dependabot alerts and security updates, secret scanning with push protection, private
vulnerability reporting and Discussions, and creates the `release` branch if it is missing.
