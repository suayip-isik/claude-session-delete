/** POSIX path helpers (the hooks module has no Node `path`). */

export function joinPath(...parts: readonly string[]): string {
  const joined = parts.filter(part => part.length > 0).join('/')

  return joined.replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1')
}

export function parentOf(path: string): string {
  const cut = path.replace(/\/+$/, '').lastIndexOf('/')

  return cut <= 0 ? '/' : path.slice(0, cut)
}

export function baseName(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}

/** True when `path` is strictly below `root` (never `root` itself). */
export function isStrictlyInside(path: string, root: string): boolean {
  const base = root.endsWith('/') ? root : `${root}/`

  return path.startsWith(base) && path.length > base.length
}

/** Absolute, normalised, free of `.`/`..` segments and of characters the finalizer's line format cannot carry. */
export function isPlainAbsolutePath(path: string): boolean {
  if (!path.startsWith('/') || /[\n\r\0]/.test(path)) return false

  return !path.split('/').some(segment => segment === '.' || segment === '..')
}
