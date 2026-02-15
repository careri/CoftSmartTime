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
    }
  }

  private async initRepo(): Promise<void> {
    await fs.mkdir(this.config.data, { recursive: true });
    await this.execGit("init");
    await this.execGit('config user.name "COFT SmartTime"');
    await this.execGit('config user.email "smarttime@coft.local"');
    const gitignorePath = path.join(this.config.data, ".gitignore");
    await fs.writeFile(gitignorePath, ".lock\n", "utf-8");
    this.outputChannel.appendLine("Git repository initialized");
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

  private async execGit(
    command: string,
  ): Promise<{ stdout: string; stderr: string }> {
    return execAsync(`git ${command}`, { cwd: this.config.data });
  }
}
