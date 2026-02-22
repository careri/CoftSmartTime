import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { CoftConfig } from "../application/config";
import { OperationRepository } from "../storage/operationRepository";
import { OperationQueueWriter } from "../application/operationQueueWriter";
import { OperationRequest } from "../types/operation";
import {
  BatchRepository,
  TimeEntry,
  TimeReport,
  FileDetail,
} from "../storage/batchRepository";
import {
  TimeReportRepository,
  SavedTimeEntry,
  SavedTimeReport,
} from "../storage/timeReportRepository";
import { ProjectRepository, ProjectMap } from "../storage/projectRepository";
import {
  OverviewEntry,
  ProjectGroup,
  OverviewData,
  QueuedOperation,
} from "./types";

export class TimeReportViewModel {
  private report: TimeReport | null = null;
  private projects: ProjectMap | null = null;
  private operationQueue: OperationRequest[] = [];
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;
  private batchRepository: BatchRepository;
  private timeReportRepository: TimeReportRepository;
  private projectRepository: ProjectRepository;
  private operationRepository: OperationRepository;

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
    this.batchRepository = new BatchRepository(config, outputChannel);
    this.timeReportRepository = new TimeReportRepository(config, outputChannel);
    this.projectRepository = new ProjectRepository(config, outputChannel);
    this.operationRepository = new OperationRepository(config, outputChannel);
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
        this.outputChannel,
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
        this.outputChannel,
      );
    }
  }

  // TODO: add other methods
}
