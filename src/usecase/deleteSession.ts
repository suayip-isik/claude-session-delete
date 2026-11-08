import type { Deleter } from '../cleanup/deleter'
import type { HistoryInspector } from '../cleanup/historyInspector'
import type { HistoryPurger } from '../cleanup/historyPurger'
import type { SessionContextResolver, SessionFacts } from '../context/sessionContext'
import type { HistoryOutcome, HistoryPolicy, MeasuredArtifact, ProcessInfo, ProcessPlan, SessionContext } from '../domain'
import type { Guardian, GuardianHandle } from '../finalize/guardian'
import type { InventoryResult } from '../inventory/inventory'
import type { KeyedScope } from '../inventory/sources/sessionKeyedSource'
import type { ProcessDiscovery } from '../processes/processDiscovery'
import type { ProcessTerminator } from '../processes/processTerminator'
import type { SocketInspector } from '../processes/socketInspector'
import { deletionReport, fallbackReport } from '../report/format'
import type { TerminalWriter } from '../report/terminalWriter'
import { artifactsToDelete, type PromptHistoryPlan } from './deletionScope'

export interface DeletionPlan {
  readonly context: SessionContext
  readonly processes: ProcessPlan
  /** The session's own traces, deleted whatever the prompt-history choice. */
  readonly inventory: InventoryResult
  readonly promptHistory: PromptHistoryPlan
  readonly allowedRoots: readonly string[]
  /** Where entries named after the session can appear, even after the plan (swept again after the exit). */
  readonly keyedScopes: readonly KeyedScope[]
}

/** A confirmed deletion whose session is closing; finished by `complete` inside Claude's exit. */
export interface PendingDeletion {
  readonly plan: DeletionPlan
  readonly historyPolicy: HistoryPolicy
  readonly guardian: GuardianHandle
}

export interface CompletionResult {
  readonly report: string
  readonly isPrinted: boolean
}

/** Builds what depends on the resolved context (the safety roots, the sources that read live processes). */
export interface InventoryFactory {
  create(context: SessionContext, liveProcesses: readonly ProcessInfo[]): Promise<{
    /** The session's own traces, the shared-file searches included (the plan). */
    readonly collect: () => Promise<InventoryResult>
    /** The files only the session's prompt-history rows point to (the plan). */
    readonly collectPromptHistoryFiles: () => Promise<InventoryResult>
    /** The cheap sources only, fast enough for Claude's exit. */
    readonly rescan: () => Promise<InventoryResult>
    readonly keyedScopes: readonly KeyedScope[]
    readonly allowedRoots: readonly string[]
  }>
}

export interface DeleteSessionDependencies {
  readonly resolver: SessionContextResolver
  readonly discovery: ProcessDiscovery
  readonly sockets: SocketInspector
  readonly terminator: ProcessTerminator
  readonly inventories: InventoryFactory
  readonly history: HistoryInspector
  readonly historyPurger: HistoryPurger
  readonly deleter: Deleter
  readonly guardian: Guardian
  readonly terminal: TerminalWriter
}

/**
 * The /delete flow in three steps:
 *  - `plan`     reads only, before the confirmation;
 *  - `begin`    on a yes, with the prompt-history choice: starts the guardian,
 *               which closes the session at once;
 *  - `complete` inside Claude's exit (`session.end`): the interface is gone but
 *               Claude still holds the terminal, so it stops, deletes and prints
 *               the summary before the shell prompt returns.
 */
export class DeleteSessionUseCase {
  constructor(private readonly deps: DeleteSessionDependencies) { }

  async plan(facts: SessionFacts): Promise<DeletionPlan> {
    const context = await this.deps.resolver.resolve(facts)
    const processes = await this.deps.discovery.discover(context)
    const [sockets, inventory, historyRows] = await Promise.all([
      this.deps.sockets.listening(processes.map(process => process.pid)),
      this.deps.inventories.create(context, processes),
      this.deps.history.countRows(context),
    ])

    const [session, promptHistoryFiles] = await Promise.all([inventory.collect(), inventory.collectPromptHistoryFiles()])

    return {
      context,
      processes: { processes, sockets },
      inventory: session,
      promptHistory: { rows: historyRows, files: promptHistoryFiles },
      allowedRoots: inventory.allowedRoots,
      keyedScopes: inventory.keyedScopes,
    }
  }

  async begin(plan: DeletionPlan, historyPolicy: HistoryPolicy): Promise<PendingDeletion> {
    const guardian = await this.deps.guardian.start({
      context: plan.context,
      sweepPaths: artifactsToDelete(plan.inventory, plan.promptHistory, historyPolicy).map(artifact => artifact.path),
      keyedScopes: plan.keyedScopes,
      allowedRoots: plan.allowedRoots,
      processes: plan.processes.processes,
      historyPolicy,
      fallbackReport: fallbackReport(plan, historyPolicy),
    })

    return { plan, historyPolicy, guardian }
  }

  async complete(pending: PendingDeletion): Promise<CompletionResult> {
    const { plan, historyPolicy } = pending
    const termination = await this.deps.terminator.terminate(plan.processes)
    // Entries written since the plan (a short session's transcript) are found again here.
    const fresh = await (await this.deps.inventories.create(plan.context, plan.processes.processes)).rescan()
    const planned = artifactsToDelete(plan.inventory, plan.promptHistory, historyPolicy)
    const deletion = await this.deps.deleter.delete(mergeByPath(planned, fresh.artifacts))
    const history = await this.historyOutcome(plan.context, historyPolicy)
    const report = deletionReport(plan, termination, deletion, history)

    const isPrinted = await this.deps.terminal.write(plan.context.tty, report)
    if (isPrinted) await this.deps.guardian.markPrinted(pending.guardian)

    return { report, isPrinted }
  }

  private async historyOutcome(context: SessionContext, policy: HistoryPolicy): Promise<HistoryOutcome> {
    if (policy === 'keep') return { policy }
    const { rows, bytes } = await this.deps.historyPurger.purge(context)

    return { policy, rows, bytes }
  }
}

/** One entry per path; a fresh measurement replaces the plan's. */
function mergeByPath(planned: readonly MeasuredArtifact[], fresh: readonly MeasuredArtifact[]): MeasuredArtifact[] {
  return [...new Map([...planned, ...fresh].map(artifact => [artifact.path, artifact])).values()]
}
