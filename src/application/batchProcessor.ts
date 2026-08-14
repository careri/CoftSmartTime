import { CoftConfig } from "./config";
import { StorageManager } from "../storage/storage";
import { OperationQueueWriter } from "./operationQueueWriter";
import { Logger } from "../utils/logger";

export class BatchProcessor {
  private config: CoftConfig;
  private storage: StorageManager;
  private logger: Logger;
  private timer: NodeJS.Timeout | null = null;

  constructor(config: CoftConfig, storage: StorageManager, logger: Logger) {
    this.config = config;
    this.storage = storage;
    this.logger = logger;
  }

  start(): void {
    this.logger.info(
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
      this.logger.info("Batch processor stopped");
    }
  }

  private async process(): Promise<void> {
    try {
      const hasFiles = await this.storage.hasQueueFiles();
      if (!hasFiles) {
        return;
      }

      this.logger.debug("Queue files detected, writing ProcessBatchRequest...");
      await OperationQueueWriter.write(
        this.storage.operationRepository,
        { type: "processBatch" },
        this.logger,
      );
    } catch (error) {
      this.logger.error(`Error in batch processing: ${error}`);
    }
  }
}
