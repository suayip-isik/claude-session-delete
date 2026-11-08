# Security policy

This plugin deletes files and stops processes. A bug that makes it delete the wrong thing is a security issue, and so is one that makes it kill the wrong process.

## Supported versions

Only the latest release receives fixes.

## Reporting a vulnerability

**Please do not open a public issue.** Report it privately through GitHub's [private vulnerability reporting](https://github.com/suayip-isik/claude-session-delete/security/advisories/new).

Include:

- what was deleted, stopped or exposed that should not have been, or how it could be;
- the steps to reproduce it, with paths and session ids anonymised;
- your macOS and Claude Code versions (`sw_vers -productVersion`, `claude --version`).

You can expect an acknowledgement within 7 days. Once a fix is released, the advisory is published, crediting you unless you prefer otherwise.

## Scope

In scope:

- deleting or overwriting anything outside the session's own traces;
- following a symbolic link to its target;
- stopping a process that the session did not start;
- corrupting or exposing another session's data, including `history.jsonl`;
- running a command or file that an attacker controls.

Out of scope: what Claude Code itself stores, and data held on Anthropic's servers.

## Design safeguards

See the [Safety](README.md#safety) section of the README.
