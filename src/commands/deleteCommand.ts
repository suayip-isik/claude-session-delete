import type { EngineInterface, On } from 'claude-code'

import { COMMAND_DESCRIPTION, COMMAND_NAMES, CONFIRM, TIMING } from '../config'
import { createDeleteSession } from '../compositionRoot'
import { configDirFrom } from '../context/engineFacts'
import { ContextError, type SessionFacts } from '../context/sessionContext'
import type { Host } from '../host/host'
import { describe } from '../inventory/inventory'
import { confirmationQuestion } from '../report/format'
import type { PendingDeletions } from '../usecase/pendingDeletions'

/**
 * `/delete`, answered entirely by hooks (no model turn, no usage):
 *  1. the command reads, asks and, on an explicit yes, starts the guardian,
 *     which closes the session a moment later;
 *  2. `session.end` (Claude exiting: its interface gone, the terminal still its
 *     own) stops, deletes and prints the summary, so the shell prompt follows
 *     the summary and no key is needed.
 */
export function registerDeleteCommand(on: On, pending: PendingDeletions): void {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await registerFirstAvailableName($)

    return started
  })

  on('command.run', ($, e, next) => (isDeleteCommand(e.command) ? runDelete($, pending) : next(e))).catch((_$, e, next) =>
    isDeleteCommand(e.command)
      ? { text: `Deletion stopped unexpectedly: ${next.error.message ?? next.error.kind}. The session was not closed.` }
      : next(e),
  )

  on('session.end', async ($, e, next) => {
    const waiting = pending.take(e.sessionId)
    const ended = await next(e)
    // Too little of the exit's bound left: the guardian deletes and prints after the exit instead.
    if (waiting === undefined || next.budget.remainingMs < TIMING.sessionEndReserveMs) return ended

    await completeDelete($, waiting)

    return ended
  }).catch((_$, e, next) => next(e))
}

function isDeleteCommand(command: string): boolean {
  return (COMMAND_NAMES as readonly string[]).includes(command)
}

async function registerFirstAvailableName($: EngineInterface): Promise<void> {
  for (const name of COMMAND_NAMES) {
    try {
      await $.command.register({ name, description: COMMAND_DESCRIPTION, immediate: true })

      return
    } catch {
      // A built-in already owns this name: try the next one.
    }
  }
  $.ui.log(`${$.plugin.name}: could not register a command name (${COMMAND_NAMES.join(', ')})`)
}

async function runDelete($: EngineInterface, pending: PendingDeletions): Promise<{ text: string }> {
  const useCase = deleteSessionOf($)

  let plan
  try {
    plan = await useCase.plan(await sessionFactsOf($))
  } catch (error) {
    const prefix = error instanceof ContextError ? '' : 'Unexpected error: '

    return { text: `Could not start the deletion. ${prefix}${describe(error)} Nothing was deleted.` }
  }

  const options = [...CONFIRM.choices.map(choice => choice.label), CONFIRM.cancel]
  const answer = await $.ui.ask(confirmationQuestion(plan), { header: CONFIRM.header, options }).catch(() => CONFIRM.cancel)
  // Only an exact choice deletes: cancel, Esc, or free text typed under "Other" keeps everything.
  const choice = CONFIRM.choices.find(candidate => candidate.label === answer)
  if (choice === undefined) return { text: 'Cancelled; nothing was deleted.' }

  pending.add(await useCase.begin(plan, choice.policy))

  return { text: 'Closing the session; a summary is printed once the deletion is done.' }
}

async function completeDelete($: EngineInterface, waiting: NonNullable<ReturnType<PendingDeletions['take']>>): Promise<void> {
  await deleteSessionOf($).complete(waiting)
}

function deleteSessionOf($: EngineInterface): ReturnType<typeof createDeleteSession> {
  return createDeleteSession(hostOf($), () => trackedSnapshotsOf($))
}

/** Identity facts off the engine; the env names are literals at the call. */
async function sessionFactsOf($: EngineInterface): Promise<SessionFacts> {
  const override = await $.env.get('CLAUDE_CONFIG_DIR')
  const home = override ? undefined : await $.env.get('HOME')

  return { sessionId: await $.session.id(), configDir: configDirFrom(override, home) }
}

async function trackedSnapshotsOf($: EngineInterface): Promise<readonly string[]> {
  return (await $.state.get({ plugin: 'session-delete', key: 'shellSnapshots' })).value ?? []
}

/** The mod's whole window onto the machine, as plain engine calls. */
function hostOf($: EngineInterface): Host {
  return {
    runner: {
      run: async (argv, options) => {
        const { exitCode, stdout, stderr } = await $.process.run(argv, {
          timeoutMs: options?.timeoutMs ?? TIMING.commandTimeoutMs,
          ...(options?.stdin === undefined ? {} : { stdin: options.stdin }),
        })

        return { exitCode, stdout, stderr }
      },
    },
    fs: {
      list: async path => {
        try {
          return (await $.fs.list(path)).map(({ name, kind, isLink }) => ({ name, kind, isLink }))
        } catch {
          return []
        }
      },
      exists: path => $.fs.exists(path),
      readText: path => $.fs.read(path),
      writeText: (path, text) => $.fs.write(path, text),
      realPath: async path => {
        try {
          return (await $.fs.stat(path, { resolve: true })).realPath
        } catch {
          return undefined
        }
      },
    },
    pluginRoot: $.plugin.root,
  }
}
