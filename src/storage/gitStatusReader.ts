import { exec } from "child_process";
import { promisify } from "util";
import * as path from "path";
import { Logger } from "../utils/logger";

const execAsync = promisify(exec);

/**
 * Reads the set of dirty/untracked files in a git working tree.
 *
 * `--no-optional-locks` keeps the read from contending for `index.lock` with the
 * user's own git commands, `-z` avoids path quoting, and `-uall` lists untracked
 * files individually instead of collapsing them into their directory.
 */
export class GitStatusReader {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** True when the folder is inside a git working tree. */
  async isRepository(cwd: string): Promise<boolean> {
    return (await this.getToplevel(cwd)) !== null;
  }

  /** Absolute paths of files git reports as changed. Empty when not a git repo. */
  async getChangedFiles(cwd: string): Promise<string[]> {
    const toplevel = await this.getToplevel(cwd);
    if (!toplevel) {
      this.logger.debug(`Not a git repository, skipping scan: ${cwd}`);
      return [];
    }

    try {
      const { stdout } = await execAsync(
        "git --no-optional-locks status --porcelain=v1 -z -uall",
        { cwd, maxBuffer: 32 * 1024 * 1024 },
      );
      return this.parseStatus(stdout, toplevel);
    } catch (error) {
      this.logger.debug(`git status failed in ${cwd}: ${error}`);
      return [];
    }
  }

  private async getToplevel(cwd: string): Promise<string | null> {
    try {
      const { stdout } = await execAsync("git rev-parse --show-toplevel", {
        cwd,
      });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Each NUL-separated record is `XY<space><path>`. For renames and copies the
   * source path follows as its own record and is skipped.
   */
  private parseStatus(stdout: string, toplevel: string): string[] {
    const records = stdout.split("\0").filter((record) => record.length > 0);
    const files: string[] = [];

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (record.length < 4) {
        continue;
      }

      const x = record[0];
      const y = record[1];
      const relativePath = record.substring(3);

      if (x === "R" || x === "C" || y === "R" || y === "C") {
        i++;
      }

      // Deletions have nothing to stat. Unmerged states keep their working copy.
      const unmerged = x === "U" || y === "U";
      if (!unmerged && (x === "D" || y === "D")) {
        continue;
      }

      files.push(path.join(toplevel, relativePath));
    }

    return files;
  }
}
