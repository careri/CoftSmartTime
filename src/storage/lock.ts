import * as fs from "fs/promises";
import * as path from "path";
import { Logger } from "../utils/logger";

export class FileLock {
  private lockFile: string;
  private logger: Logger;

  constructor(lockDir: string, logger: Logger) {
    this.lockFile = path.join(lockDir, ".lock");
    this.logger = logger;
  }

  async acquire(timeoutMs: number = 1000): Promise<boolean> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      try {
        // Try to create lock file exclusively
        await fs.writeFile(this.lockFile, String(process.pid), { flag: "wx" });
        this.logger.debug("Lock acquired");
        return true;
      } catch (error: any) {
        if (error.code === "EEXIST") {
          // Lock file exists, check if it's stale
          try {
            const content = await fs.readFile(this.lockFile, "utf-8");
            const pid = parseInt(content, 10);

            // Check if process is still running
            if (!this.isProcessRunning(pid)) {
              // Stale lock, remove it
              await fs.unlink(this.lockFile);
              continue;
            }
          } catch {
            // If we can't read the lock file, try to remove it
            try {
              await fs.unlink(this.lockFile);
            } catch {
              // Ignore errors
            }
          }

          // Wait a bit before retrying
          await this.sleep(100);
        } else {
          this.logger.error(`Error acquiring lock: ${error}`);
          return false;
        }
      }
    }

    this.logger.info("Failed to acquire lock within timeout");
    return false;
  }

  async release(): Promise<void> {
    try {
      await fs.unlink(this.lockFile);
      this.logger.debug("Lock released");
    } catch (error) {
      this.logger.error(`Error releasing lock: ${error}`);
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      // Sending signal 0 checks if process exists without killing it
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
