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

type PeriodType = "week" | "month";

interface SummaryEntry {
  project: string;
  totalTime: number;
}

interface DateEntry {
  date: string;
  workTime: number;
  include: boolean;
  dayOfWeek: string;
  normalHours: number; // in minutes
}

interface SummaryData {
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

  constructor(
    config: CoftConfig,
    _logger: Logger,
    openTimeReportCallback?: (date: Date) => Promise<void>,
  ) {
    this.config = config;
    this.openTimeReportCallback = openTimeReportCallback;
    this.timeReportRepository = new TimeReportRepository(config);
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

  private formatMinutes(totalMinutes: number): string {
    const sign = totalMinutes < 0 ? "-" : "";
    const abs = Math.abs(totalMinutes);
    const hours = Math.floor(abs / 60);
    const minutes = abs % 60;
    return hours > 0 ? `${sign}${hours}h ${minutes}m` : `${sign}${minutes}m`;
  }

  private getHtmlContent(summary: SummaryData): string {
    const startStr = this.startDate.toLocaleDateString();
    const endStr = this.endDate.toLocaleDateString();

    const summaryRows = summary.summaryEntries
      .map((entry) => {
        const timeStr = this.formatMinutes(entry.totalTime);
        return `<tr><td>${this.escapeHtml(entry.project)}</td><td>${timeStr}</td></tr>`;
      })
      .join("");

    const deltaColor = summary.grandDeltaMinutes >= 0 ? "#4caf50" : "#f44336";
    const deltaStr = this.formatMinutes(summary.grandDeltaMinutes);
    const grandTotalStr = this.formatMinutes(summary.grandTotalReportedMinutes);

    const dateRows = summary.dateEntries
      .map((entry) => {
        const timeStr = this.formatMinutes(entry.workTime);
        const normalHoursVal = (entry.normalHours / 60).toString();
        const checked = entry.include ? "checked" : "";
        return `<tr><td><input type="checkbox" ${checked} data-date="${entry.date}"></td><td><a href="#" onclick="openTimeReport('${entry.date}')">${entry.date}</a></td><td>${entry.dayOfWeek}</td><td>${timeStr}</td><td><input type="number" class="normal-hours-input" min="0" step="0.5" value="${normalHoursVal}" data-date="${entry.date}"></td></tr>`;
      })
      .join("");

    const warningBanner = summary.configWarning
      ? `<div id="configWarning" style="background:#856404;color:#fff3cd;border:1px solid #856404;padding:10px 16px;margin-bottom:12px;border-radius:4px;display:flex;justify-content:space-between;align-items:center;"><span>&#9888; <strong>coft.smarttime.working.hours</strong> is not configured. Defaulting to 8 hours/weekday.</span><button onclick="document.getElementById('configWarning').style.display='none'" style="background:transparent;color:#fff3cd;border:1px solid #fff3cd;padding:2px 8px;cursor:pointer;border-radius:3px;">&#x2715;</button></div>`
      : "";

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>COFT Time Summary</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; margin-right: 4px; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
        th { background-color: var(--vscode-editor-lineHighlightBackground); }
        .normal-hours-input { width: 60px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); padding: 2px 4px; }
        .footer-row td { border-top: 2px solid var(--vscode-panel-border); font-weight: bold; }
    </style>
</head>
<body>
    <h1>Time Summary: ${startStr} - ${endStr}</h1>
    ${warningBanner}
    <div>
        <select id="periodSelect">
            <option value="week"${this.currentPeriod === "week" ? " selected" : ""}>Week</option>
            <option value="month"${this.currentPeriod === "month" ? " selected" : ""}>Month</option>
        </select>
        <button id="back">←</button>
        <button id="forward">→</button>
        <button id="exportHtml">Export HTML</button>
    </div>
    <h2>Summary by Project</h2>
    <table id="summaryTable">
        <thead><tr><th>Project</th><th>Time</th></tr></thead>
        <tbody>${summaryRows}</tbody>
        <tfoot>
            <tr class="footer-row"><td>Time difference</td><td id="grandDelta" style="color:${deltaColor}">${deltaStr}</td></tr>
            <tr class="footer-row"><td>Grand total (reported)</td><td id="grandTotal">${grandTotalStr}</td></tr>
        </tfoot>
    </table>
    <h2>Dates</h2>
    <table>
        <thead><tr><th>Include</th><th>Date</th><th>Day</th><th>Work Time</th><th>Normal Hours</th></tr></thead>
        <tbody>${dateRows}</tbody>
    </table>
    <script>
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'updateSummary') {
                updateSummaryTable(message.data);
            }
        });
        function formatMinutes(totalMinutes) {
            const sign = totalMinutes < 0 ? '-' : '';
            const abs = Math.abs(totalMinutes);
            const hours = Math.floor(abs / 60);
            const minutes = abs % 60;
            return hours > 0 ? sign + hours + 'h ' + minutes + 'm' : sign + minutes + 'm';
        }
        function updateSummaryTable(data) {
            const tbody = document.querySelector('#summaryTable tbody');
            tbody.innerHTML = data.summaryEntries.map(entry => {
                return '<tr><td>' + escapeHtml(entry.project) + '</td><td>' + formatMinutes(entry.totalTime) + '</td></tr>';
            }).join('');
            const delta = data.grandDeltaMinutes;
            const deltaEl = document.getElementById('grandDelta');
            deltaEl.textContent = formatMinutes(delta);
            deltaEl.style.color = delta >= 0 ? '#4caf50' : '#f44336';
            document.getElementById('grandTotal').textContent = formatMinutes(data.grandTotalReportedMinutes);
        }
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        function openTimeReport(date) {
            vscode.postMessage({ command: 'openTimeReport', date: date });
        }
        document.getElementById('periodSelect').addEventListener('change', (e) => vscode.postMessage({ command: 'setPeriod', period: e.target.value }));
        document.getElementById('back').addEventListener('click', () => vscode.postMessage({ command: 'back' }));
        document.getElementById('forward').addEventListener('click', () => vscode.postMessage({ command: 'forward' }));
        document.getElementById('exportHtml').addEventListener('click', () => vscode.postMessage({ command: 'exportSummaryHtml' }));
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'toggleInclude', date: e.target.dataset.date, include: e.target.checked });
            });
        });
        document.querySelectorAll('.normal-hours-input').forEach(input => {
            input.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'updateNormalHours', date: e.target.dataset.date, hours: e.target.value });
            });
        });
    </script>
</body>
</html>`;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
}
