<p align="center">
  <img src="assets/icon.png" alt="" width="96" height="96">
</p>

<h1 align="center">claude-session-delete</h1>

<p align="center">
  <code>/delete</code> for Claude Code: permanently delete the current session and every trace it left on your disk.
</p>

<p align="center">
  <a href="https://github.com/suayip-isik/claude-session-delete/actions/workflows/ci.yml"><img src="https://github.com/suayip-isik/claude-session-delete/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT license"></a>
  <img src="https://img.shields.io/badge/platform-macOS-lightgrey.svg" alt="macOS">
</p>

---

Codex CLI has a `/delete` command that removes a session for good. Claude Code does not. This plugin adds one.

Type `/delete` in a session and confirm. The session closes, and everything it left behind is removed: the transcript, file history, temporary files, background processes and the ports they opened. The prompts you typed stay available to ↑ in later sessions unless you choose to delete them too. A one-line summary of what was freed is printed in your terminal, and your shell prompt is ready right below it.

```
✔ Claude Code session 2c8497bd-3f84-426a-807e-57281be0ce3d deleted
  4 files removed · 16.2 KB freed · 2 processes stopped · 0 ports closed · prompt history kept
  The "claude --resume" hint above no longer applies.
```

**It never calls the model.** The command is handled locally by a hook, so it costs no tokens and works even when you have hit your usage limit, just like `/exit`.

## Contents

