import * as path from "path";
import { CoftConfig } from "../application/config";
import { OperationRepository } from "../storage/operationRepository";
import { OperationQueueWriter } from "../application/operationQueueWriter";
import { OperationRequest } from "../types/operation";
import { TimeReport } from "../storage/batchRepository";
import { SavedTimeReport } from "../storage/timeReportRepository";
import { Logger } from "../utils/logger";

export class TimeReportViewModel {
  private report: TimeReport | null = null;
  private operationQueue: OperationRequest[] = [];
  private logger: Logger;
  private operationRepository: OperationRepository;

  constructor(config: CoftConfig, logger: Logger) {
    this.logger = logger;
    this.operationRepository = new OperationRepository(config, logger);
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

  // TODO: add other methods
}
