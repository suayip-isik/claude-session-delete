/** Absolute paths of the shell snapshots this session created. */
export type ShellSnapshotPaths = string[]

declare module 'claude-code' {
  interface PluginState {
    'session-delete': {
      shellSnapshots: ShellSnapshotPaths
    }
  }
}
