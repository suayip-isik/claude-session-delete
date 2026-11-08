import type { EngineInterface, On } from 'claude-code'

import { COMMAND_DESCRIPTION, COMMAND_NAMES, CONFIRM, TIMING } from '../config'
import { createDeleteSession } from '../compositionRoot'
import { readSessionFacts, trackedShellSnapshots } from '../context/engineFacts'
import { ContextError } from '../context/sessionContext'
import { createHost } from '../host/host'
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

    await createDeleteSession(createHost($), () => trackedShellSnapshots($)).complete(waiting)

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
  const useCase = createDeleteSession(createHost($), () => trackedShellSnapshots($))

  let plan
  try {
    plan = await useCase.plan(await readSessionFacts($))
  } catch (error) {
    const prefix = error instanceof ContextError ? '' : 'Unexpected error: '

    return { text: `Could not start the deletion. ${prefix}${describe(error)} Nothing was deleted.` }
  }

  const answer = await $.ui
    .ask(confirmationQuestion(plan), { header: CONFIRM.header, options: [CONFIRM.approve, CONFIRM.cancel] })
    .catch(() => CONFIRM.cancel)
  if (answer !== CONFIRM.approve) return { text: 'Cancelled; nothing was deleted.' }

  pending.add(await useCase.begin(plan))

  return { text: 'Closing the session; a summary is printed once the deletion is done.' }
}
