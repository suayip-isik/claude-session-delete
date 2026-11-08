import { REPORT } from '../config'
import type { DeletionResult, MeasuredArtifact, TerminationResult } from '../domain'
import { sum } from '../inventory/measurer'
import type { HistoryPurge } from '../cleanup/historyPurger'
import type { DeletionPlan } from '../usecase/deleteSession'

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

/** The question the confirmation dialog asks; it must end with a question mark. */
export function confirmationQuestion(plan: DeletionPlan): string {
  const { files, allocatedBytes } = totalsOf(plan.inventory.artifacts)
  const parts = [
    `${count(files, 'file')} (${formatBytes(allocatedBytes)})`,
    `${count(plan.processes.processes.length, 'process', 'processes')} to stop`,
    `${count(plan.processes.sockets.length, 'port')} to close`,
    `${count(plan.historyRows, 'history row')}`,
  ]
  const sibling = plan.context.siblingPids.length
    ? ` Note: this session is also open in another Claude window (PID ${plan.context.siblingPids.join(', ')}); that window is left untouched.`
    : ''

  return `Permanently delete session ${plan.context.sessionId}: ${parts.join(', ')}.${sibling} This cannot be undone. Continue?`
}

/** The short summary printed on the terminal once the session has closed and its traces are gone. */
export function deletionReport(
  plan: DeletionPlan,
  termination: TerminationResult,
  deletion: DeletionResult,
  history: HistoryPurge,
): string {
  const totals = totalsOf(deletion.deleted)
  const forced = termination.forced.length ? ` (${termination.forced.length} forced)` : ''
  const facts = [
    `${count(totals.files, 'file')} removed`,
    `${formatBytes(totals.allocatedBytes + history.bytes)} freed`,
    `${count(termination.stopped.length, 'process', 'processes')} stopped${forced}`,
    `${count(termination.closedSockets.length, 'port')} closed`,
    `${count(history.rows, 'history row')} removed`,
  ]
  const lines = [
    '',
    `✔ Claude Code session ${plan.context.sessionId} deleted`,
    `  ${facts.join(' · ')}`,
    '  The "claude --resume" hint above no longer applies.',
    ...warnings(plan, termination, deletion).map(warning => `  ! ${warning}`),
    '',
  ]

  return `${lines.join('\n')}\n`
}

/**
 * Written before the exit, from the plan, for the guardian to print only if
 * Claude's exit could not run the real one (it then did the deletion itself).
 */
export function fallbackReport(plan: DeletionPlan): string {
  const termination: TerminationResult = {
    stopped: plan.processes.processes,
    forced: [],
    survivors: [],
    closedSockets: plan.processes.sockets,
    openSockets: [],
  }
  const deletion: DeletionResult = { deleted: plan.inventory.artifacts, failed: [] }
  const history: HistoryPurge = { rows: plan.historyRows, bytes: 0 }

  return deletionReport(plan, termination, deletion, history)
}

/** Only what went wrong, one line each, at most REPORT.maxWarnings. */
function warnings(plan: DeletionPlan, termination: TerminationResult, deletion: DeletionResult): string[] {
  const all = [
    ...termination.survivors.map(process => `could not stop PID ${process.pid} (${executableName(process.command)})`),
    ...termination.openSockets.map(socket => `still open: ${socket.protocol} ${socket.address} (PID ${socket.pid} ${socket.command})`),
    ...deletion.failed.map(({ artifact, reason }) => `not deleted: ${artifact.path} (${reason})`),
    ...plan.inventory.refused.map(({ artifact, reason }) => `skipped for safety: ${artifact.path} (${reason})`),
    ...plan.inventory.errors.map(error => `scan error: ${error}`),
  ]
  const shown = all.slice(0, REPORT.maxWarnings)

  return all.length > shown.length ? [...shown, `…and ${all.length - shown.length} more`] : shown
}

/** `/usr/local/bin/node server.js` → `node`. */
function executableName(command: string): string {
  return command.trim().split(/\s+/)[0]?.split('/').pop() ?? command
}
