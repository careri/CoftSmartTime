import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { TimeReportRepository } from "./timeReportRepository";
import { TimeReport } from "./batchRepository";

interface SummaryEntry {
  project: string;
  totalTime: number;
}

interface DateEntry {
  date: string;
  workTime: number;
  include: boolean;
}

interface SummaryData {
  summaryEntries: SummaryEntry[];
  dateEntries: DateEntry[];
}

export class TimeSummaryProvider {
  private config: CoftConfig;
  private outputChannel: vscode.OutputChannel;
  private startDate: Date;
  private endDate: Date;
  private panel: vscode.WebviewPanel | null = null;
  private timeReportRepository: TimeReportRepository;
  private summaryData: SummaryData | null = null;
  private reports: TimeReport[] = [];

  constructor(config: CoftConfig, outputChannel: vscode.OutputChannel) {
    this.config = config;
    this.outputChannel = outputChannel;
    this.timeReportRepository = new TimeReportRepository(config, outputChannel);
    this.startDate = new Date();
    this.endDate = new Date();
    this.setCurrentWeek();
  }

  private setCurrentWeek(): void {
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay()); // Sunday
    const end = new Date(start);
    end.setDate(start.getDate() + 6); // Saturday
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
      case "currentWeek":
        this.setCurrentWeek();
        this.reports = [];
        this.summaryData = null;
        await this.updateView();
        break;
      case "currentMonth":
        this.setCurrentMonth();
        this.reports = [];
        this.summaryData = null;
        await this.updateView();
        break;
      case "forward":
        this.moveForward(message.unit);
        this.reports = [];
        this.summaryData = null;
        await this.updateView();
        break;
      case "back":
        this.moveBack(message.unit);
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
    }
  }

  private recomputeSummary(): void {
    if (!this.summaryData || this.reports.length === 0) {
      return;
    }
    const projectTotals: { [project: string]: number } = {};
    for (const report of this.reports) {
      const date = new Date(report.date).toISOString().split("T")[0];
      const entry = this.summaryData.dateEntries.find((d) => d.date === date);
      if (entry && entry.include) {
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
    this.panel.webview.postMessage({
      command: "loadData",
      data: this.summaryData,
    });
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
          date: d.toISOString(),
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

    for (const report of reports) {
      const date = new Date(report.date).toISOString().split("T")[0];
      const isWeekend =
        new Date(report.date).getDay() === 0 ||
        new Date(report.date).getDay() === 6;
      let totalSlots = 0;
      for (const entry of report.entries) {
        totalSlots += 1;
      }
      dateEntries.push({
        date,
        workTime: totalSlots * this.config.viewGroupByMinutes,
        include: !isWeekend,
      });
    }

    // Now compute projectTotals based on included dates
    for (const report of reports) {
      const date = new Date(report.date).toISOString().split("T")[0];
      const entry = dateEntries.find((d) => d.date === date);
      if (entry && entry.include) {
        for (const e of report.entries) {
          const project = e.project || "Unassigned";
          projectTotals[project] = (projectTotals[project] || 0) + 1;
        }
      }
    }

    const summaryEntries: SummaryEntry[] = Object.keys(projectTotals).map(
      (project) => ({
        project,
        totalTime: projectTotals[project] * this.config.viewGroupByMinutes,
      }),
    );

    return { summaryEntries, dateEntries };
  }

  private getHtmlContent(summary: SummaryData): string {
    const startStr = this.startDate.toLocaleDateString();
    const endStr = this.endDate.toLocaleDateString();

    const summaryRows = summary.summaryEntries
      .map((entry) => {
        const hours = Math.floor(entry.totalTime / 60);
        const minutes = entry.totalTime % 60;
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        return `<tr><td>${this.escapeHtml(entry.project)}</td><td>${timeStr}</td></tr>`;
      })
      .join("");

    const dateRows = summary.dateEntries
      .map((entry) => {
        const hours = Math.floor(entry.workTime / 60);
        const minutes = entry.workTime % 60;
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const checked = entry.include ? "checked" : "";
        return `<tr><td><input type="checkbox" ${checked} data-date="${entry.date}"></td><td>${entry.date}</td><td>${timeStr}</td></tr>`;
      })
      .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>COFT Time Summary</title>
    <style>
        body { font-family: var(--vscode-font-family); padding: 20px; }
        button { background-color: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 16px; cursor: pointer; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
        th, td { text-align: left; padding: 8px; border-bottom: 1px solid var(--vscode-panel-border); }
        th { background-color: var(--vscode-editor-lineHighlightBackground); }
    </style>
</head>
<body>
    <h1>Time Summary: ${startStr} - ${endStr}</h1>
    <div>
        <button id="currentWeek">Current Week</button>
        <button id="currentMonth">Current Month</button>
        <button id="backWeek">← Week</button>
        <button id="forwardWeek">Week →</button>
        <button id="backMonth">← Month</button>
        <button id="forwardMonth">Month →</button>
    </div>
    <h2>Summary by Project</h2>
    <table id="summaryTable">
        <thead><tr><th>Project</th><th>Time</th></tr></thead>
        <tbody>${summaryRows}</tbody>
    </table>
    <h2>Dates</h2>
    <table>
        <thead><tr><th>Include</th><th>Date</th><th>Work Time</th></tr></thead>
        <tbody>${dateRows}</tbody>
    </table>
    <script>
        const vscode = acquireVsCodeApi();
        window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'loadData') {
                // Optionally update state
            } else if (message.command === 'updateSummary') {
                updateSummaryTable(message.data.summaryEntries);
            }
        });
        function updateSummaryTable(summaryEntries) {
            const tbody = document.querySelector('#summaryTable tbody');
            tbody.innerHTML = summaryEntries.map(entry => {
                const hours = Math.floor(entry.totalTime / 60);
                const minutes = entry.totalTime % 60;
                const timeStr = hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
                return '<tr><td>' + escapeHtml(entry.project) + '</td><td>' + timeStr + '</td></tr>';
            }).join('');
        }
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }
        document.getElementById('currentWeek').addEventListener('click', () => vscode.postMessage({ command: 'currentWeek' }));
        document.getElementById('currentMonth').addEventListener('click', () => vscode.postMessage({ command: 'currentMonth' }));
        document.getElementById('backWeek').addEventListener('click', () => vscode.postMessage({ command: 'back', unit: 'week' }));
        document.getElementById('forwardWeek').addEventListener('click', () => vscode.postMessage({ command: 'forward', unit: 'week' }));
        document.getElementById('backMonth').addEventListener('click', () => vscode.postMessage({ command: 'back', unit: 'month' }));
        document.getElementById('forwardMonth').addEventListener('click', () => vscode.postMessage({ command: 'forward', unit: 'month' }));
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
            cb.addEventListener('change', (e) => {
                vscode.postMessage({ command: 'toggleInclude', date: e.target.dataset.date, include: e.target.checked });
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