- [Requirements](#requirements)
- [Install](#install)
- [Usage](#usage)
- [How it works](#how-it-works)
- [What is deleted](#what-is-deleted)
- [Safety](#safety)
- [Uninstall](#uninstall)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License](#license)

## Requirements

- **macOS.** The plugin uses BSD `ps`, `stat` and `lsof` output formats. On any other platform the command stops without touching anything.
- **Claude Code with function-hook plugins** (tested with 2.1.319). That plugin API is in early access, so a future Claude Code release may change it; CI runs the plugin's tests against the latest release.
- Optional: [ripgrep](https://github.com/BurntSushi/ripgrep) (`brew install ripgrep`). It makes the shared-file ownership check about 10× faster on large session archives.

## Install

At the Claude Code prompt:

```
/plugin install session-delete --marketplace suayip-isik/claude-session-delete
```

Answer `y` to add the marketplace and pick a scope (user scope makes `/delete` available in every project). Then start a new session, or run `/reload-plugins`.

From a terminal:

```bash
claude plugin install session-delete --marketplace suayip-isik/claude-session-delete
```

## Usage

```
/delete
```

1. A dialog shows what will happen: the number of files and their size, the processes to stop, the ports to close, and how many of your prompts (and pasted texts) are in the prompt history. Nothing has been touched at this point.
2. Choose one:

   | Choice                                                            | The session | Your prompts in ↑ history      |
   | ----------------------------------------------------------------- | ----------- | ------------------------------ |
   | **Delete session, keep prompt history** (first, the safe default) | deleted     | kept, pasted texts included    |
   | **Delete session and prompt history**                             | deleted     | deleted, pasted texts included |
   | **Cancel**, or Esc                                                | kept        | kept                           |

   Keeping the prompt history means that, in a later session, ↑ still recalls what you typed in the deleted one. The conversation itself (Claude's answers, tool output, files) is gone either way.

3. The session closes within about a second, the summary is printed and your shell prompt returns. No key press is needed.

If a built-in command ever takes the name `delete`, the command registers as `/delete-session` instead.

## How it works

```
/delete ─► preview (read-only) ─► confirm ─► guardian starts ─► session closes
                                                                      │
             shell prompt ◄─ Claude exits ◄─ summary printed ◄─ stop · delete · purge
                                                                (during Claude's exit)
```

1. **Preview.** The plugin resolves the session (its id, the Claude process, its terminal) and checks it against Claude Code's session registry. It then lists the session's processes and listening ports and inventories its files.
2. **Confirm.** Claude Code's own question dialog asks for confirmation.
3. **Close.** `bin/guardian.sh` starts in a process session of its own (`setsid`) and sends Claude `SIGTERM`. Claude's interface closes at once.
4. **Delete during the exit.** Claude runs its `session.end` hooks after its interface is gone but while it still holds the terminal, and the shell is still waiting for it. In that window the plugin:
   - stops the session's processes (`SIGTERM`, then `SIGKILL`) and checks that their ports are closed,
   - deletes every trace, rescanning for files written after the preview (a short session's transcript only appears at exit),
   - if you chose to delete the prompt history, removes the session's rows from `history.jsonl` and the pasted texts only they point to,
   - prints the summary.
5. **Prompt.** Claude exits and your shell prompt appears below the summary.
6. **Sweep.** After the exit, the guardian quietly removes whatever Claude wrote in its last moments. If the exit could not finish the work for any reason, the guardian finishes it and prints the summary itself.

## What is deleted

| Trace                                                             | Location                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Transcript, subagent transcripts, tool outputs                    | `~/.claude/projects/<project>/<id>.jsonl`, `…/<id>/`                                      |
| File history (rewind checkpoints)                                 | `~/.claude/file-history/<id>/`                                                            |
| Session environment, todos, tasks, debug log, session mods folder | `~/.claude/{session-env,todos,tasks,debug,dev-mods}/<id>*`                                |
| Temporary files (scratchpad, background task output)              | `/tmp/claude-<uid>/<project>/<id>/`                                                       |
| Running-session registry entry and IPC socket                     | `~/.claude/sessions/<pid>.json`, `.key`, `/tmp/cc-socks/<pid>.sock`                       |
| Shell snapshot                                                    | `~/.claude/shell-snapshots/snapshot-*.sh`, only when provably this session's              |
| Plans only this session used                                      | `~/.claude/plans/*.md`                                                                    |
| Processes the session started, and their ports                    | the session's process tree, plus detached processes carrying its `CLAUDE_CODE_SESSION_ID` |

With **Delete session and prompt history**, these go too:

| Trace                                 | Location                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| Prompt-history rows (what ↑ recalls)  | `~/.claude/history.jsonl` (only this session's rows; the file itself stays) |
| Pasted texts only those rows point to | `~/.claude/paste-cache/*.txt`                                               |

`CLAUDE_CONFIG_DIR` is honoured when set.

Two things are **not** removed: files the session created or edited in your project (they are your work), and data stored on Anthropic's servers. For the latter, see Anthropic's privacy settings.

> While exiting, Claude Code prints its own `Resume this session with: claude --resume …` line. The plugin cannot suppress it; the summary right below it says the hint no longer applies.

## Safety

Deleting files is the whole point of this plugin, so it is built to fail closed:

- **Nothing is touched before you confirm.** The preview only reads.
- **Every path must sit strictly inside** `~/.claude`, `/tmp/claude-<uid>` or the session's socket folder once the links of its parent are resolved. It must be absolute and contain no `.` or `..` segment. The guardian checks this again before every removal.
- **Links are never followed.** A symbolic link is removed as a link, never its target.
- **Shared files are deleted only when provably owned.** A plan, pasted text or shell snapshot is kept if another transcript or another session's history row refers to it.
- **Identity is verified first.** If the Claude process does not match the session registry, the command stops without doing anything.
- **Other windows are left alone.** If the same session is open in another Claude window, the dialog warns you and that window's processes are not touched.
- **A recycled PID is never killed.** After the exit, a listed process is killed only if it still runs the same command.
- **History is never corrupted.** `history.jsonl` is replaced atomically, and only if no other session wrote to it in the meantime. Otherwise the filter runs again.
- **No PATH tricks.** System tools are called by absolute path with an argument vector, never through a shell string.

Found a way to make it delete something it should not? Please report it privately; see [SECURITY.md](SECURITY.md).

## Data handling and disclosure

Everything the plugin does is listed here.

- **No network access.** It makes no network requests and sends no data anywhere. It never calls the model.
- **No data collected or stored.** It keeps no copy of what it deletes. The only state it keeps is a list of shell snapshot file names (`session-delete.shellSnapshots`), used to decide which snapshot belongs to this session.
- **Reads** only the session's own traces under `~/.claude`, `/tmp/claude-<uid>` and the session's socket folder (see [What is deleted](#what-is-deleted)), plus the process table to find the session's own processes.
- **Writes and deletes** only inside those same folders, and only after you confirm. `history.jsonl` is rewritten (atomically) only if you choose to delete the prompt history.
- **Runs code** from this repository only: `hooks/register.ts` and the shell scripts in `bin/` (`guardian.sh`, `purge-history.sh`). Nothing is downloaded or installed at runtime, and the source is readable, not minified.
- **Does not change** Claude Code's settings or permissions, and reads no credentials or environment secrets (it reads only `CLAUDE_CONFIG_DIR` and `HOME`).
- **Stops processes** only those the session started (its process tree, plus detached processes that carry its `CLAUDE_CODE_SESSION_ID`).

## Uninstall

```bash
claude plugin uninstall session-delete@claude-session-delete
claude plugin marketplace remove claude-session-delete
```

## Troubleshooting

| Symptom                                            | Cause and fix                                                                                                                                                                               |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unknown command: /delete`                         | The plugin is not loaded in this session. Run `/reload-plugins` or start a new session, and check `claude plugin list`.                                                                     |
| `This command is supported on macOS only`          | The plugin relies on macOS tools; other platforms are not supported yet.                                                                                                                    |
| `The session registry does not match this process` | The session registry and the running process disagree, so the plugin refuses to act. Restart the session and try again.                                                                     |
| The summary is printed after your prompt           | Claude's exit could not finish the work within its time limit, so the guardian finished it. Raise the limit with `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` (milliseconds; 1500 by default). |
| A `!` line in the summary                          | Something could not be stopped or removed. The line names it and says why.                                                                                                                  |

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

```bash
pnpm install
pnpm run check   # shellcheck · plugin validate · plugin tests · script tests · typecheck
```

```
hooks/register.ts            entry point: registers the hooks
src/config.ts                every setting and constant
src/compositionRoot.ts       the one place dependencies are wired
src/usecase/                 plan → confirm → begin (close) → complete (delete + summary during the exit)
src/context/                 session id, Claude PID, terminal, registry checks
src/processes/               process table, discovery, port inspection, termination
src/inventory/               trace sources (ArtifactSource), measuring, inventory
src/cleanup/                 safety policy, deleter, history counter and purger
src/finalize/ + bin/         the guardian and the history purge script
src/report/                  summary formatting, terminal writer
src/tracking/                records which shell snapshot this session created
tests/                       plugin tests (fake host) and script tests (real files and processes)
```

## License

[MIT](LICENSE) © Şuayip Işık

This project is not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.
