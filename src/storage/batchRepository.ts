import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "../application/config";
import { QueueEntry, BatchEntry } from "./storage";

export interface FileDetail {
  file: string;
  timestamp: number;
}

export interface TimeEntry {
  key: string;
  branch: string;
  directory: string;
  files: string[];
  fileDetails: FileDetail[];
  comment: string;
  project: string;
  assignedBranch: string;
}

export interface TimeReport {
  date: string;
  entries: TimeEntry[];
  startOfDay?: string;
  endOfDay?: string;
  hasSavedReport?: boolean;
}

export class BatchRepository {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
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

  async saveBatch(grouped: BatchEntry, filename: string): Promise<void> {
    const batchFile = path.join("batches", filename);
    const targetPath = path.join(this.config.data, batchFile);
    const targetDir = path.dirname(targetPath);
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(targetPath, JSON.stringify(grouped, null, 2), "utf-8");
  }
}
