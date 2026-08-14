import * as fs from "fs/promises";
import * as path from "path";
import { CoftConfig } from "../application/config";
import { BatchRepository } from "./batchRepository";
import { QueueRepository } from "./queueRepository";
import { OperationRepository } from "./operationRepository";
import { ProjectRepository } from "./projectRepository";
import { TimeReportRepository } from "./timeReportRepository";
import { BatchService } from "../services/batchService";
import { Logger } from "../utils/logger";

export interface CollectBatchesResult {
  collected: boolean;
  filesProcessed: number;
}

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
  private logger: Logger;
  public batchRepository: BatchRepository;
  private queueRepository: QueueRepository;
  public operationRepository: OperationRepository;
  public projectRepository: ProjectRepository;
  public timeReportRepository: TimeReportRepository;
  private batchService: BatchService;

  constructor(config: CoftConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.batchRepository = new BatchRepository(config, logger);
    this.queueRepository = new QueueRepository(config, logger);
    this.operationRepository = new OperationRepository(config, logger);
    this.projectRepository = new ProjectRepository(config, logger);
    this.timeReportRepository = new TimeReportRepository(config);
    this.batchService = new BatchService(config, logger);
  }

  async initialize(): Promise<boolean> {
    try {
      // Create root directory if it doesn't exist
      try {
        await fs.access(this.config.root);
      } catch {
        this.logger.info(
          `COFT_ROOT directory does not exist, creating: ${this.config.root}`,
        );
        await fs.mkdir(this.config.root, { recursive: true });
      }

      // Create subdirectories if they don't exist
      await this.ensureDirectory(this.config.queue);
      await this.ensureDirectory(this.config.queueBatch);
      await this.ensureDirectory(this.config.queueBackup);
      await this.ensureDirectory(this.config.operationQueue);
      await this.ensureDirectory(this.config.operationQueueBackup);
      await this.ensureDirectory(this.config.data);
      await this.ensureDirectory(path.join(this.config.data, "batches"));
      await this.ensureDirectory(path.join(this.config.data, "reports"));

      this.logger.info("Storage initialized successfully");
      return true;
    } catch (error) {
      this.logger.error(`Error initializing storage: ${error}`);
      return false;
    }
  }

  private async ensureDirectory(dir: string): Promise<void> {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      this.logger.error(`Error creating directory ${dir}: ${error}`);
      throw error;
    }
  }

  async writeQueueEntry(
    workspaceRoot: string,
    relativePath: string,
    gitBranch?: string,
  ): Promise<void> {
    return this.queueRepository.addEntry(
      workspaceRoot,
      relativePath,
      gitBranch,
    );
  }

  async moveQueueToBatch(): Promise<string[]> {
    return this.queueRepository.moveToBatch();
  }

  async moveBatchToQueue(): Promise<void> {
    return this.queueRepository.moveToQueue();
  }

  async moveBatchToBackup(): Promise<void> {
    return this.queueRepository.moveToBackup();
  }

  async deleteBatchFiles(): Promise<void> {
    return this.queueRepository.deleteBatchFiles();
  }

  async readBatchFiles(): Promise<QueueEntry[]> {
    return this.batchRepository.readBatchFiles();
  }

  async collectBatches(): Promise<CollectBatchesResult> {
    return this.batchService.collectAndMergeBatches();
  }

  async hasQueueFiles(): Promise<boolean> {
    return this.queueRepository.hasQueueFiles();
  }
}
