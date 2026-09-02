/**
 * Finds files that changed on disk since a previous scan.
 *
 * Implemented by `GitScanService` (uses `git status` and honours `.gitignore`)
 * and `FolderScanService` (plain directory walk, for folders outside git).
 */
export interface ChangeScanner {
  /** Absolute paths of files with `since < mtime <= now`. */
  findModifiedSince(cwd: string, since: number, now: number): Promise<string[]>;
}
