import { REPORT } from '../config'
import type { DeletionResult, HistoryOutcome, HistoryPolicy, MeasuredArtifact, TerminationResult } from '../domain'
import { sum } from '../inventory/measurer'
import type { DeletionPlan } from '../usecase/deleteSession'
import { artifactsToDelete } from '../usecase/deletionScope'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** 1024-based, one decimal above bytes: `512 B`, `1.5 KB`. */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }

  return unit === 0 ? `${value} ${UNITS[unit]}` : `${value.toFixed(1)} ${UNITS[unit]}`
}

/** `1 file`, `2 files`; `plural` for irregular words (`process` → `processes`). */
export function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`
}

interface Totals {
  readonly files: number
  readonly allocatedBytes: number
}

function totalsOf(artifacts: readonly MeasuredArtifact[]): Totals {
  return {
    files: sum(artifacts.map(artifact => artifact.fileCount)),
    allocatedBytes: sum(artifacts.map(artifact => artifact.allocatedBytes)),
  }
}

/**
 * The question the confirmation dialog asks (it must end with a question
 * mark): what goes in any case, then what the prompt-history choice decides.
 */
export function confirmationQuestion(plan: DeletionPlan): string {
  const { files, allocatedBytes } = totalsOf(plan.inventory.artifacts)
  const session = [
    `${count(files, 'file')} (${formatBytes(allocatedBytes)})`,
    `${count(plan.processes.processes.length, 'process', 'processes')} to stop`,
    `${count(plan.processes.sockets.length, 'port')} to close`,
  ]
  const pastedTexts = sum(plan.promptHistory.files.artifacts.map(artifact => artifact.fileCount))
  const history =
    `Its ${count(plan.promptHistory.rows, 'prompt')} (${count(pastedTexts, 'pasted text')}) stay in ↑ history ` +
    'unless you also delete the prompt history.'
  const sibling = plan.context.siblingPids.length
    ? ` Note: this session is also open in another Claude window (PID ${plan.context.siblingPids.join(', ')}); that window is left untouched.`
    : ''

  return `Delete session ${plan.context.sessionId}: ${session.join(', ')}. ${history}${sibling} This cannot be undone. How should it be deleted?`
}

/** The short summary printed on the terminal once the session has closed and its traces are gone. */
export function deletionReport(
  plan: DeletionPlan,
  termination: TerminationResult,
  deletion: DeletionResult,
  history: HistoryOutcome,
): string {
  const totals = totalsOf(deletion.deleted)
  const historyBytes = history.policy === 'purge' ? history.bytes : 0
  const forced = termination.forced.length ? ` (${termination.forced.length} forced)` : ''
  const facts = [
    `${count(totals.files, 'file')} removed`,
    `${formatBytes(totals.allocatedBytes + historyBytes)} freed`,
    `${count(termination.stopped.length, 'process', 'processes')} stopped${forced}`,
    `${count(termination.closedSockets.length, 'port')} closed`,
    history.policy === 'purge' ? `${count(history.rows, 'history row')} removed` : 'prompt history kept',
  ]
  const lines = [
    '',
    `✔ Claude Code session ${plan.context.sessionId} deleted`,
    `  ${facts.join(' · ')}`,
    ...(plan.context.ending === 'exit' ? ['  The "claude --resume" hint above no longer applies.'] : []),
    ...warnings(plan, history.policy, termination, deletion).map(warning => `  ! ${warning}`),
    '',
  ]

  return `${lines.join('\n')}\n`
}

/**
 * Written before the exit, from the plan, for the guardian to print only if
 * Claude's exit could not run the real one (it then did the deletion itself).
 */
export function fallbackReport(plan: DeletionPlan, policy: HistoryPolicy): string {
  const termination: TerminationResult = {
    stopped: plan.processes.processes,
    forced: [],
    survivors: [],
    closedSockets: plan.processes.sockets,
    openSockets: [],
  }
  const deletion: DeletionResult = { deleted: artifactsToDelete(plan.inventory, plan.promptHistory, policy), failed: [] }
  const history: HistoryOutcome = policy === 'purge' ? { policy, rows: plan.promptHistory.rows, bytes: 0 } : { policy }

  return deletionReport(plan, termination, deletion, history)
}

/** Only what went wrong, one line each, at most REPORT.maxWarnings. */
function warnings(plan: DeletionPlan, policy: HistoryPolicy, termination: TerminationResult, deletion: DeletionResult): string[] {
  const scanned = policy === 'purge' ? [plan.inventory, plan.promptHistory.files] : [plan.inventory]
  const all = [
    ...termination.survivors.map(process => `could not stop PID ${process.pid} (${executableName(process.command)})`),
    ...termination.openSockets.map(socket => `still open: ${socket.protocol} ${socket.address} (PID ${socket.pid} ${socket.command})`),
    ...deletion.failed.map(({ artifact, reason }) => `not deleted: ${artifact.path} (${reason})`),
    ...scanned.flatMap(result => result.refused).map(({ artifact, reason }) => `skipped for safety: ${artifact.path} (${reason})`),
    ...scanned.flatMap(result => result.errors).map(error => `scan error: ${error}`),
  ]
  const shown = all.slice(0, REPORT.maxWarnings)

  return all.length > shown.length ? [...shown, `…and ${all.length - shown.length} more`] : shown
}

/** `/usr/local/bin/node server.js` → `node`. */
function executableName(command: string): string {
  return command.trim().split(/\s+/)[0]?.split('/').pop() ?? command
}
