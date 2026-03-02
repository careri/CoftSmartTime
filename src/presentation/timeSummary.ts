import * as vscode from "vscode";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  CoftConfig,
  getStartDayOfWeek,
  resolveWorkingHours,
} from "../application/config";
import { TimeReportRepository } from "../storage/timeReportRepository";
import { TimeReport } from "../storage/batchRepository";
import { Logger } from "../utils/logger";
import { TimeSummaryHtmlBuilder } from "./timeSummaryHtmlBuilder";
import { TimeSummaryViewModel } from "./timeSummaryViewModel";

export type PeriodType = "week" | "month";

export interface SummaryEntry {
  project: string;
  totalTime: number;
}

export interface DateEntry {
  date: string;
  workTime: number;
  include: boolean;
  dayOfWeek: string;
  normalHours: number; // in minutes
}

export interface SummaryData {
  summaryEntries: SummaryEntry[];
  dateEntries: DateEntry[];
  grandTotalReportedMinutes: number;
  grandTotalNormalMinutes: number;
  grandDeltaMinutes: number; // reported - normal
  configWarning: boolean;
}

export class TimeSummaryProvider {
  private config: CoftConfig;
  private startDate: Date;
  private endDate: Date;
  private currentPeriod: PeriodType = "month";
  private panel: vscode.WebviewPanel | null = null;
  private timeReportRepository: TimeReportRepository;
  private summaryData: SummaryData | null = null;
  private reports: TimeReport[] = [];
  private openTimeReportCallback?: (date: Date) => Promise<void>;
  private htmlBuilder: TimeSummaryHtmlBuilder;
  private viewModel: TimeSummaryViewModel;

  constructor(
    config: CoftConfig,
    _logger: Logger,
    openTimeReportCallback?: (date: Date) => Promise<void>,
  ) {
    this.config = config;
    this.openTimeReportCallback = openTimeReportCallback;
    this.timeReportRepository = new TimeReportRepository(config);
    this.htmlBuilder = new TimeSummaryHtmlBuilder();
    this.viewModel = new TimeSummaryViewModel();
    this.startDate = new Date();
    this.endDate = new Date();
    this.setCurrentMonth();
  }

  private setCurrentWeek(): void {
    const now = new Date();
    const startDay = getStartDayOfWeek(this.config.startOfWeek);
    const dayOfWeek = now.getDay();
    const diff = dayOfWeek - startDay;
    const start = new Date(now);
    start.setDate(now.getDate() - (diff < 0 ? diff + 7 : diff));
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    this.startDate = start;
    this.endDate = end;
  }

  private setCurrentMonth(): void {
    const now = new Date();
    this.startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    this.endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  }

  private moveForward(unit: "week" | "month"): void {
    if (unit === "week") {
      this.startDate.setDate(this.startDate.getDate() + 7);
      this.endDate.setDate(this.endDate.getDate() + 7);
    } else {
      this.startDate.setMonth(this.startDate.getMonth() + 1);
      this.endDate = new Date(
        this.startDate.getFullYear(),
        this.startDate.getMonth() + 1,
        0,
      );
    }
  }

  private moveBack(unit: "week" | "month"): void {
    if (unit === "week") {
      this.startDate.setDate(this.startDate.getDate() - 7);
      this.endDate.setDate(this.endDate.getDate() - 7);
    } else {
      this.startDate.setMonth(this.startDate.getMonth() - 1);
      this.endDate = new Date(
        this.startDate.getFullYear(),
        this.startDate.getMonth() + 1,
        0,
      );
    }
  }

