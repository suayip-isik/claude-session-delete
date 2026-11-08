import { CLAUDE_LAYOUT, REFERENCE_PATTERNS } from './config'
import { Deleter } from './cleanup/deleter'
import { HistoryInspector } from './cleanup/historyInspector'
import { HistoryPurger } from './cleanup/historyPurger'
import { SafetyPolicy } from './cleanup/safetyPolicy'
import { SessionContextResolver } from './context/sessionContext'
import type { ArtifactSource, ProcessInfo, SessionContext } from './domain'
import { Guardian } from './finalize/guardian'
import type { Host } from './host/host'
import { joinPath } from './host/paths'
import { createTextSearcher, type TextSearcher } from './host/textSearch'
import { Inventory } from './inventory/inventory'
import { Measurer } from './inventory/measurer'
import { ExclusiveReferenceSource, type ReferenceKind } from './inventory/sources/exclusiveReferenceSource'
import { RegistrySource } from './inventory/sources/registrySource'
import { ShellSnapshotSource } from './inventory/sources/shellSnapshotSource'
import { SessionKeyedSource } from './inventory/sources/sessionKeyedSource'
import { ProcessDiscovery } from './processes/processDiscovery'
import { ProcessTable } from './processes/processTable'
import { ProcessTerminator } from './processes/processTerminator'
import { SocketInspector } from './processes/socketInspector'
import { TerminalWriter } from './report/terminalWriter'
import { DeleteSessionUseCase, type InventoryFactory } from './usecase/deleteSession'

/** Wires the concrete classes together; the only module that knows them all. */
export function createDeleteSession(host: Host, trackedSnapshots: () => Promise<readonly string[]>): DeleteSessionUseCase {
  const table = new ProcessTable(host.runner)
  const sockets = new SocketInspector(host.runner)

  return new DeleteSessionUseCase({
    resolver: new SessionContextResolver(host),
    discovery: new ProcessDiscovery(table),
    sockets,
    terminator: new ProcessTerminator(host.runner, table, sockets),
    inventories: inventoryFactory(host, trackedSnapshots),
    history: new HistoryInspector(host.runner),
    historyPurger: new HistoryPurger(host),
    deleter: new Deleter(host.runner, host.fs),
    guardian: new Guardian(host),
    terminal: new TerminalWriter(host.runner),
  })
}

function inventoryFactory(host: Host, trackedSnapshots: () => Promise<readonly string[]>): InventoryFactory {
  return {
    create: async (context: SessionContext, liveProcesses: readonly ProcessInfo[]) => {
      const [policy, searcher] = await Promise.all([SafetyPolicy.create(context, host.fs), createTextSearcher(host.runner, host.fs)])
      const transcripts = transcriptSource(host)
      const keyed = [transcripts, ...sessionKeyedSources(host)]
      const cheap: ArtifactSource[] = [
        ...keyed,
        new RegistrySource(host.fs),
        new ShellSnapshotSource(host.fs, trackedSnapshots, () => liveProcesses.map(process => process.command)),
      ]
      const measurer = new Measurer(host.runner)
      const inventoryOf = (sources: readonly ArtifactSource[]): Inventory => new Inventory(sources, policy, host.fs, measurer)
      const session = inventoryOf([...cheap, referenceSource('plans', PLAN_REFERENCE, host, searcher, transcripts)])
      const promptHistoryFiles = inventoryOf([referenceSource('pasted-texts', PASTED_TEXT_REFERENCE, host, searcher, transcripts)])
      const rescan = inventoryOf(cheap)

      return {
        collect: () => session.collect(context),
        collectPromptHistoryFiles: () => promptHistoryFiles.collect(context),
        rescan: () => rescan.collect(context),
        keyedScopes: keyed.flatMap(source => source.scopes(context)),
        allowedRoots: policy.allowedRoots,
      }
    },
  }
}

function transcriptSource(host: Host): SessionKeyedSource {
  return new SessionKeyedSource('transcripts', host.fs, context => [
    { root: joinPath(context.configDir, CLAUDE_LAYOUT.projects), isNested: true },
  ])
}

/** The other entries named after the session id; cheap to list, so listed again at the exit. */
function sessionKeyedSources(host: Host): SessionKeyedSource[] {
  return [
    new SessionKeyedSource('session-data', host.fs, context =>
      CLAUDE_LAYOUT.sessionKeyedDirs.map(dir => ({ root: joinPath(context.configDir, dir), isNested: false })),
    ),
    new SessionKeyedSource('temp', host.fs, context => [{ root: context.tempRoot, isNested: true }]),
  ]
}

/** Shared files only this session uses; these need a search of other sessions, so only the plan runs them. */
function referenceSource(
  name: string,
  kind: ReferenceKind,
  host: Host,
  searcher: TextSearcher,
  transcripts: SessionKeyedSource,
): ArtifactSource {
  const transcriptPaths = async (context: SessionContext): Promise<string[]> =>
    (await transcripts.locate(context)).map(artifact => artifact.path)

  return new ExclusiveReferenceSource(name, kind, host.runner, host.fs, searcher, transcriptPaths)
}

/** Plans: matched by the session's slug in its transcripts. Part of the session itself. */
const PLAN_REFERENCE: ReferenceKind = {
  pattern: REFERENCE_PATTERNS.planSlug,
  isInTranscripts: true,
  token: match => quotedValue(match),
  pathOf: (context, token) => joinPath(context.configDir, CLAUDE_LAYOUT.plans, `${token}${REFERENCE_PATTERNS.planExtension}`),
  sharedNeedle: token => `"slug":"${token}"`,
}

/**
 * Pasted texts: named by the session's prompt-history rows, which ↑ recalls in
 * later sessions. They belong to the prompt history, so they go only with it.
 */
const PASTED_TEXT_REFERENCE: ReferenceKind = {
  pattern: REFERENCE_PATTERNS.paste,
  isInTranscripts: false,
  token: match => quotedValue(match),
  pathOf: (context, token) => joinPath(context.configDir, CLAUDE_LAYOUT.pasteCache, `${token}${REFERENCE_PATTERNS.pasteExtension}`),
}

/** `"key":"value"` → `value`. */
function quotedValue(match: string): string | undefined {
  return /"([^"]+)"$/.exec(match)?.[1]
}
