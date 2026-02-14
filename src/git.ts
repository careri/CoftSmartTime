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
      // Check if data directory is already a git repo
      try {
        await this.execGit("rev-parse --git-dir");
        this.outputChannel.appendLine("Git repository already initialized");
      } catch {
        // Initialize git repo
        await this.execGit("init");
        await this.execGit('config user.name "COFT SmartTime"');
        await this.execGit('config user.email "smarttime@coft.local"');
        // Create .gitignore to exclude lock file
        const gitignorePath = path.join(this.config.data, ".gitignore");
        await fs.writeFile(gitignorePath, ".lock\n", "utf-8");
        this.outputChannel.appendLine("Git repository initialized");
      }
    } catch (error) {
      this.outputChannel.appendLine(`Error initializing git: ${error}`);
      throw error;
    }
  }

  async commit(message?: string): Promise<void> {
    try {
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