  async show(context: vscode.ExtensionContext): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "coftTimeSummary",
      "COFT Time Summary",
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      },
    );

    this.panel.onDidDispose(() => {
      this.panel = null;
    });

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      undefined,
      context.subscriptions,
    );

    await this.updateView();
  }

  private async handleMessage(message: any): Promise<void> {
    switch (message.command) {
      case "setPeriod":
        this.currentPeriod = message.period as PeriodType;
        if (this.currentPeriod === "week") {
          this.setCurrentWeek();
        } else {
          this.setCurrentMonth();
        }
        this.reports = [];
        this.summaryData = null;
        await this.updateView();
        break;
      case "forward":
        this.moveForward(this.currentPeriod);
        this.reports = [];
        this.summaryData = null;
        await this.updateView();
        break;
      case "back":
        this.moveBack(this.currentPeriod);
        this.reports = [];
        this.summaryData = null;
        await this.updateView();
        break;
      case "toggleInclude":
        if (this.summaryData) {
          const entry = this.summaryData.dateEntries.find(
            (d) => d.date === message.date,
          );
          if (entry) {
            entry.include = message.include;
            this.recomputeSummary();
            this.panel?.webview.postMessage({
              command: "updateSummary",
              data: this.summaryData,
            });
          }
        }
        break;
      case "openTimeReport":
        if (this.openTimeReportCallback) {
          const [yr, mo, dy] = (message.date as string).split("-").map(Number);
          const date = new Date(yr, mo - 1, dy);
          await this.openTimeReportCallback(date);
        }
        break;
      case "updateNormalHours":
        if (this.summaryData) {
          const entry = this.summaryData.dateEntries.find(
            (d) => d.date === message.date,
          );
          if (entry) {
            const hours = parseFloat(message.hours);
            entry.normalHours =
              isNaN(hours) || hours < 0 ? 0 : Math.round(hours * 60);
            this.recomputeSummary();
            this.panel?.webview.postMessage({
              command: "updateSummary",
              data: this.summaryData,
            });
          }
        }
        break;
      case "exportSummaryHtml":
        await this.exportHtml();
        break;
      case "updateDistributionStart":
        this.viewModel.setRange(message.date, this.viewModel.getEndDate());
        await this.updateView();
        break;
      case "updateDistributionEnd":
        this.viewModel.setRange(this.viewModel.getStartDate(), message.date);
        await this.updateView();
        break;
    }
  }

  private async exportHtml(): Promise<void> {
    if (!this.summaryData) {
      return;
    }
    const downloadsDir = path.join(os.homedir(), "Downloads");
    const defaultUri = vscode.Uri.file(
      path.join(downloadsDir, "coft-summary.html"),
    );
    const uri = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { HTML: ["html"] },
      title: "Export Summary HTML",
    });
    if (!uri) {
      return;
    }
    try {
      const html = this.getHtmlContent(this.summaryData);
      await fs.promises.writeFile(uri.fsPath, html, "utf8");
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Failed to export summary HTML: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private recomputeSummary(): void {
    if (!this.summaryData || this.reports.length === 0) {
      return;
    }
    const projectTotals: { [project: string]: number } = {};
    let totalReported = 0;
    let totalNormal = 0;
    for (const report of this.reports) {
      const entry = this.summaryData.dateEntries.find(
        (d) => d.date === report.date,
      );
      if (entry && entry.include) {
        totalReported += entry.workTime;
        totalNormal += entry.normalHours;
        for (const e of report.entries) {
          const project = e.project || "Unassigned";
          projectTotals[project] = (projectTotals[project] || 0) + 1;
        }
      }
    }
    this.summaryData.summaryEntries = Object.keys(projectTotals).map(
      (project) => ({
        project,
        totalTime: projectTotals[project] * this.config.viewGroupByMinutes,
      }),
    );
    this.summaryData.grandTotalReportedMinutes = totalReported;
    this.summaryData.grandTotalNormalMinutes = totalNormal;
    this.summaryData.grandDeltaMinutes = totalReported - totalNormal;
  }

  private async updateView(): Promise<void> {
    if (!this.panel) {
      return;
    }
    if (this.reports.length === 0 || !this.summaryData) {
      this.reports = await this.loadReports();
      this.summaryData = this.computeSummary(this.reports);
      this.viewModel.resetRange(this.summaryData);
    }
    this.panel.webview.html = this.getHtmlContent(this.summaryData);
  }

  private async loadReports(): Promise<TimeReport[]> {
    const reports: TimeReport[] = [];
    for (
      let d = new Date(this.startDate);
      d <= this.endDate;
      d.setDate(d.getDate() + 1)
    ) {
      const saved = await this.timeReportRepository.readReport(d);
      if (saved) {
        const report: TimeReport = {
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
          entries: saved.entries.map((e) => ({
            key: e.key,
            branch: e.branch,
            directory: e.directory,
            files: [],
            fileDetails: [],
            comment: e.comment || "",
            project: e.project || "",
            assignedBranch: e.assignedBranch || "",
          })),
          startOfDay: saved.startOfDay,
          endOfDay: saved.endOfDay,
          hasSavedReport: true,
        };
        reports.push(report);
      }
    }
    return reports;
  }

  private computeSummary(reports: TimeReport[]): SummaryData {
    const projectTotals: { [project: string]: number } = {};
    const dateEntries: DateEntry[] = [];
    let grandTotalReportedMinutes = 0;
    let grandTotalNormalMinutes = 0;

    for (const report of reports) {
      const [yr, mo, dy] = report.date.split("-").map(Number);
      const localDate = new Date(yr, mo - 1, dy);
      const date = report.date;
      const isWeekend = localDate.getDay() === 0 || localDate.getDay() === 6;
      const totalSlots = report.entries.length;
      const dayOfWeek = localDate.toLocaleDateString(undefined, {
        weekday: "short",
      });
      const normalHours = resolveWorkingHours(this.config, localDate);
      dateEntries.push({
        date,
        workTime: totalSlots * this.config.viewGroupByMinutes,
        include: !isWeekend,
        dayOfWeek,
        normalHours,
      });
    }

    // Now compute projectTotals based on included dates
    for (const report of reports) {
      const entry = dateEntries.find((d) => d.date === report.date);
      if (entry && entry.include) {
        grandTotalReportedMinutes += entry.workTime;
        grandTotalNormalMinutes += entry.normalHours;
        for (const e of report.entries) {
          const project = e.project || "Unassigned";
          projectTotals[project] = (projectTotals[project] || 0) + 1;
        }
      }
    }

    const summaryEntries: SummaryEntry[] = Object.keys(projectTotals)
      .map((project) => ({
        project,
        totalTime: projectTotals[project] * this.config.viewGroupByMinutes,
      }))
      .sort((a, b) => b.totalTime - a.totalTime);

    return {
      summaryEntries,
      dateEntries,
      grandTotalReportedMinutes,
      grandTotalNormalMinutes,
      grandDeltaMinutes: grandTotalReportedMinutes - grandTotalNormalMinutes,
      configWarning: this.config.workingHoursMissingConfig,
    };
  }

  private getHtmlContent(summary: SummaryData): string {
    const distributionRows = this.viewModel.computeDistribution(summary);
    const includedDates = summary.dateEntries
      .filter((d) => d.include)
      .map((d) => d.date);
    return this.htmlBuilder.build(
      summary,
      this.currentPeriod,
      this.startDate,
      this.endDate,
      distributionRows,
      includedDates,
      this.viewModel.getStartDate(),
      this.viewModel.getEndDate(),
    );
  }
}
