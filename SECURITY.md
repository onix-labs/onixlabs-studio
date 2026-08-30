# Security policy

## Reporting a vulnerability

Please **do not** report security vulnerabilities through public issues, discussions, or pull requests.

Use GitHub's private vulnerability reporting instead:
**[Report a vulnerability](https://github.com/onix-labs/onixlabs-studio/security/advisories/new)**.
The report is visible only to the repository's maintainers, who will acknowledge it, work with you on
a fix, and credit you in the advisory unless you would rather not be named.

Include what you can of: the affected area (agent tooling, plugin installation, the IPC bridge,
language-server provisioning, …), steps to reproduce, and the impact you believe it has.

## Scope

Studio runs agents, installs and executes language servers and other plugins, and talks to AI
providers on the user's behalf, so the areas of most interest are:

- an agent escaping its workspace confinement or the per-tool permission policy;
- a plugin manifest, curated-catalogue entry, or downloaded archive being installed without its
  integrity check, or executed from inside the application archive;
- the renderer reaching Node or the file system other than through the validated Bridge IPC;
- credentials (provider keys, forge tokens, package-feed secrets) leaking into logs, transcripts, or
  files inside a workspace.

## Supported versions

Studio is pre-1.0 and only the latest release receives fixes.
