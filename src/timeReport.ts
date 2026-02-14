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
  fileDetails: FileDetail[];
  comment: string;
  project: string;
  assignedBranch: string;
}

interface FileDetail {
  file: string;
  timestamp: number;
}

interface TimeReport {
  date: string;
  entries: TimeEntry[];
}

interface ProjectMap {
  [branch: string]: {
    [directory: string]: string;
  };
}

const DEFAULT_BRANCHES = ["main", "master"];

interface OverviewEntry {
  branch: string;
  directory: string;
  project: string;
  timeSlots: number;
}

interface OverviewData {
  startOfDay: string;
  endOfDay: string;
  entries: OverviewEntry[];
}

export class TimeReportProvider {
  private config: CoftConfig;
  private git: GitManager;
  private lock: FileLock;
  private outputChannel: vscode.OutputChannel;
  private currentDate: Date;
  private panel: vscode.WebviewPanel | null = null;
  private defaultBranchProjects: { [compositeKey: string]: string } = {};

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
      case "updateProjectMapping":
        await this.updateProjectMapping(
          message.branch,
          message.project,
          message.directory,
        );
        break;
    }
  }

  private async updateView(): Promise<void> {
    if (!this.panel) {
      return;
    }

    const report = await this.loadTimeReport();
    const projects = await this.loadProjects();
    this.assignBranches(report, projects);
    const overview = this.computeOverview(report, projects);
    this.panel.webview.html = this.getHtmlContent(report, overview, projects);
    // Send report data via messaging to avoid XSS from inline JSON
    await this.panel.webview.postMessage({
      command: "loadEntries",
      entries: report.entries,
      date: report.date,
      overview: overview,
      projects: projects,
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
    } catch (error) {
      this.outputChannel.appendLine(
        `Error merging batches into report: ${error}`,
      );
    }

    report.entries.sort((a, b) => a.key.localeCompare(b.key));
    return report;
  }

  async loadProjects(): Promise<ProjectMap> {
    const projectsPath = path.join(this.config.data, "projects.json");
    try {
      const content = await fs.readFile(projectsPath, "utf-8");
      const parsed = JSON.parse(content);
      // Validate new format: { branch: { directory: project } }
      if (typeof parsed !== "object" || parsed === null) {
        return {};
      }
      for (const key of Object.keys(parsed)) {
        if (typeof parsed[key] !== "object" || parsed[key] === null) {
          this.outputChannel.appendLine(
            "projects.json has unexpected format, treating as empty",
          );
          return {};
        }
      }
      return parsed;
    } catch {
      return {};
    }
  }

  private async saveProjects(projects: ProjectMap): Promise<void> {
    const projectsPath = path.join(this.config.data, "projects.json");
    await fs.writeFile(
      projectsPath,
      JSON.stringify(projects, null, 2),
      "utf-8",
    );
    this.outputChannel.appendLine(`Projects saved: ${projectsPath}`);
  }

  private async updateProjectMapping(
    branch: string,
    project: string,
    directory: string,
  ): Promise<void> {
    if (DEFAULT_BRANCHES.includes(branch)) {
      const compositeKey = `${branch}\0${directory}`;
      this.defaultBranchProjects[compositeKey] = project;
      await this.updateView();
      return;
    }
    const projects = await this.loadProjects();
    if (!projects[branch]) {
      projects[branch] = {};
    }
    projects[branch][directory] = project;
    await this.saveProjects(projects);
    // Refresh view to update timetable project columns
    await this.updateView();
  }

  lookupProject(
    projects: ProjectMap,
    branch: string,
    directory: string,
  ): string {
    // 0. Check in-memory default branch projects
    if (DEFAULT_BRANCHES.includes(branch)) {
      const compositeKey = `${branch}\0${directory}`;
      if (this.defaultBranchProjects[compositeKey] !== undefined) {
        return this.defaultBranchProjects[compositeKey];
      }
    }
    // 1. Exact match: branch + directory
    if (projects[branch] && projects[branch][directory]) {
      return projects[branch][directory];
    }
    // 2. Fallback: same branch in any other directory
    if (projects[branch]) {
      const dirs = Object.keys(projects[branch]);
      if (dirs.length > 0) {
        return projects[branch][dirs[0]];
      }
    }
    return "";
  }

  assignBranches(report: TimeReport, projects: ProjectMap): void {
    // Count files per branch per time key
    const keyBranchFiles: { [key: string]: { [branch: string]: number } } = {};

    for (const entry of report.entries) {
      if (!keyBranchFiles[entry.key]) {
        keyBranchFiles[entry.key] = {};
      }
      if (!keyBranchFiles[entry.key][entry.branch]) {
        keyBranchFiles[entry.key][entry.branch] = 0;
      }
      keyBranchFiles[entry.key][entry.branch] += entry.files.length;
    }

    // Determine dominant branch per time key
    const keyAssignedBranch: { [key: string]: string } = {};
    for (const key of Object.keys(keyBranchFiles)) {
      let maxFiles = 0;
      let assignedBranch = "";
      for (const branch of Object.keys(keyBranchFiles[key])) {
        if (keyBranchFiles[key][branch] > maxFiles) {
          maxFiles = keyBranchFiles[key][branch];
          assignedBranch = branch;
        }
      }
      keyAssignedBranch[key] = assignedBranch;
    }

    // Set assignedBranch and project on each entry
    for (const entry of report.entries) {
      entry.assignedBranch = keyAssignedBranch[entry.key] || entry.branch;
      entry.project = this.lookupProject(
        projects,
        entry.assignedBranch,
        entry.directory,
      );
    }
  }

  private computeOverview(
    report: TimeReport,
    projects: ProjectMap,
  ): OverviewData {
    let earliestTimestamp = Infinity;
    let latestTimestamp = -Infinity;

    // Group by composite key: branch + directory
    const compositeTimeSlots: {
      [compositeKey: string]: {
        branch: string;
        directory: string;
        keys: Set<string>;
      };
    } = {};

    for (const entry of report.entries) {
      const compositeKey = `${entry.branch}\0${entry.directory}`;
      if (!compositeTimeSlots[compositeKey]) {
        compositeTimeSlots[compositeKey] = {
          branch: entry.branch,
          directory: entry.directory,
          keys: new Set(),
        };
      }
      compositeTimeSlots[compositeKey].keys.add(entry.key);

      for (const detail of entry.fileDetails) {
        if (detail.timestamp < earliestTimestamp) {
          earliestTimestamp = detail.timestamp;
        }
        if (detail.timestamp > latestTimestamp) {
          latestTimestamp = detail.timestamp;
        }
      }
    }

    const startOfDay =
      earliestTimestamp === Infinity
        ? ""
        : new Date(earliestTimestamp).toLocaleTimeString();
    const endOfDay =
      latestTimestamp === -Infinity
        ? ""
        : new Date(latestTimestamp).toLocaleTimeString();

    const overviewEntries: OverviewEntry[] = Object.values(
      compositeTimeSlots,
    ).map((item) => ({
      branch: item.branch,
      directory: item.directory,
      project: this.lookupProject(projects, item.branch, item.directory),
      timeSlots: item.keys.size,
    }));

    overviewEntries.sort((a, b) => {
      const branchCmp = a.branch.localeCompare(b.branch);
      if (branchCmp !== 0) {
        return branchCmp;
      }
      return a.directory.localeCompare(b.directory);
    });

    return {
      startOfDay,
      endOfDay,
      entries: overviewEntries,
    };
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

      // Save project mappings from report entries
      const projects = await this.loadProjects();
      let projectsChanged = false;
      for (const entry of reportData.entries) {
        const mappingBranch = entry.assignedBranch || entry.branch;
        if (DEFAULT_BRANCHES.includes(mappingBranch)) {
          continue;
        }
        if (entry.project) {
          const currentProject = this.lookupProject(
            projects,
            mappingBranch,
            entry.directory,
          );
          if (entry.project !== currentProject) {
            if (!projects[mappingBranch]) {
              projects[mappingBranch] = {};
            }
            projects[mappingBranch][entry.directory] = entry.project;
            projectsChanged = true;
          }
        }
      }
      if (projectsChanged) {
        await this.saveProjects(projects);
      }

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

  private getHtmlContent(
    report: TimeReport,
    overview: OverviewData,
    projects: ProjectMap,
  ): string {
    const dateStr = this.currentDate.toLocaleDateString(undefined, {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const allProjectNames = new Set<string>();
    for (const branch of Object.keys(projects)) {
      if (typeof projects[branch] === "object" && projects[branch] !== null) {
        for (const dir of Object.keys(projects[branch])) {
          if (projects[branch][dir]) {
            allProjectNames.add(projects[branch][dir]);
          }
        }
      }
    }

    const overviewRowsHtml = overview.entries
      .map((entry) => {
        const projectOptions = [
          `<option value="">${this.escapeHtml("")}</option>`,
        ];
        const selectedProject = entry.project;
        for (const projectName of allProjectNames) {
          const selected = projectName === selectedProject ? " selected" : "";
          projectOptions.push(
            `<option value="${this.escapeHtml(projectName)}"${selected}>${this.escapeHtml(projectName)}</option>`,
          );
        }
        if (selectedProject && !allProjectNames.has(selectedProject)) {
          projectOptions.push(
            `<option value="${this.escapeHtml(selectedProject)}" selected>${this.escapeHtml(selectedProject)}</option>`,
          );
        }
        const timeMinutes = entry.timeSlots * this.config.viewGroupByMinutes;
        const hours = Math.floor(timeMinutes / 60);
        const minutes = timeMinutes % 60;
        const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
        const branchCell = this.config.branchTaskUrl
          ? `<a href="${this.escapeHtml(this.config.branchTaskUrl.replace("{branch}", entry.branch))}" title="Open task">${this.escapeHtml(entry.branch)}</a>`
          : this.escapeHtml(entry.branch);
        const projectCell = `<select class="overview-project-select" data-branch="${this.escapeHtml(entry.branch)}" data-directory="${this.escapeHtml(entry.directory)}">
                        ${projectOptions.join("")}
                    </select>
                    <input type="text" class="overview-project-new" data-branch="${this.escapeHtml(entry.branch)}" data-directory="${this.escapeHtml(entry.directory)}" placeholder="or type new..." style="margin-left: 8px; width: 140px;" />`;
        return `
            <tr>
                <td>${branchCell}</td>
                <td>${this.escapeHtml(entry.directory)}</td>
                <td>${projectCell}</td>
                <td>${this.escapeHtml(timeStr)}</td>
            </tr>
        `;
      })
      .join("");

    const entriesHtml = report.entries
      .map(
        (entry, index) => `
            <tr class="entry-row" data-index="${index}">
                <td>${this.escapeHtml(entry.key)}</td>
                <td>${this.escapeHtml(entry.directory)}</td>
                <td>${this.escapeHtml(entry.branch)}</td>
                <td><input type="text" class="comment-field" data-index="${index}" value="${this.escapeHtml(entry.comment)}" /></td>
                <td class="project-cell">${this.escapeHtml(entry.project)}</td>
                <td class="assigned-branch-cell">${this.escapeHtml(entry.assignedBranch)}</td>
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
                    table-layout: fixed;
                }
                th, td {
                    text-align: left;
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    overflow: hidden;
                    text-overflow: ellipsis;
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
                .entry-row {
                    cursor: pointer;
                }
                .entry-row:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .entry-row.selected {
                    background-color: var(--vscode-list-activeSelectionBackground);
                    color: var(--vscode-list-activeSelectionForeground);
                }
                #detailSection {
                    margin-top: 30px;
                }
                #detailSection h3 {
                    margin-bottom: 10px;
                }
                select {
                    background-color: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    padding: 4px 8px;
                }
                .overview-section {
                    margin-bottom: 30px;
                    padding: 16px;
                    border: 1px solid var(--vscode-panel-border);
                    border-radius: 4px;
                }
                .overview-section h2 {
                    margin-top: 0;
                    margin-bottom: 12px;
                }
                .day-range {
                    margin-bottom: 12px;
                    font-size: 1.1em;
                }
                .day-range span {
                    margin-right: 24px;
                }
                .section-title {
                    margin-top: 30px;
                    margin-bottom: 4px;
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

            <div class="overview-section">
                <h2>Overview</h2>
                <div class="day-range">
                    <span><strong>Start:</strong> ${this.escapeHtml(overview.startOfDay || "—")}</span>
                    <span><strong>End:</strong> ${this.escapeHtml(overview.endOfDay || "—")}</span>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Branch</th>
                            <th>Directory</th>
                            <th>Project</th>
                            <th>Time</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${overviewRowsHtml || '<tr><td colspan="4">No entries for this date</td></tr>'}
                    </tbody>
                </table>
            </div>

            <h2 class="section-title">Timetable</h2>
            <table>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Directory</th>
                        <th>Branch</th>
                        <th>Comment</th>
                        <th>Project</th>
                        <th>Assigned</th>
                    </tr>
                </thead>
                <tbody>
                    ${entriesHtml || '<tr><td colspan="6">No entries for this date</td></tr>'}
                </tbody>
            </table>
            
            <button class="save-button" id="saveBtn">Save Report</button>
            
            <div id="detailSection" style="display:none;">
                <h3 id="detailTitle">Batch Items</h3>
                <table>
                    <thead>
                        <tr>
                            <th>File</th>
                            <th>Timestamp</th>
                        </tr>
                    </thead>
                    <tbody id="detailBody">
                    </tbody>
                </table>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                let currentEntries = [];
                let currentDate = '';
                let currentProjects = {};
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'loadEntries') {
                        currentEntries = message.entries;
                        currentDate = message.date;
                        currentProjects = message.projects || {};
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

                // Overview project select/input handlers
                document.querySelectorAll('.overview-project-select').forEach(select => {
                    select.addEventListener('change', (e) => {
                        const branch = e.target.dataset.branch;
                        const directory = e.target.dataset.directory;
                        const project = e.target.value;
                        vscode.postMessage({ command: 'updateProjectMapping', branch: branch, project: project, directory: directory });
                    });
                });

                document.querySelectorAll('.overview-project-new').forEach(input => {
                    input.addEventListener('change', (e) => {
                        const branch = e.target.dataset.branch;
                        const directory = e.target.dataset.directory;
                        const project = e.target.value.trim();
                        if (project) {
                            vscode.postMessage({ command: 'updateProjectMapping', branch: branch, project: project, directory: directory });
                        }
                    });
                });
                
                document.getElementById('saveBtn').addEventListener('click', () => {
                    document.querySelectorAll('.comment-field').forEach(input => {
                        const index = parseInt(input.dataset.index);
                        currentEntries[index].comment = input.value;
                    });

                    // Apply project from overview mappings to entries
                    for (const entry of currentEntries) {
                        const branchMap = currentProjects[entry.branch];
                        if (branchMap && typeof branchMap === 'object') {
                            if (branchMap[entry.directory]) {
                                entry.project = branchMap[entry.directory];
                            } else {
                                const dirs = Object.keys(branchMap);
                                if (dirs.length > 0) {
                                    entry.project = branchMap[dirs[0]];
                                }
                            }
                        }
                    }
                    
                    vscode.postMessage({
                        command: 'save',
                        data: {
                            date: currentDate,
                            entries: currentEntries
                        }
                    });
                });

                document.querySelectorAll('.entry-row').forEach(row => {
                    row.addEventListener('click', (e) => {
                        if (e.target.tagName === 'INPUT') {
                            return;
                        }
                        const index = parseInt(row.dataset.index);
                        document.querySelectorAll('.entry-row').forEach(r => r.classList.remove('selected'));
                        row.classList.add('selected');
                        showDetail(index);
                    });
                });

                function showDetail(index) {
                    const entry = currentEntries[index];
                    if (!entry) {
                        return;
                    }
                    const detailSection = document.getElementById('detailSection');
                    const detailBody = document.getElementById('detailBody');
                    const detailTitle = document.getElementById('detailTitle');
                    
                    detailTitle.textContent = 'Batch Items: ' + entry.key + ' - ' + entry.directory + ' (' + entry.branch + ')';
                    
                    const details = entry.fileDetails || [];
                    details.sort((a, b) => a.timestamp - b.timestamp);
                    
                    detailBody.innerHTML = details.map(d => {
                        const ts = new Date(d.timestamp).toLocaleTimeString();
                        return '<tr><td>' + escapeHtml(d.file) + '</td><td>' + escapeHtml(ts) + '</td></tr>';
                    }).join('');
                    
                    if (details.length === 0) {
                        detailBody.innerHTML = '<tr><td colspan="2">No file details available</td></tr>';
                    }
                    
                    detailSection.style.display = 'block';
                }

                function escapeHtml(text) {
                    const div = document.createElement('div');
                    div.textContent = text;
                    return div.innerHTML;
                }
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
