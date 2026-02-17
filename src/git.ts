import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";

const execAsync = promisify(exec);

export class GitManager {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;
  private extensionVersion: string;

  constructor(
    config: CoftConfig,
    outputChannel: vscode.OutputChannel,
    extensionVersion: string,
  ) {
    this.config = config;
    this.outputChannel = outputChannel;
    this.extensionVersion = extensionVersion;
  }

  async initialize(): Promise<void> {
    try {
      await this.ensureRepo();
      await this.ensureBackupRepo();
    } catch (error) {
      this.outputChannel.appendLine(`Error initializing git: ${error}`);
      throw error;
    }
  }

  private async ensureRepo(): Promise<void> {
    const gitDir = path.join(this.config.data, ".git");

    try {
      await fs.access(gitDir);
    } catch {
      // No .git directory — initialize a fresh repo
      await this.initRepo();
      return;
    }

    // .git exists — verify it's healthy
    try {
      await this.execGit("rev-parse --git-dir");
    } catch {
      // Repo is broken — back it up and reinitialize
      await this.backupBrokenRepo();
      await this.initRepo();
      return;
    }

    // Ensure .gitignore is up to date
    await this.writeGitignore();
  }

  private async initRepo(): Promise<void> {
    await fs.mkdir(this.config.data, { recursive: true });
    await this.execGit("init");
    await this.execGit('config user.name "COFT SmartTime"');
    await this.execGit('config user.email "smarttime@coft.local"');
    await this.writeGitignore();
    this.outputChannel.appendLine("Git repository initialized");
  }

  private async writeGitignore(): Promise<void> {
    const gitignorePath = path.join(this.config.data, ".gitignore");
    await fs.writeFile(gitignorePath, ".lock\n.last-housekeeping\n", "utf-8");
  }

