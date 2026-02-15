import * as fs from "fs/promises";
import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";

export interface QueueEntry {
  directory: string;
  filename: string;
  gitBranch: string | null;
  timestamp: number;
}

export interface BatchFileEntry {
  File: string;
  Timestamp: number;
}

export interface BatchEntry {
  [branch: string]: {
    [directory: string]: BatchFileEntry[];
  };
}

export class StorageManager {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
  }

  async initialize(): Promise<boolean> {
    try {
      // Create root directory if it doesn't exist
      try {
        await fs.access(this.config.root);
      } catch {
        this.outputChannel.appendLine(
          `COFT_ROOT directory does not exist, creating: ${this.config.root}`,
        );
        await fs.mkdir(this.config.root, { recursive: true });
      }

      // Create subdirectories if they don't exist
      await this.ensureDirectory(this.config.queue);
      await this.ensureDirectory(this.config.queueBatch);
      await this.ensureDirectory(this.config.queueBackup);
      await this.ensureDirectory(this.config.data);
      await this.ensureDirectory(path.join(this.config.data, "batches"));
      await this.ensureDirectory(path.join(this.config.data, "reports"));

      this.outputChannel.appendLine("Storage initialized successfully");
      return true;
    } catch (error) {
      this.outputChannel.appendLine(`Error initializing storage: ${error}`);
      return false;
    }
  }

  private async ensureDirectory(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      this.outputChannel.appendLine(
        `Error creating directory ${dir}: ${error}`,
      );
      throw error;
    }
  }

  async writeQueueEntry(
    workspaceRoot: string,
    relativePath: string,
    gitBranch?: string,
  ): Promise<void> {
    const timestamp = Date.now();
    const hash = crypto
      .createHash("sha256")
      .update(`${workspaceRoot}:${relativePath}:${timestamp}`)
      .digest("hex")
      .substring(0, 12);
    const filename = `${timestamp}_${hash}.json`;
    const queueFilePath = path.join(this.config.queue, filename);

    const entry: QueueEntry = {
      directory: workspaceRoot,
      filename: relativePath,
      gitBranch: gitBranch || null,
      timestamp,
    };

    await this.ensureDirectory(this.config.queue);
    await fs.writeFile(queueFilePath, JSON.stringify(entry, null, 2), "utf-8");
    this.outputChannel.appendLine(`Queue entry created: ${filename}`);
  }

  async moveQueueToBatch(): Promise<string[]> {
    await this.ensureDirectory(this.config.queueBatch);
    const files = await fs.readdir(this.config.queue);
    const movedFiles: string[] = [];

    for (const file of files) {
      const srcPath = path.join(this.config.queue, file);
      const destPath = path.join(this.config.queueBatch, file);

      try {
        await fs.rename(srcPath, destPath);
        movedFiles.push(file);
      } catch (error) {
        this.outputChannel.appendLine(`Error moving file ${file}: ${error}`);
      }
    }

    this.outputChannel.appendLine(
      `Moved ${movedFiles.length} files from queue to batch`,
    );
    return movedFiles;
  }

  async moveBatchToQueue(): Promise<void> {
    await this.ensureDirectory(this.config.queue);
    const files = await fs.readdir(this.config.queueBatch);

    for (const file of files) {
      const srcPath = path.join(this.config.queueBatch, file);
      const destPath = path.join(this.config.queue, file);

      try {
        await fs.rename(srcPath, destPath);
      } catch (error) {
        this.outputChannel.appendLine(
          `Error moving file ${file} back to queue: ${error}`,
        );
      }
    }

    this.outputChannel.appendLine(
      `Moved ${files.length} files from batch back to queue`,
    );
  }

  async moveBatchToBackup(): Promise<void> {
    await this.ensureDirectory(this.config.queueBackup);
    const files = await fs.readdir(this.config.queueBatch);

    for (const file of files) {
      const srcPath = path.join(this.config.queueBatch, file);
      const destPath = path.join(this.config.queueBackup, file);

      try {
        await fs.rename(srcPath, destPath);
      } catch (error) {
        this.outputChannel.appendLine(
          `Error moving file ${file} to backup: ${error}`,
        );
      }
    }

    this.outputChannel.appendLine(
      `Moved ${files.length} files from batch to backup`,
    );
  }

  async deleteBatchFiles(): Promise<void> {
    const files = await fs.readdir(this.config.queueBatch);

    for (const file of files) {
      const filePath = path.join(this.config.queueBatch, file);

      try {
        await fs.unlink(filePath);
      } catch (error) {
        this.outputChannel.appendLine(`Error deleting file ${file}: ${error}`);
      }
    }

    this.outputChannel.appendLine(`Deleted ${files.length} files from batch`);
  }

  async readBatchFiles(): Promise<QueueEntry[]> {
    const files = await fs.readdir(this.config.queueBatch);
    const entries: QueueEntry[] = [];

    for (const file of files) {
      const filePath = path.join(this.config.queueBatch, file);

      try {
        const content = await fs.readFile(filePath, "utf-8");
        entries.push(JSON.parse(content) as QueueEntry);
      } catch (error) {
        this.outputChannel.appendLine(
          `Error reading batch file ${file}: ${error}`,
        );
      }
    }

    return entries;
  }
}
