import type { Artifact, ArtifactSource, SessionContext } from '../../domain'
import type { FileSystem } from '../../host/host'
import { existingArtifacts } from './existingArtifacts'

/** The running-session registry entry (`sessions/<pid>.json`, its key) and the IPC socket it names. */
export class RegistrySource implements ArtifactSource {
  readonly name = 'registry'

  constructor(private readonly fs: FileSystem) { }

  locate(context: SessionContext): Promise<Artifact[]> {
    return existingArtifacts(this.fs, [...context.registryFiles, ...(context.socketPath ? [context.socketPath] : [])])
  }
}
