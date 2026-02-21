import { exec } from "child_process";
import { promisify } from "util";
import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { GitRepository } from "./gitRepository";

const execAsync = promisify(exec);

export class GitManager {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;
  private extensionVersion: string;
  private gitRepository: GitRepository;

  constructor(
    config: CoftConfig,
    outputChannel: vscode.OutputChannel,
    extensionVersion: string,
  ) {
    this.config = config;
    this.outputChannel = outputChannel;
    this.extensionVersion = extensionVersion;
    this.gitRepository = new GitRepository(config, outputChannel);
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
    await this.gitRepository.writeGitignore();
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
      await this.gitRepository.exportTimeReports();

      // Record successful housekeeping
      const today = new Date().toISOString().split("T")[0];
      await this.gitRepository.writeHousekeeping(today);

      this.outputChannel.appendLine("--- Housekeeping completed ---");
    } catch (error) {
      this.outputChannel.appendLine(`Housekeeping error: ${error}`);
      vscode.window.showErrorMessage(
        `COFT SmartTime: Housekeeping failed: ${error}`,
      );
    }
  }

  async exportTimeReports(): Promise<void> {
    await this.gitRepository.exportTimeReports();
  }

  async isFirstCommitToday(): Promise<boolean> {
    const lastDate = await this.gitRepository.readLastHousekeeping();
    if (lastDate === null) {
      return true;
    }
    const today = new Date().toISOString().split("T")[0];
    return lastDate !== today;
  }

  private async execGit(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execAsync(`git ${command}`, { cwd: this.config.data });
  }
}
