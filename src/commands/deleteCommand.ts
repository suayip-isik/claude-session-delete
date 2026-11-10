import type { EngineInterface, On } from 'claude-code'

import { COMMAND_DESCRIPTION, COMMAND_NAMES, CONFIRM, RESET_COMMAND, TIMING } from '../config'
import { createDeleteSession } from '../compositionRoot'
import { configDirFrom } from '../context/engineFacts'
import { ContextError, type SessionFacts } from '../context/sessionContext'
import type { Host } from '../host/host'
import { describe } from '../inventory/inventory'
import { confirmationQuestion } from '../report/format'
import type { PendingDeletion } from '../usecase/deleteSession'
import type { PendingDeletions } from '../usecase/pendingDeletions'

/**
 * `/delete`, answered entirely by hooks (no model turn, no usage):
 *  1. the command reads, asks and, on an explicit yes, starts the guardian,
 *     which closes the session a moment later;
 *  2. `session.end` (Claude exiting: its interface gone, the terminal still its
 *     own) stops, deletes and prints the summary, so the shell prompt follows
 *     the summary and no key is needed.
 *
 * A session hosted by an editor extension is not closed that way (ending its
 * process would show as an error and leave the panel dead): a fresh empty
 * session replaces it, then the old one is deleted and the summary is logged.
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

  const waiting = await useCase.begin(plan, choice.policy)
  if (plan.context.ending === 'exit') {
    pending.add(waiting)

    return { text: 'Closing the session; a summary is printed once the deletion is done.' }
  }
  // Not awaited: the engine refuses a command started while this one is still answering.
  void resetThenDelete($, waiting)

  return { text: 'Starting a fresh session; the deleted session\'s summary follows.' }
}

/** Hosted session: replace it with an empty one (process and panel stay), then delete what it left. */
async function resetThenDelete($: EngineInterface, waiting: PendingDeletion): Promise<void> {
  try {
    await $.clock.sleep(TIMING.resetDelayMs)
    await $.command.run({ command: RESET_COMMAND })
  } catch (error) {
    $.ui.log(`Session ${waiting.plan.context.sessionId} was not deleted: could not start a fresh session (${describe(error)}).`)

    return
  }
  try {
    $.ui.log((await deleteSessionOf($).complete(waiting)).report)
  } catch (error) {
    $.ui.log(`Session ${waiting.plan.context.sessionId} may be partly deleted: ${describe(error)}`)
  }
}

async function completeDelete($: EngineInterface, waiting: PendingDeletion): Promise<void> {
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
