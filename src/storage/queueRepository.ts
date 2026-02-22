import * as fs from "fs/promises";
import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "../application/config";
import { QueueEntry } from "./storage";

export class QueueRepository {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
  }

  async addEntry(
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

  async moveToBatch(): Promise<string[]> {
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

  async moveToQueue(): Promise<void> {
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

  async moveToBackup(): Promise<void> {
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

  async hasQueueFiles(): Promise<boolean> {
    try {
      const files = await fs.readdir(this.config.queue);
      return files.length > 0;
    } catch {
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
}
