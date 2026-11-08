## What and why

<!-- What does this change, and why? Link the issue it closes. -->

Closes #

## How it was tested

<!-- `pnpm run check` output, and what you did in a real (throwaway) session. -->

- [ ] `pnpm run check` passes
- [ ] Tried in a real session with `/delete`, where relevant

## Checklist

- [ ] Tests cover what is deleted **and** what is kept
- [ ] No hard-coded values: paths, binaries and limits live in `src/config.ts`
- [ ] No dead code left behind
- [ ] `CHANGELOG.md` updated under `Unreleased`
- [ ] Docs updated (README, CONTRIBUTING) if behaviour changed
