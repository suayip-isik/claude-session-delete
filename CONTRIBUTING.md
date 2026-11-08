# Contributing

Thanks for helping. This plugin deletes files, so correctness and safety come first. Please read this guide before you open a pull request.

## Ground rules

- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
- Report security problems privately, as described in [SECURITY.md](SECURITY.md), never in a public issue.
- Open an issue before a large change, so we can agree on the approach first.

## Setup

You need macOS, [Claude Code](https://docs.claude.com/en/docs/claude-code), [pnpm](https://pnpm.io) and Node.js.

```bash
git clone https://github.com/suayip-isik/claude-session-delete.git
cd claude-session-delete
pnpm install
```

`tsconfig.json` extends `.claude-plugin/types/tsconfig.json`. Claude Code writes that file, together with its plugin API declarations, each time it loads the plugin from a folder in an interactive session. Generate it once, and again after each Claude Code update:

```bash
claude --plugin-dir .   # quit (/exit) once the session has started
```

The folder is machine-generated, so it is git-ignored.

To try your working copy with `/delete` in real sessions, add the folder as a marketplace:

```bash
claude plugin marketplace add "$PWD"
claude plugin install session-delete@claude-session-delete
```

The plugin is then read straight from your folder; run `/reload-plugins` after an edit. Use throwaway sessions only: `/delete` really deletes.

## Checks

```bash
pnpm run check
```

runs everything CI runs, in this order:

| Script | What it checks |
| --- | --- |
| `pnpm run lint` | `shellcheck` on every POSIX script |
| `pnpm run validate` | `claude plugin validate`: the manifests and the hooks module, as Claude Code loads them |
| `pnpm run test:plugin` | `tests/*.test.ts` against a fake host: planning, safety policy, the flow, parsers |
| `pnpm run test:scripts` | `tests/scripts/*.test.sh` against real files and processes in a temporary folder |
| `pnpm run typecheck` | `tsc` in strict mode, `noUncheckedIndexedAccess` included (needs the generated types) |

Every change needs tests. A change to what gets deleted needs a test that proves what is deleted **and** a test that proves what is kept.

## Design

The code is organised by responsibility, and the README's Development section maps each folder. A few rules keep it that way:

- **Depend on interfaces.** Modules take `Host`, `CommandRunner` and `FileSystem`, never the engine's `$`. Only `src/host/host.ts` and `src/context/engineFacts.ts` touch `$`, so everything else runs against the fake host in `tests/fakeHost.ts`.
- **Wire in one place.** Concrete classes are created only in `src/compositionRoot.ts`.
- **No literals in logic.** Every path, binary, limit and label lives in `src/config.ts`.
- **Extend, don't edit.** A new kind of trace is a new `ArtifactSource` added to the list in `compositionRoot.ts`.
- **Fail closed.** When the plugin cannot prove that something belongs to the session, it keeps it.
- **No dead code.** Remove what is no longer read; `tsc` reports unused locals and `shellcheck` reports unused variables.
- **POSIX `sh`** in `bin/`, with shared helpers in `bin/lib/common.sh`; tools called by absolute path; arguments quoted.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`.
- Keep each pull request focused, and add a line under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
- Fill in the pull request template, including how you tested the change in a real session.

## Releases

1. Move the `Unreleased` entries in `CHANGELOG.md` under the new version and date.
2. Bump `version` in `.claude-plugin/plugin.json`, the only place it is kept.
3. Commit as `chore(release): vX.Y.Z`, then tag `vX.Y.Z` and push the tag.

Installed copies pick up the release with `claude plugin update session-delete@claude-session-delete`.
