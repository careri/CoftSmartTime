import * as fs from "fs/promises";
import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { GitManager } from "./git";

export interface StorageRequest {
  type: "timebatch" | "timereport" | "projects";
  file: string;
  body: any;
}

export class StorageQueueWriter {
  static async write(
    config: CoftConfig,
    request: StorageRequest,
    outputChannel: vscode.OutputChannel,
  ): Promise<void> {
    const timestamp = Date.now();
    const hash = crypto
      .createHash("sha256")
      .update(`${request.type}:${request.file}:${timestamp}`)
      .digest("hex")
      .substring(0, 12);
    const filename = `${timestamp}_${hash}.json`;
    const filePath = path.join(config.storageQueue, filename);

    await fs.mkdir(config.storageQueue, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(request, null, 2), "utf-8");
    outputChannel.appendLine(
      `Storage request created: ${filename} (${request.type})`,
    );
  }
}

export class StorageQueueProcessor {
  private config: CoftConfig;
  private git: GitManager;
  private outputChannel: vscode.OutputChannel;
  private timer: NodeJS.Timeout | null = null;
  private failureCounts: Map<string, number> = new Map();
  private maxFailures: number = 5;
  private intervalMs: number = 10000;
  private processing: boolean = false;

  constructor(
    config: CoftConfig,
    git: GitManager,
    outputChannel: vscode.OutputChannel,
  ) {
    this.config = config;
    this.git = git;
    this.outputChannel = outputChannel;
  }

  start(): void {
    this.outputChannel.appendLine(
      "Starting storage queue processor (10s interval)",
    );
    this.timer = setInterval(() => this.processQueue(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.outputChannel.appendLine("Storage queue processor stopped");
    }
  }

  async processQueue(): Promise<void> {
    if (this.processing) {
      this.outputChannel.appendLine(
        "Storage queue processor already running, skipping",
      );
      return;
    }

    this.processing = true;
    try {
      let files: string[];
      try {
        files = await fs.readdir(this.config.storageQueue);
      } catch {
        return;
      }

      const requestFiles = files.filter((f) => f.endsWith(".json")).sort();

      if (requestFiles.length === 0) {
        return;
      }

      this.outputChannel.appendLine(
        `--- Processing ${requestFiles.length} storage request(s) ---`,
      );

      for (const file of requestFiles) {
        await this.processRequest(file);
      }

      this.outputChannel.appendLine(
        "--- Storage queue processing completed ---",
      );
    } catch (error) {
      this.outputChannel.appendLine(`Error processing storage queue: ${error}`);
    } finally {
      this.processing = false;
    }
  }

  private async processRequest(filename: string): Promise<void> {
    const requestPath = path.join(this.config.storageQueue, filename);

    try {
      const content = await fs.readFile(requestPath, "utf-8");
      const request: StorageRequest = JSON.parse(content);

      // Write the file to the data directory
      const targetPath = path.join(this.config.data, request.file);
      const targetDir = path.dirname(targetPath);
      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(
        targetPath,
        JSON.stringify(request.body, null, 2),
        "utf-8",
      );

      // Commit the change
      await this.git.commit(`${request.type}: ${request.file}`);

      // Delete the processed request
      await fs.unlink(requestPath);
      this.failureCounts.delete(filename);
      this.outputChannel.appendLine(
        `Storage request processed: ${filename} (${request.type})`,
      );
    } catch (error) {
      const count = (this.failureCounts.get(filename) || 0) + 1;
      this.failureCounts.set(filename, count);
      this.outputChannel.appendLine(
        `Error processing storage request ${filename} (attempt ${count}/${this.maxFailures}): ${error}`,
      );

      if (count >= this.maxFailures) {
        await this.moveToBackup(filename, requestPath);
      }
    }
  }

  private async moveToBackup(
    filename: string,
    requestPath: string,
  ): Promise<void> {
    const backupPath = path.join(this.config.storageQueueBackup, filename);
    await fs.mkdir(this.config.storageQueueBackup, { recursive: true });

    try {
      await fs.rename(requestPath, backupPath);
      this.failureCounts.delete(filename);
      this.outputChannel.appendLine(
        `Storage request moved to backup: ${filename}`,
      );
      vscode.window.showErrorMessage(
        `COFT SmartTime: Storage request failed too many times and was moved to backup: ${filename}`,
      );
    } catch (moveError) {
      this.outputChannel.appendLine(
        `Error moving request to backup: ${moveError}`,
      );
    }
  }
}
