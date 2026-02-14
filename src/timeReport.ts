import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import { CoftConfig } from "./config";
import { GitManager } from "./git";
import { FileLock } from "./lock";

interface TimeEntry {
  key: string;
  branch: string;
  directory: string;
  files: string[];
  comment: string;
  project: string;
}

interface TimeReport {
  date: string;
  entries: TimeEntry[];
}

export class TimeReportProvider {
  private config: CoftConfig;
  private git: GitManager;
  private lock: FileLock;
  private outputChannel: vscode.OutputChannel;
  private currentDate: Date;
  private panel: vscode.WebviewPanel | null = null;

  constructor(
    config: CoftConfig,
    git: GitManager,
    outputChannel: vscode.OutputChannel,
  ) {
    this.config = config;
    this.git = git;
    this.lock = new FileLock(config.data, outputChannel);
    this.outputChannel = outputChannel;
    this.currentDate = new Date();
  }

  async show(context: vscode.ExtensionContext): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      "coftTimeReport",
      "COFT Time Report",
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
      case "nextDay":
        this.currentDate.setDate(this.currentDate.getDate() + 1);
        await this.updateView();
        break;
      case "previousDay":
        this.currentDate.setDate(this.currentDate.getDate() - 1);
        await this.updateView();
        break;
      case "today":
        this.currentDate = new Date();
        await this.updateView();
        break;
      case "save":
        await this.saveReport(message.data);
        break;
    }
  }

  private async updateView(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const report = await this.loadTimeReport();
    this.panel.webview.html = this.getHtmlContent(report);
    // Send report data via messaging to avoid XSS from inline JSON
    await this.panel.webview.postMessage({
      command: "loadEntries",
      entries: report.entries,
      date: report.date,
    });
  }

  private async loadTimeReport(): Promise<TimeReport> {
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(this.currentDate.getDate()).padStart(2, "0");

    const reportPath = path.join(
      this.config.data,
      "reports",
      String(year),
      month,
      `${day}.json`,
    );

    let report: TimeReport;

    try {
      const content = await fs.readFile(reportPath, "utf-8");
      report = JSON.parse(content);
    } catch {
      report = {
        date: this.currentDate.toISOString(),
        entries: [],
      };
    }

    // Always merge in batches from this day (handles both fresh and existing reports)
    report = await this.mergeBatchesIntoReport(report);

    return report;
  }

  private async mergeBatchesIntoReport(
    report: TimeReport,
  ): Promise<TimeReport> {
    const batchesDir = path.join(this.config.data, "batches");

    try {
      const allFiles = await fs.readdir(batchesDir);
      const startOfDay = new Date(this.currentDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(this.currentDate);
      endOfDay.setHours(23, 59, 59, 999);

      // Filter batch files by timestamp in filename to avoid reading all files
      const relevantFiles = allFiles.filter((file) => {
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

      for (const file of relevantFiles) {
        const filePath = path.join(batchesDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const batch = JSON.parse(content);

        for (const branch in batch) {
          for (const directory in batch[branch]) {
            const batchFiles = batch[branch][directory];

            for (const fileEntry of batchFiles) {
              const timestamp = new Date(fileEntry.Timestamp);

              if (timestamp >= startOfDay && timestamp <= endOfDay) {
                const key = this.getTimeKey(timestamp);
                const existingEntry = report.entries.find(
                  (e) =>
                    e.key === key &&
                    e.branch === branch &&
                    e.directory === directory,
                );

                if (existingEntry) {
                  if (!existingEntry.files.includes(fileEntry.File)) {
                    existingEntry.files.push(fileEntry.File);
                  }
                } else {
                  report.entries.push({
                    key,
                    branch,
                    directory,
                    files: [fileEntry.File],
                    comment: "",
                    project: "",
                  });
                }
              }
            }
          }
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

  private getTimeKey(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = date.getMinutes();
    const groupSize = this.config.viewGroupByMinutes;
    const groupedMinutes = Math.floor(minutes / groupSize) * groupSize;
    const minutesStr = String(groupedMinutes).padStart(2, "0");
    return `${hours}:${minutesStr}`;
  }

  private async saveReport(reportData: TimeReport): Promise<void> {
    const lockAcquired = await this.lock.acquire(1000);
    if (!lockAcquired) {
      vscode.window.showErrorMessage(
        "Could not save report: failed to acquire lock",
      );
      return;
    }

    try {
      const year = this.currentDate.getFullYear();
      const month = String(this.currentDate.getMonth() + 1).padStart(2, "0");
      const day = String(this.currentDate.getDate()).padStart(2, "0");

      const reportDir = path.join(
        this.config.data,
        "reports",
        String(year),
        month,
      );

      await fs.mkdir(reportDir, { recursive: true });

      const reportPath = path.join(reportDir, `${day}.json`);
      await fs.writeFile(
        reportPath,
        JSON.stringify(reportData, null, 2),
        "utf-8",
      );

      await this.git.commit("report");

      vscode.window.showInformationMessage("Time report saved successfully");
      this.outputChannel.appendLine(`Time report saved: ${reportPath}`);
    } catch (error) {
      this.outputChannel.appendLine(`Error saving time report: ${error}`);
      vscode.window.showErrorMessage(`Failed to save time report: ${error}`);
    } finally {
      await this.lock.release();
    }
  }

  private getHtmlContent(report: TimeReport): string {
    const dateStr = this.currentDate.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const entriesHtml = report.entries
      .map(
        (entry, index) => `
            <tr>
                <td>${this.escapeHtml(entry.key)}</td>
                <td>${this.escapeHtml(entry.directory)}</td>
                <td>${this.escapeHtml(entry.branch)}</td>
                <td><input type="text" class="comment-field" data-index="${index}" value="${this.escapeHtml(entry.comment)}" /></td>
                <td><input type="text" class="project-field" data-index="${index}" value="${this.escapeHtml(entry.project)}" /></td>
            </tr>
        `,
      )
      .join("");

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>COFT Time Report</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                }
                .header {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 20px;
                }
                .navigation {
                    display: flex;
                    gap: 10px;
                }
                button {
                    background-color: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    cursor: pointer;
                    border-radius: 2px;
                }
                button:hover {
                    background-color: var(--vscode-button-hoverBackground);
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    margin-top: 20px;
                }
                th, td {
                    text-align: left;
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                th {
                    background-color: var(--vscode-editor-lineHighlightBackground);
                }
                input {
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 4px 8px;
                    width: 100%;
                    box-sizing: border-box;
                }
                .save-button {
                    margin-top: 20px;
                    background-color: var(--vscode-button-background);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${this.escapeHtml(dateStr)}</h1>
                <div class="navigation">
                    <button id="prevDay">&#8592; Previous</button>
                    <button id="today">Today</button>
                    <button id="nextDay">Next &#8594;</button>
                </div>
            </div>
            
            <table>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Directory</th>
                        <th>Branch</th>
                        <th>Comment</th>
                        <th>Project</th>
                    </tr>
                </thead>
                <tbody>
                    ${entriesHtml || '<tr><td colspan="5">No entries for this date</td></tr>'}
                </tbody>
            </table>
            
            <button class="save-button" id="saveBtn">Save Report</button>
            
            <script>
                const vscode = acquireVsCodeApi();
                let currentEntries = [];
                let currentDate = '';
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'loadEntries') {
                        currentEntries = message.entries;
                        currentDate = message.date;
                    }
                });
                
                document.getElementById('prevDay').addEventListener('click', () => {
                    vscode.postMessage({ command: 'previousDay' });
                });
                
                document.getElementById('nextDay').addEventListener('click', () => {
                    vscode.postMessage({ command: 'nextDay' });
                });
                
                document.getElementById('today').addEventListener('click', () => {
                    vscode.postMessage({ command: 'today' });
                });
                
                document.getElementById('saveBtn').addEventListener('click', () => {
                    document.querySelectorAll('.comment-field').forEach(input => {
                        const index = parseInt(input.dataset.index);
                        currentEntries[index].comment = input.value;
                    });
                    
                    document.querySelectorAll('.project-field').forEach(input => {
                        const index = parseInt(input.dataset.index);
                        currentEntries[index].project = input.value;
                    });
                    
                    vscode.postMessage({
                        command: 'save',
                        data: {
                            date: currentDate,
                            entries: currentEntries
                        }
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
