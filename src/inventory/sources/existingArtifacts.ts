import type { Artifact } from '../../domain'
import type { FileSystem } from '../../host/host'

/** The paths that exist now, as items to delete, in their given order and without duplicates. */
export async function existingArtifacts(fs: FileSystem, paths: readonly string[]): Promise<Artifact[]> {
  const unique = [...new Set(paths)]
  const exists = await Promise.all(unique.map(path => fs.exists(path)))

  return unique.filter((_, index) => exists[index]).map(path => ({ path }))
}
