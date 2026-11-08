import type { Deleter } from '../cleanup/deleter'
import type { HistoryInspector } from '../cleanup/historyInspector'
import type { HistoryPurger } from '../cleanup/historyPurger'
import type { SessionContextResolver, SessionFacts } from '../context/sessionContext'
import type { MeasuredArtifact, ProcessInfo, ProcessPlan, SessionContext } from '../domain'
import type { Guardian, GuardianHandle } from '../finalize/guardian'
import type { InventoryResult } from '../inventory/inventory'
import type { KeyedScope } from '../inventory/sources/sessionKeyedSource'
import type { ProcessDiscovery } from '../processes/processDiscovery'
import type { ProcessTerminator } from '../processes/processTerminator'
import type { SocketInspector } from '../processes/socketInspector'
import { deletionReport, fallbackReport } from '../report/format'
import type { TerminalWriter } from '../report/terminalWriter'

export interface DeletionPlan {
  readonly context: SessionContext
  readonly processes: ProcessPlan
  readonly inventory: InventoryResult
  readonly historyRows: number
  readonly allowedRoots: readonly string[]
  /** Where entries named after the session can appear, even after the plan (swept again after the exit). */
  readonly keyedScopes: readonly KeyedScope[]
}

/** A confirmed deletion whose session is closing; finished by `complete` inside Claude's exit. */
export interface PendingDeletion {
  readonly plan: DeletionPlan
  readonly guardian: GuardianHandle
}

export interface CompletionResult {
  readonly report: string
  readonly isPrinted: boolean
}

/** Builds what depends on the resolved context (the safety roots, the sources that read live processes). */
export interface InventoryFactory {
  create(context: SessionContext, liveProcesses: readonly ProcessInfo[]): Promise<{
    /** Every source, the shared-file searches included (the plan). */
    readonly collect: () => Promise<InventoryResult>
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
 *  - `begin`    on a yes: starts the guardian, which closes the session at once;
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

    return {
      context,
      processes: { processes, sockets },
      inventory: await inventory.collect(),
      historyRows,
      allowedRoots: inventory.allowedRoots,
      keyedScopes: inventory.keyedScopes,
    }
  }

  async begin(plan: DeletionPlan): Promise<PendingDeletion> {
    const guardian = await this.deps.guardian.start({
      context: plan.context,
      sweepPaths: plan.inventory.artifacts.map(artifact => artifact.path),
      keyedScopes: plan.keyedScopes,
      allowedRoots: plan.allowedRoots,
      processes: plan.processes.processes,
      fallbackReport: fallbackReport(plan),
    })

    return { plan, guardian }
  }

  async complete(pending: PendingDeletion): Promise<CompletionResult> {
    const { plan } = pending
    const termination = await this.deps.terminator.terminate(plan.processes)
    // Entries written since the plan (a short session's transcript) are found again here.
    const fresh = await (await this.deps.inventories.create(plan.context, plan.processes.processes)).rescan()
    const deletion = await this.deps.deleter.delete(mergeByPath(plan.inventory.artifacts, fresh.artifacts))
    const history = await this.deps.historyPurger.purge(plan.context)
    const report = deletionReport(plan, termination, deletion, history)

    const isPrinted = await this.deps.terminal.write(plan.context.tty, report)
    if (isPrinted) await this.deps.guardian.markPrinted(pending.guardian)

    return { report, isPrinted }
  }
}

/** One entry per path; a fresh measurement replaces the plan's. */
function mergeByPath(planned: readonly MeasuredArtifact[], fresh: readonly MeasuredArtifact[]): MeasuredArtifact[] {
  return [...new Map([...planned, ...fresh].map(artifact => [artifact.path, artifact])).values()]
}
