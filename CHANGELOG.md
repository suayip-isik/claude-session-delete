# Changelog

All notable changes to this project are documented in this file. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.3] - 2026-11-10

### Fixed

- `/delete` in the VS Code extension: it ended Claude's process, which the extension reports as `Claude Code process exited with code 143`, and the session was left half deleted. A session that does not own a terminal (registry `entrypoint` other than `cli`) is now replaced by a fresh empty session through the built-in `/clear`, so the panel stays open; the old session is then deleted and the summary is logged in the panel. The process, its registry entry, socket, shell snapshot and helpers (MCP servers) are left alone. Terminal sessions behave as before.

## [1.1.2] - 2026-11-09

### Changed

- The engine (`$`) is now touched only by plain `$.noun.method(...)` calls inside the two files that declare hooks, so the plugin directory can read every call. The host adapter moved into `src/commands/deleteCommand.ts`; behaviour is unchanged.
- `SafetyPolicy.allowedRoots` is a method instead of an accessor.
- README: the data-handling section now names the programs the plugin runs, what it writes and that nothing read is sent anywhere.
- CI installs Claude Code with `brew install --cask claude-code` instead of a downloaded install script.
- `CONTRIBUTING.md` and a comment in `bin/lib/common.sh` no longer trigger directory review holds.

## [1.1.1] - 2026-11-09

### Added

- README: a "Data handling and disclosure" section listing what the plugin reads, writes, runs and stops, and stating that it makes no network requests, collects no data and never changes Claude Code's settings.

## [1.1.0] - 2026-11-08

### Changed

- `/delete` keeps your prompt history by default. The dialog now offers **Delete session, keep prompt history** (first) and **Delete session and prompt history**. With the first, ↑ in later sessions still recalls what you typed in the deleted session, including pasted texts. Before, the session's `history.jsonl` rows and their pasted texts were always deleted.

### Fixed

- CI: ShellCheck now comes from Homebrew. The npm `shellcheck` package downloaded the binary from the GitHub API at run time and failed with `403 rate limit exceeded` on shared runners. ShellCheck is now a system prerequisite (`brew install shellcheck`).

## [1.0.0] - 2026-11-08

### Added

- `/delete` command (falls back to `/delete-session` if the name is taken). It previews and asks for confirmation, then closes the session and deletes it during Claude's exit, so the summary is printed before the shell prompt returns.
- Deletes the transcript, subagent transcripts, tool outputs, file history, session env, todos, tasks, debug log, session mods folder, temporary files, the registry entry and IPC socket, the shell snapshot, and the plans and pasted texts only this session used. Also removes the session's rows from `history.jsonl`.
- Stops the session's process tree and its detached processes (SIGTERM, then SIGKILL) and checks that their ports are closed.
- A detached guardian that removes what Claude writes during its exit, and finishes the work if the exit could not.
- Safety policy: only paths strictly inside the session's roots, links never followed, ownership proven for shared files, PIDs checked against their command before a late kill, atomic history rewrite.
- Never calls the model.

[Unreleased]: https://github.com/suayip-isik/claude-session-delete/compare/v1.1.3...HEAD
[1.1.3]: https://github.com/suayip-isik/claude-session-delete/compare/v1.1.2...v1.1.3
[1.1.2]: https://github.com/suayip-isik/claude-session-delete/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/suayip-isik/claude-session-delete/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/suayip-isik/claude-session-delete/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/suayip-isik/claude-session-delete/releases/tag/v1.0.0
