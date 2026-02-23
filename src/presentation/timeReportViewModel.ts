import * as path from "path";
import { CoftConfig } from "../application/config";
import { OperationRepository } from "../storage/operationRepository";
import { OperationQueueWriter } from "../application/operationQueueWriter";
import { OperationRequest } from "../types/operation";
import { TimeReport, TimeEntry } from "../storage/batchRepository";
import { SavedTimeReport } from "../storage/timeReportRepository";
import { Logger } from "../utils/logger";

export class TimeReportViewModel {
  private report: TimeReport | null = null;
  private operationQueue: OperationRequest[] = [];
  private logger: Logger;
  private operationRepository: OperationRepository;
  private config: CoftConfig;

  constructor(config: CoftConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.operationRepository = new OperationRepository(config, logger);
  }

  setReport(report: TimeReport | null): void {
    this.report = report;
  }

  async updateProjectMapping(
    branch: string,
    project: string,
    directory: string,
  ): Promise<void> {
    this.operationQueue.push({
      type: "projectChange",
      action: "add",
      branch,
      directory,
      project,
    });
  }

  private shiftTimeKey(key: string, slots: number): string | null {
    const parts = key.split(":");
    if (parts.length !== 2) {
      return null;
    }
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1], 10);
    const totalMinutes =
      hours * 60 + minutes + slots * this.config.viewGroupByMinutes;
    if (totalMinutes < 0 || totalMinutes >= 24 * 60) {
      return null;
    }
    const newHours = Math.floor(totalMinutes / 60);
    const newMinutes = totalMinutes % 60;
    return `${String(newHours).padStart(2, "0")}:${String(newMinutes).padStart(2, "0")}`;
  }

  private buildSavedReport(reportData: TimeReport): SavedTimeReport {
    return {
      date: reportData.date,
      startOfDay: reportData.startOfDay || undefined,
      endOfDay: reportData.endOfDay || undefined,
      entries: reportData.entries.map((entry) => ({
        key: entry.key,
        branch: entry.branch,
        directory: entry.directory,
        comment: entry.comment,
        project: entry.project,
        assignedBranch: entry.assignedBranch,
      })),
    };
  }

  async save(): Promise<void> {
    // Write all queued operations to disk
    for (const op of this.operationQueue) {
      await OperationQueueWriter.write(
        this.operationRepository,
        op,
        this.logger,
      );
    }
    this.operationQueue = [];

    // Then write the operation to save the report
    if (this.report) {
      const date = new Date(this.report.date);
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");
      const reportFile = path.join(
        "reports",
        String(year),
        month,
        `${day}.json`,
      );

      await OperationQueueWriter.write(
        this.operationRepository,
        {
          type: "timereport",
          file: reportFile,
          body: this.buildSavedReport(this.report),
        },
        this.logger,
      );
    }
  }

  copyRow(index: number, direction: "above" | "below"): void {
    if (!this.report) {
      return;
    }

    const entry = this.report.entries[index];
    if (!entry) {
      return;
    }

    const newKey = this.shiftTimeKey(entry.key, direction === "above" ? -1 : 1);
    if (!newKey) {
      return;
    }

    const newEntry: TimeEntry = {
      key: newKey,
      branch: entry.branch,
      directory: entry.directory,
      files: [],
      fileDetails: [],
      comment: entry.comment,
      project: entry.project,
      assignedBranch: entry.assignedBranch,
    };

    this.report.entries.push(newEntry);
    this.report.entries.sort((a, b) => a.key.localeCompare(b.key));

    // Update start/end of day based on the new entry
    this.updateStartEndOfDay();
  }

  updateStartEndOfDay(): void {
    if (!this.report || this.report.entries.length === 0) {
      return;
    }
    const keys = this.report.entries.map((e) => e.key).sort();
    const firstKey = keys[0];
    const lastKey = keys[keys.length - 1];
    const lastEndKey = this.shiftTimeKey(lastKey, 1);

    if (!this.report.startOfDay || firstKey < this.report.startOfDay) {
      this.report.startOfDay = firstKey;
    }
    if (
      !this.report.endOfDay ||
      (lastEndKey && lastEndKey > this.report.endOfDay)
    ) {
      this.report.endOfDay = lastEndKey || lastKey;
    }
  }

  // TODO: add other methods
}