  private async backupBrokenRepo(): Promise<void> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const backupPath = `${this.config.data}_backup_${timestamp}`;
    this.outputChannel.appendLine(
      `Git repository is broken, backing up to: ${backupPath}`,
    );
    vscode.window.showWarningMessage(
      `COFT SmartTime: Git repo was broken. Backed up to ${backupPath}`,
    );
    await fs.rename(this.config.data, backupPath);
    await fs.mkdir(this.config.data, { recursive: true });
  }

  async commit(message?: string): Promise<void> {
    try {
      // Ensure repo is healthy before committing
      await this.ensureRepo();

      // Add all changes
      await this.execGit("add .");

      // Check if there are changes to commit
      try {
        await this.execGit("diff --cached --exit-code");
        this.outputChannel.appendLine("No changes to commit");
        return;
      } catch {
        // There are changes, proceed with commit
      }

      // Commit with extension version as message
      const commitMessage = message || this.extensionVersion;
      await this.execGit(`commit -m "${commitMessage}"`);
      this.outputChannel.appendLine(`Git commit created: ${commitMessage}`);
    } catch (error) {
      this.outputChannel.appendLine(`Error creating git commit: ${error}`);
      throw error;
    }
  }

  async getBranch(
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync("git rev-parse --abbrev-ref HEAD", {
        cwd: workspaceFolder.uri.fsPath,
      });
      return stdout.trim();
    } catch {
      return undefined;
    }
  }

  private async ensureBackupRepo(): Promise<void> {
    const bareGitDir = path.join(this.config.backup, "HEAD");

    try {
      await fs.access(bareGitDir);
    } catch {
      // No bare repo — initialize fresh
      await this.initBareRepo();
      await this.setOrigin();
      return;
    }

    // HEAD exists — verify it's healthy
    try {
      await execAsync("git rev-parse --git-dir", { cwd: this.config.backup });
      this.outputChannel.appendLine("Backup bare repository already exists");
    } catch {
      // Broken bare repo — back it up and reinitialize
      await this.backupBrokenBackupRepo();
      await this.initBareRepo();
    }

    await this.setOrigin();
  }

  private async initBareRepo(): Promise<void> {
    await fs.mkdir(this.config.backup, { recursive: true });
    await execAsync("git init --bare", { cwd: this.config.backup });
    this.outputChannel.appendLine("Backup bare repository initialized");
  }

  private async backupBrokenBackupRepo(): Promise<void> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, "-")
      .replace("T", "_")
      .replace("Z", "");
    const brokenPath = `${this.config.backup}_broken_${timestamp}`;
    this.outputChannel.appendLine(
      `Backup bare repo is broken, renaming to: ${brokenPath}`,
    );
    vscode.window.showWarningMessage(
      `COFT SmartTime: Backup repo was broken. Renamed to ${brokenPath}`,
    );
    await fs.rename(this.config.backup, brokenPath);
    await fs.mkdir(this.config.backup, { recursive: true });
  }

  private async setOrigin(): Promise<void> {
    // Ensure origin is set to backup
    try {
      const { stdout } = await this.execGit("remote get-url origin");
      if (stdout.trim() !== this.config.backup) {
        await this.execGit(`remote set-url origin "${this.config.backup}"`);
        this.outputChannel.appendLine("Updated origin to backup repo");
      }
    } catch {
      await this.execGit(`remote add origin "${this.config.backup}"`);
      this.outputChannel.appendLine("Added origin pointing to backup repo");
    }
  }

  async housekeeping(): Promise<void> {
    this.outputChannel.appendLine("--- Starting housekeeping ---");

    try {
      // git gc in data repo
      this.outputChannel.appendLine("Running git gc...");
      await this.execGit("gc --auto");
      this.outputChannel.appendLine("git gc completed");

      // git push to backup
      this.outputChannel.appendLine("Pushing to backup...");
      try {
        await this.execGit("push origin --all");
        this.outputChannel.appendLine("Push to backup completed");
      } catch (error) {
        this.outputChannel.appendLine(`Push to backup failed: ${error}`);
        vscode.window.showWarningMessage(
          `COFT SmartTime: Failed to push to backup: ${error}`,
        );
      }

      // Export time reports
      await this.exportTimeReports();

      // Record successful housekeeping
      const housekeepingPath = path.join(
        this.config.data,
        ".last-housekeeping",
      );
      const today = new Date().toISOString().split("T")[0];
      await fs.writeFile(housekeepingPath, today, "utf-8");

      this.outputChannel.appendLine("--- Housekeeping completed ---");
    } catch (error) {
      this.outputChannel.appendLine(`Housekeeping error: ${error}`);
      vscode.window.showErrorMessage(
        `COFT SmartTime: Housekeeping failed: ${error}`,
      );
    }
  }

  async exportTimeReports(): Promise<void> {
    if (!this.config.exportDir) {
      return;
    }

    this.outputChannel.appendLine("Exporting time reports...");

    try {
      await fs.mkdir(this.config.exportDir, { recursive: true });

      const reportsDir = path.join(this.config.data, "reports");
      try {
        await fs.access(reportsDir);
      } catch {
        this.outputChannel.appendLine(
          "No reports directory found, skipping export",
        );
        return;
      }

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.exportAgeDays);

      let exportedCount = 0;

      const years = await fs.readdir(reportsDir);
      for (const year of years) {
        const yearPath = path.join(reportsDir, year);
        const yearStat = await fs.stat(yearPath);
        if (!yearStat.isDirectory()) {
          continue;
        }

        const months = await fs.readdir(yearPath);
        for (const month of months) {
          const monthPath = path.join(yearPath, month);
          const monthStat = await fs.stat(monthPath);
          if (!monthStat.isDirectory()) {
            continue;
          }

          const days = await fs.readdir(monthPath);
          for (const dayFile of days) {
            if (!dayFile.endsWith(".json")) {
              continue;
            }

            const day = dayFile.replace(".json", "");
            const reportDate = new Date(`${year}-${month}-${day}T00:00:00`);

            if (isNaN(reportDate.getTime()) || reportDate < cutoffDate) {
              continue;
            }

            const exportSubDir = path.join(this.config.exportDir, year, month);
            const exportPath = path.join(exportSubDir, dayFile);

            try {
              await fs.access(exportPath);
              // Already exists, skip
              continue;
            } catch {
              // Does not exist, export it
            }

            await fs.mkdir(exportSubDir, { recursive: true });
            const sourcePath = path.join(monthPath, dayFile);
            await fs.copyFile(sourcePath, exportPath);
            exportedCount++;
          }
        }
      }

      this.outputChannel.appendLine(`Exported ${exportedCount} time report(s)`);
    } catch (error) {
      this.outputChannel.appendLine(`Export failed: ${error}`);
      vscode.window.showWarningMessage(
        `COFT SmartTime: Failed to export time reports: ${error}`,
      );
    }
  }

  async isFirstCommitToday(): Promise<boolean> {
    try {
      const housekeepingPath = path.join(
        this.config.data,
        ".last-housekeeping",
      );
      const lastDate = (await fs.readFile(housekeepingPath, "utf-8")).trim();
      const today = new Date().toISOString().split("T")[0];
      return lastDate !== today;
    } catch {
      // File doesn't exist — housekeeping has never run
      return true;
    }
  }

  private async execGit(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execAsync(`git ${command}`, { cwd: this.config.data });
  }
}
