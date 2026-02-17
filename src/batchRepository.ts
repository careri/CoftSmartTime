import * as fs from "fs/promises";
import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { QueueEntry, BatchEntry, CollectBatchesResult } from "./storage";

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

  async collectBatches(): Promise<CollectBatchesResult> {
    const batchesDir = path.join(this.config.data, "batches");

    // Get today's UTC date start
    const now = new Date();
    const todayStartUtc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    // Read all entries in root of batches dir
    let allEntries: string[];
    try {
      allEntries = await fs.readdir(batchesDir);
    } catch {
      return { collected: false, filesProcessed: 0 };
    }

    // Filter to batch json files older than today (UTC)
    const batchFiles: string[] = [];
    for (const entry of allEntries) {
      const fullPath = path.join(batchesDir, entry);
      const stat = await fs.stat(fullPath);
      if (!stat.isFile() || !entry.endsWith(".json")) {
        continue;
      }
      const match = entry.match(/^batch_(\d+)/);
      if (!match) {
        continue;
      }
      const timestamp = parseInt(match[1], 10);
      if (timestamp < todayStartUtc) {
        batchFiles.push(entry);
      }
    }

    if (batchFiles.length === 0) {
      return { collected: false, filesProcessed: 0 };
    }

    // Group files by UTC date
    const grouped: Map<string, string[]> = new Map();
    for (const file of batchFiles) {
      const match = file.match(/^batch_(\d+)/);
      if (!match) {
        continue;
      }
      const timestamp = parseInt(match[1], 10);
      const date = new Date(timestamp);
      const year = String(date.getUTCFullYear());
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const dateKey = `${year}-${month}-${day}`;

      if (!grouped.has(dateKey)) {
        grouped.set(dateKey, []);
      }
      grouped.get(dateKey)!.push(file);
    }

    // For each date group, merge batch entries and write to year/month/day.json
    for (const [dateKey, files] of grouped) {
      const [year, month, day] = dateKey.split("-");
      const merged: BatchEntry = {};

      for (const file of files) {
        const filePath = path.join(batchesDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const batch: BatchEntry = JSON.parse(content);

        for (const branch in batch) {
          if (!merged[branch]) {
            merged[branch] = {};
          }
          for (const directory in batch[branch]) {
            if (!merged[branch][directory]) {
              merged[branch][directory] = [];
            }
            merged[branch][directory].push(...batch[branch][directory]);
          }
        }
      }

      // If the target file already exists, merge with existing data
      const targetDir = path.join(batchesDir, year, month);
      const targetPath = path.join(targetDir, `${day}.json`);

      try {
        const existing = await fs.readFile(targetPath, "utf-8");
        const existingBatch: BatchEntry = JSON.parse(existing);
        for (const branch in existingBatch) {
          if (!merged[branch]) {
            merged[branch] = {};
          }
          for (const directory in existingBatch[branch]) {
            if (!merged[branch][directory]) {
              merged[branch][directory] = [];
            }
            merged[branch][directory].push(...existingBatch[branch][directory]);
          }
        }
      } catch {
        // File doesn't exist yet, no merge needed
      }

      await fs.mkdir(targetDir, { recursive: true });
      await fs.writeFile(targetPath, JSON.stringify(merged, null, 2), "utf-8");

      this.outputChannel.appendLine(
        `Collected ${files.length} batch file(s) into batches/${year}/${month}/${day}.json`,
      );
    }

    // Delete processed root files
    for (const file of batchFiles) {
      await fs.unlink(path.join(batchesDir, file));
    }

    this.outputChannel.appendLine(
      `Batch collection completed: ${batchFiles.length} file(s) processed`,
    );
    return { collected: true, filesProcessed: batchFiles.length };
  }

  async mergeBatchesIntoReport(
    report: TimeReport,
    currentDate: Date,
    viewGroupByMinutes: number,
    processedFiles?: Set<string>,
  ): Promise<TimeReport> {
    const batchesDir = path.join(this.config.data, "batches");
    const startOfDay = new Date(currentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // Read batch files from root directory (uncollected batches)
      let allFiles: string[];
      try {
        allFiles = await fs.readdir(batchesDir);
      } catch {
        allFiles = [];
      }

      // Filter batch files by timestamp in filename to avoid reading all files
      const relevantFiles = allFiles.filter((file) => {
        if (processedFiles && processedFiles.has(file)) {
          return false;
        }
        const match = file.match(/^batch_(\d+)/);
        if (!match) {
          return false;
        }
        const fileTimestamp = parseInt(match[1], 10);
        return (
          fileTimestamp >= startOfDay.getTime() &&
          fileTimestamp <= endOfDay.getTime()
        );
      });

      // Track processed files to avoid reprocessing on incremental merges
      if (processedFiles) {
        for (const file of relevantFiles) {
          processedFiles.add(file);
        }
      }

      for (const file of relevantFiles) {
        const filePath = path.join(batchesDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const batch = JSON.parse(content);
        this.mergeBatchEntryIntoReport(
          report,
          batch,
          startOfDay,
          endOfDay,
          viewGroupByMinutes,
        );
      }

      // Read from hierarchical format (collected batches: year/month/day.json)
      // Determine which UTC dates overlap with the local day being viewed
      const hierarchicalPaths = this.getHierarchicalBatchPaths(
        batchesDir,
        startOfDay,
        endOfDay,
      );

      for (const hierarchicalPath of hierarchicalPaths) {
        const pathKey = `hierarchical:${hierarchicalPath}`;
        if (processedFiles && processedFiles.has(pathKey)) {
          continue;
        }

        try {
          const content = await fs.readFile(hierarchicalPath, "utf-8");
          const batch = JSON.parse(content);
          this.mergeBatchEntryIntoReport(
            report,
            batch,
            startOfDay,
            endOfDay,
            viewGroupByMinutes,
          );

          if (processedFiles) {
            processedFiles.add(pathKey);
          }
        } catch {
          // File doesn't exist for this date, skip
        }
      }
    } catch (error) {
      this.outputChannel.appendLine(
        `Error merging batches into report: ${error}`,
      );
    }

    report.entries.sort((a, b) => a.key.localeCompare(b.key));
    return report;
  }

  private getHierarchicalBatchPaths(
    batchesDir: string,
    startOfDay: Date,
    endOfDay: Date,
  ): string[] {
    const paths: string[] = [];
    const seen = new Set<string>();

    // The local day boundaries may span two UTC dates
    for (const date of [startOfDay, endOfDay]) {
      const year = String(date.getUTCFullYear());
      const month = String(date.getUTCMonth() + 1).padStart(2, "0");
      const day = String(date.getUTCDate()).padStart(2, "0");
      const key = `${year}/${month}/${day}`;

      if (!seen.has(key)) {
        seen.add(key);
        paths.push(path.join(batchesDir, year, month, `${day}.json`));
      }
    }

    return paths;
  }

  private mergeBatchEntryIntoReport(
    report: TimeReport,
    batch: any,
    startOfDay: Date,
    endOfDay: Date,
    viewGroupByMinutes: number,
  ): void {
    for (const branch in batch) {
      for (const directory in batch[branch]) {
        const batchFiles = batch[branch][directory];

        for (const fileEntry of batchFiles) {
          const timestamp = new Date(fileEntry.Timestamp);

          if (timestamp >= startOfDay && timestamp <= endOfDay) {
            const key = this.getTimeKey(timestamp, viewGroupByMinutes);
            const existingEntry = report.entries.find(
              (e) =>
                e.key === key &&
                e.branch === branch &&
                e.directory === directory,
            );

            if (existingEntry) {
              if (!existingEntry.files.includes(fileEntry.File)) {
                existingEntry.files.push(fileEntry.File);
                existingEntry.fileDetails.push({
                  file: fileEntry.File,
                  timestamp: fileEntry.Timestamp,
                });
              }
            } else {
              report.entries.push({
                key,
                branch,
                directory,
                files: [fileEntry.File],
                fileDetails: [
                  {
                    file: fileEntry.File,
                    timestamp: fileEntry.Timestamp,
                  },
                ],
                comment: "",
                project: "",
                assignedBranch: "",
              });
            }
          }
        }
      }
    }
  }

  private getTimeKey(date: Date, viewGroupByMinutes: number): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = date.getMinutes();
    const groupedMinutes =
      Math.floor(minutes / viewGroupByMinutes) * viewGroupByMinutes;
    const minutesStr = String(groupedMinutes).padStart(2, "0");
    return `${hours}:${minutesStr}`;
  }
}
