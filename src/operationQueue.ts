import * as fs from "fs/promises";
import * as crypto from "crypto";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { GitManager } from "./git";
import { FileLock } from "./lock";
import { StorageManager, BatchEntry } from "./storage";
import { OperationRepository } from "./operationRepository";

export interface ProcessBatchRequest {
  type: "processBatch";
}

export interface WriteTimeReportRequest {
  type: "timereport";
  file: string;
  body: any;
}

export interface UpdateProjectsRequest {
  type: "projects";
  file: string;
  body: any;
}

export interface HousekeepingRequest {
  type: "housekeeping";
}

export interface InvalidRequest {
  type: "invalid";
}

export type OperationRequest =
  | ProcessBatchRequest
  | WriteTimeReportRequest
  | UpdateProjectsRequest
  | HousekeepingRequest
  | InvalidRequest;

export class OperationQueueWriter {
  static async write(
    config: CoftConfig,
    request: OperationRequest,
    outputChannel: vscode.OutputChannel,
  ): Promise<void> {
    const timestamp = Date.now();
    const fileField =
      request.type === "processBatch" ||
      request.type === "housekeeping" ||
      request.type === "invalid"
        ? request.type
        : request.file;
    const hash = crypto
      .createHash("sha256")
      .update(`${request.type}:${fileField}:${timestamp}`)
      .digest("hex")
      .substring(0, 12);
    const filename = `${timestamp}_${hash}.json`;
    const filePath = path.join(config.operationQueue, filename);

    await fs.mkdir(config.operationQueue, { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(request, null, 2), "utf-8");
    const fileInfo =
      request.type === "timereport" || request.type === "projects"
        ? ` - ${request.file}`
        : "";
    outputChannel.appendLine(
      `Operation request created: ${filename} (${request.type}${fileInfo})`,
    );
  }
}

export class OperationQueueProcessor {
  private config: CoftConfig;
  private git: GitManager;
  private storage: StorageManager;
  private lock: FileLock;
  private outputChannel: vscode.OutputChannel;
  private operationRepository: OperationRepository;
  private timer: NodeJS.Timeout | null = null;
  private failureCounts: Map<string, number> = new Map();
  private maxFailures: number = 5;
  private intervalMs: number = 10000;
  private processing: boolean = false;

  constructor(
    config: CoftConfig,
    git: GitManager,
    storage: StorageManager,
    outputChannel: vscode.OutputChannel,
  ) {
    this.config = config;
    this.git = git;
    this.storage = storage;
    this.lock = new FileLock(this.config.data, outputChannel);
    this.outputChannel = outputChannel;
    this.operationRepository = new OperationRepository(config, outputChannel);
  }

  start(): void {
    this.outputChannel.appendLine(
      "Starting operation queue processor (10s interval)",
    );
    this.timer = setInterval(() => this.processQueue(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.outputChannel.appendLine("Operation queue processor stopped");
    }
  }

  async processQueue(): Promise<void> {
    if (this.processing) {
      return;
    }

    this.processing = true;
    try {
      const operations = await this.operationRepository.readPendingOperations();

      if (operations.length === 0) {
        return;
      }

      this.outputChannel.appendLine(
        `--- Processing ${operations.length} operation request(s) ---`,
      );

      const lockAcquired = await this.lock.acquire(1000);
      if (!lockAcquired) {
        this.outputChannel.appendLine(
          "Failed to acquire lock, skipping processing",
        );
        return;
      }

      try {
        for (const { file, request } of operations) {
          await this.processRequest(file, request);
        }
      } finally {
        await this.lock.release();
      }

      this.outputChannel.appendLine(
        "--- Operation queue processing completed ---",
      );
    } catch (error) {
      this.outputChannel.appendLine(
        `Error processing operation queue: ${error}`,
      );
    } finally {
      this.processing = false;
    }
  }

  private async processRequest(
    filename: string,
    request: OperationRequest,
  ): Promise<void> {
    try {
      if (request.type === "processBatch") {
        await this.processProcessBatch();
      } else if (request.type === "housekeeping") {
        const firstToday = await this.git.isFirstCommitToday();
        if (firstToday) {
          const result = await this.storage.collectBatches();
          if (result.collected) {
            await this.git.commit("housekeeping: batch collection");
          } else {
            this.outputChannel.appendLine(
              "No batch entries to collect during housekeeping",
            );
          }
          await this.git.housekeeping();
        } else {
          this.outputChannel.appendLine(
            "Housekeeping already done today, skipping",
          );
        }
      } else if (request.type === "invalid") {
        throw new Error("Invalid request JSON");
      } else {
        await this.processFileRequest(request);
      }

      // Delete the processed request
      await this.operationRepository.deleteOperation(filename);
      this.failureCounts.delete(filename);
      const fileInfo =
        request.type === "timereport" || request.type === "projects"
          ? ` - ${request.file}`
          : "";
      this.outputChannel.appendLine(
        `Operation request processed: ${filename} (${request.type}${fileInfo})`,
      );

      // Queue housekeeping after first commit of the day
      if (request.type !== "housekeeping") {
        const firstToday = await this.git.isFirstCommitToday();
        if (firstToday) {
          this.outputChannel.appendLine(
            "First commit of the day, queuing housekeeping...",
          );
          await OperationQueueWriter.write(
            this.config,
            { type: "housekeeping" },
            this.outputChannel,
          );
        }
      }
    } catch (error) {
      const count = (this.failureCounts.get(filename) || 0) + 1;
      this.failureCounts.set(filename, count);
      this.outputChannel.appendLine(
        `Error processing operation request ${filename} (attempt ${count}/${this.maxFailures}): ${error}`,
      );

      if (count >= this.maxFailures) {
        const requestPath = path.join(this.config.operationQueue, filename);
        await this.moveToBackup(filename, requestPath);
      }
    }
  }

  private async processProcessBatch(): Promise<void> {
    this.outputChannel.appendLine("Moving files from queue to batch...");
    const movedFiles = await this.storage.moveQueueToBatch();

    if (movedFiles.length === 0) {
      this.outputChannel.appendLine("No batch files to process");
      return;
    }

    this.outputChannel.appendLine("Generating batch entry...");
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

    // Write batch to data directory
    const timestamp = Date.now();
    const suffix = Math.random().toString(36).substring(2, 8);
    const batchFilename = `batch_${timestamp}_${suffix}.json`;
    const batchFile = path.join("batches", batchFilename);

    const targetPath = path.join(this.config.data, batchFile);
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(grouped, null, 2), "utf-8");

    await this.git.commit(`processBatch: ${batchFile}`);

    this.outputChannel.appendLine("Deleting batch files...");
    await this.storage.deleteBatchFiles();
    this.outputChannel.appendLine(`Batch entry committed: ${batchFilename}`);
  }

  private async processFileRequest(
    request: WriteTimeReportRequest | UpdateProjectsRequest,
  ): Promise<void> {
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
  }

  private async moveToBackup(
    filename: string,
    requestPath: string,
  ): Promise<void> {
    const backupPath = path.join(this.config.operationQueueBackup, filename);
    await fs.mkdir(this.config.operationQueueBackup, { recursive: true });

    try {
      await fs.rename(requestPath, backupPath);
      this.failureCounts.delete(filename);
      this.outputChannel.appendLine(
        `Operation request moved to backup: ${filename}`,
      );
      vscode.window.showErrorMessage(
        `COFT SmartTime: Operation request failed too many times and was moved to backup: ${filename}`,
      );
    } catch (moveError) {
      this.outputChannel.appendLine(
        `Error moving request to backup: ${moveError}`,
      );
    }
  }
}
