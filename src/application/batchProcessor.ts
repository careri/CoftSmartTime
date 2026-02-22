import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { StorageManager } from "../storage/storage";
import { OperationQueueWriter } from "./operationQueueWriter";

export class BatchProcessor {
  private config: CoftConfig;
  private storage: StorageManager;
  private outputChannel: vscode.OutputChannel;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    config: CoftConfig,
    storage: StorageManager,
    outputChannel: vscode.OutputChannel,
  ) {
    this.config = config;
    this.storage = storage;
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
    try {
      const hasFiles = await this.storage.hasQueueFiles();
      if (!hasFiles) {
        return;
      }

      this.outputChannel.appendLine(
        "Queue files detected, writing ProcessBatchRequest...",
      );
      await OperationQueueWriter.write(
        this.storage.operationRepository,
        { type: "processBatch" },
        this.outputChannel,
      );
    } catch (error) {
      this.outputChannel.appendLine(`Error in batch processing: ${error}`);
    }
  }
}
