import * as fs from "fs/promises";
import * as path from "path";
import { ChangeScanner } from "./changeScanner";
import { Logger } from "../utils/logger";

/** Directories that never contain hand-edited work. */
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  "out",
  "dist",
  "build",
  "bin",
  "obj",
  "target",
  "coverage",
  "venv",
  "__pycache__",
  "packages",
  "vendor",
]);

/** Guard against pathological trees (a home directory opened as a workspace). */
const MAX_DEPTH = 12;
const MAX_ENTRIES = 20000;

interface ScanBudget {
  remaining: number;
}

/**
 * Change scanner for workspace folders that are not git repositories.
 *
 * Walks the tree and compares file mtimes against the previous scan. Without
 * `.gitignore` to lean on, generated directories are skipped by name and
 * hidden directories are skipped entirely.
 */
export class FolderScanService implements ChangeScanner {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  async findModifiedSince(
    cwd: string,
    since: number,
    now: number,
  ): Promise<string[]> {
    const modified: string[] = [];
    const budget: ScanBudget = { remaining: MAX_ENTRIES };

    await this.walk(cwd, since, now, modified, budget, 0);

    if (budget.remaining <= 0) {
      this.logger.info(
        `Warning: folder scan of ${cwd} hit the ${MAX_ENTRIES} entry limit; some changes may be missed`,
      );
    }

    this.logger.debug(
      `Folder scan of ${cwd}: ${modified.length} file(s) modified since ${since}`,
    );
    return modified;
  }

  private async walk(
    dir: string,
    since: number,
    now: number,
    modified: string[],
    budget: ScanBudget,
    depth: number,
  ): Promise<void> {
    if (depth > MAX_DEPTH || budget.remaining <= 0) {
      return;
    }

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      this.logger.debug(`Cannot read directory ${dir}: ${error}`);
      return;
    }

    for (const entry of entries) {
      if (budget.remaining <= 0) {
        return;
      }
      budget.remaining--;

      const fullPath = path.join(dir, entry.name);

      // Symlinks can point outside the folder or form cycles.
      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        await this.walk(fullPath, since, now, modified, budget, depth + 1);
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      try {
        const stats = await fs.stat(fullPath);
        if (stats.mtimeMs > since && stats.mtimeMs <= now) {
          modified.push(fullPath);
        }
      } catch {
        // Gone or unreadable — nothing to record.
      }
    }
  }
}
