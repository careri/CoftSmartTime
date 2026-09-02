import * as fs from "fs/promises";
import { ChangeScanner } from "./changeScanner";
import { GitStatusReader } from "../storage/gitStatusReader";
import { Logger } from "../utils/logger";

/** The parts of `fs.Stats` the scan needs, so tests can supply a stub. */
export interface FileStat {
  isFile(): boolean;
  mtimeMs: number;
}

export type StatFunction = (filePath: string) => Promise<FileStat>;

/**
 * Finds files that changed on disk without a VS Code save event.
 *
 * `git status` supplies the candidate set (dirty and untracked files only, so
 * `.gitignore` filtering comes for free) and the file mtime decides whether the
 * change happened since the previous scan.
 */
export class GitScanService implements ChangeScanner {
  private statusReader: GitStatusReader;
  private logger: Logger;
  private stat: StatFunction;

  constructor(
    statusReader: GitStatusReader,
    logger: Logger,
    stat: StatFunction = (filePath: string) => fs.stat(filePath),
  ) {
    this.statusReader = statusReader;
    this.logger = logger;
    this.stat = stat;
  }

  /** True when the folder is inside a git working tree. */
  async canScan(cwd: string): Promise<boolean> {
    return this.statusReader.isRepository(cwd);
  }

  /**
   * Absolute paths of changed files with `since < mtime <= now`.
   * The upper bound keeps files written during the scan for the next tick and
   * stops a future-dated file from being reported on every tick.
   */
  async findModifiedSince(
    cwd: string,
    since: number,
    now: number,
  ): Promise<string[]> {
    const candidates = await this.statusReader.getChangedFiles(cwd);
    const modified: string[] = [];

    for (const candidate of candidates) {
      try {
        const stats = await this.stat(candidate);
        if (!stats.isFile()) {
          continue;
        }
        if (stats.mtimeMs > since && stats.mtimeMs <= now) {
          modified.push(candidate);
        }
      } catch {
        // Gone between status and stat, or unreadable — nothing to record.
      }
    }

    this.logger.debug(
      `Git scan of ${cwd}: ${candidates.length} candidate(s), ${modified.length} modified since ${since}`,
    );
    return modified;
  }
}
