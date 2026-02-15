import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { StorageManager, BatchEntry } from "./storage";
import { GitManager } from "./git";
import { FileLock } from "./lock";

export class BatchProcessor {
  private config: CoftConfig;
  private storage: StorageManager;
  private git: GitManager;
  private lock: FileLock;
  private outputChannel: vscode.OutputChannel;
  private timer: NodeJS.Timeout | null = null;
  private failureCount: number = 0;
  private maxFailures: number = 5;

  constructor(
    config: CoftConfig,
    storage: StorageManager,
    git: GitManager,
    outputChannel: vscode.OutputChannel,
  ) {
    this.config = config;
    this.storage = storage;
    this.git = git;
    this.lock = new FileLock(this.config.data, outputChannel);
    this.outputChannel = outputChannel;
  }

  start(): void {
    this.outputChannel.appendLine(
      `Starting batch processor with interval: ${this.config.intervalSeconds}s`,
    );

    this.timer = setInterval(
      () => this.process(),
      this.config.intervalSeconds * 1000,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.outputChannel.appendLine("Batch processor stopped");
    }
  }

  private async process(): Promise<void> {
    this.outputChannel.appendLine("--- Starting batch processing ---");

    try {
      this.outputChannel.appendLine("Acquiring lock...");
      const lockAcquired = await this.lock.acquire(1000);
      if (!lockAcquired) {
        this.outputChannel.appendLine("Failed to acquire lock, exiting");
        return;
      }

      try {
        this.outputChannel.appendLine("Moving files from queue to batch...");
        const movedFiles = await this.storage.moveQueueToBatch();

        if (movedFiles.length === 0) {
          this.outputChannel.appendLine("No files to process");
          return;
        }

        this.outputChannel.appendLine("Generating batch entry...");
        try {
          await this.generateBatchEntry();

          this.outputChannel.appendLine("Creating git commit...");
          await this.git.commit();

          this.outputChannel.appendLine("Deleting batch files...");
          await this.storage.deleteBatchFiles();

          // Reset failure count on success
          this.failureCount = 0;
          this.outputChannel.appendLine(
            "Batch processing completed successfully",
          );
        } catch (error) {
          this.outputChannel.appendLine(
            `Error during batch generation or commit: ${error}`,
          );
          vscode.window.showErrorMessage(
            `COFT SmartTime: Batch processing failed: ${error}`,
          );
          this.failureCount++;

          if (this.failureCount >= this.maxFailures) {
            this.outputChannel.appendLine(
              `Max failures (${this.maxFailures}) reached, moving batch to backup`,
            );
            await this.storage.moveBatchToBackup();
            this.failureCount = 0;
          } else {
            this.outputChannel.appendLine(
              `Moving batch files back to queue (failure ${this.failureCount}/${this.maxFailures})`,
            );
            await this.storage.moveBatchToQueue();
          }
        }
      } finally {
        this.outputChannel.appendLine("Releasing lock...");
        await this.lock.release();
      }
    } catch (error) {
      this.outputChannel.appendLine(`Error in batch processing: ${error}`);
      vscode.window.showErrorMessage(
        `COFT SmartTime: Batch processing error: ${error}`,
      );
    }

    this.outputChannel.appendLine("--- Batch processing completed ---");
  }

  private async generateBatchEntry(): Promise<void> {
    const entries = await this.storage.readBatchFiles();

    if (entries.length === 0) {
      return;
    }

    // Group by branch -> directory -> files
    const grouped: BatchEntry = {};

    for (const entry of entries) {
      const branch = entry.gitBranch || "no-branch";
      const directory = entry.directory;

      if (!grouped[branch]) {
        grouped[branch] = {};
      }

      if (!grouped[branch][directory]) {
        grouped[branch][directory] = [];
      }

      grouped[branch][directory].push({
        File: entry.filename,
        Timestamp: entry.timestamp,
      });
    }

    // Write batch file with random suffix to prevent collisions
    const timestamp = Date.now();
    const suffix = Math.random().toString(36).substring(2, 8);
    const batchFilename = `batch_${timestamp}_${suffix}.json`;
    const batchPath = path.join(this.config.data, "batches", batchFilename);

    await fs.writeFile(batchPath, JSON.stringify(grouped, null, 2), "utf-8");
    this.outputChannel.appendLine(`Batch entry created: ${batchFilename}`);
  }
}
