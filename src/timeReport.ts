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
  startOfDay?: string;
  endOfDay?: string;
  hasSavedReport?: boolean;
}

interface SavedTimeEntry {
  key: string;
  branch: string;
  directory: string;
  comment: string;
  project: string;
}

interface SavedTimeReport {
  date: string;
  entries: SavedTimeEntry[];
  startOfDay?: string;
  endOfDay?: string;
}

interface ProjectMap {
  [branch: string]: {
    [directory: string]: string;
  };
}

const DEFAULT_BRANCHES = ["main", "master", "no-branch"];

interface OverviewEntry {
  branch: string;
  directory: string;
  project: string;
  timeSlots: number;
}

interface ProjectGroup {
  project: string;
  totalTimeSlots: number;
  entries: OverviewEntry[];
}

interface OverviewData {
  startOfDay: string;
  endOfDay: string;
  entries: OverviewEntry[];
  groups: ProjectGroup[];
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
      case "copyRow":
        await this.copyRow(message.index, message.direction);
        break;
      case "refreshProjects":
        await this.refreshProjects();
        break;
    }
  }

  private async refreshProjects(): Promise<void> {
    const report = await this.loadTimeReport();
    const projects = await this.loadProjects();
    this.assignBranches(report, projects, true);
    const overview = this.computeOverview(report, projects);
    if (this.panel) {
      this.panel.webview.html = this.getHtmlContent(report, overview, projects);
      await this.panel.webview.postMessage({
        command: "loadEntries",
        entries: report.entries,
        date: report.date,
        overview: overview,
        projects: projects,
      });
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

    let savedEntries: SavedTimeEntry[] = [];
    let savedStartOfDay: string | undefined;
    let savedEndOfDay: string | undefined;
    let hasSavedReport = false;

    try {
      const content = await fs.readFile(reportPath, "utf-8");
      const saved: SavedTimeReport = JSON.parse(content);
      savedEntries = saved.entries || [];
      savedStartOfDay = saved.startOfDay;
      savedEndOfDay = saved.endOfDay;
      hasSavedReport = true;
    } catch {
      // No saved report yet
    }

    // Build report entirely from batch data
    let report: TimeReport = {
      date: this.currentDate.toISOString(),
      entries: [],
    };
    report = await this.mergeBatchesIntoReport(report);
    report.startOfDay = savedStartOfDay;
    report.endOfDay = savedEndOfDay;
    report.hasSavedReport = hasSavedReport;

    // Apply saved comments and projects back onto batch-derived entries
    for (const savedEntry of savedEntries) {
      const match = report.entries.find(
        (e) =>
          e.key === savedEntry.key &&
          e.branch === savedEntry.branch &&
          e.directory === savedEntry.directory,
      );
      if (match) {
        if (savedEntry.comment) {
          match.comment = savedEntry.comment;
        }
        if (savedEntry.project) {
          match.project = savedEntry.project;
        }
      } else {
        // Add manually-created entries (e.g. from copy row) that have no batch data
        report.entries.push({
          key: savedEntry.key,
          branch: savedEntry.branch,
          directory: savedEntry.directory,
          files: [],
          fileDetails: [],
          comment: savedEntry.comment || "",
          project: savedEntry.project || "",
          assignedBranch: "",
        });
      }
    }

    report.entries.sort((a, b) => a.key.localeCompare(b.key));
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
      // Validate new format: { branch: { directory: project }, _unbound: [...] }
      if (typeof parsed !== "object" || parsed === null) {
        return {};
      }
      for (const key of Object.keys(parsed)) {
        if (key === "_unbound") {
          if (!Array.isArray(parsed[key])) {
            this.outputChannel.appendLine(
              "projects.json _unbound is not an array, ignoring",
            );
            delete parsed[key];
          }
          continue;
        }
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
      // Save project name as unbound for autocomplete
      if (project) {
        const projects = await this.loadProjects();
        const unbound: string[] = (projects as any)["_unbound"] || [];
        if (!unbound.includes(project)) {
          unbound.push(project);
          (projects as any)["_unbound"] = unbound;
          await this.saveProjects(projects);
        }
      }
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

  assignBranches(
    report: TimeReport,
    projects: ProjectMap,
    forceRefresh: boolean = false,
  ): void {
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
    // Only auto-assign projects when no saved report exists
    for (const entry of report.entries) {
      entry.assignedBranch = keyAssignedBranch[entry.key] || entry.branch;
      if (forceRefresh || !report.hasSavedReport || !entry.project) {
        entry.project = this.lookupProject(
          projects,
          entry.assignedBranch,
          entry.directory,
        );
      }
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

    const computedStartOfDay =
      earliestTimestamp === Infinity
        ? ""
        : new Date(earliestTimestamp).toLocaleTimeString();
    const computedEndOfDay =
      latestTimestamp === -Infinity
        ? ""
        : new Date(latestTimestamp).toLocaleTimeString();

    const startOfDay = report.startOfDay || computedStartOfDay;
    const endOfDay = report.endOfDay || computedEndOfDay;

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

    // Group entries by project
    const groupMap: { [project: string]: OverviewEntry[] } = {};
    for (const entry of overviewEntries) {
      const projectKey = entry.project || "";
      if (!groupMap[projectKey]) {
        groupMap[projectKey] = [];
      }
      groupMap[projectKey].push(entry);
    }

    const groups: ProjectGroup[] = Object.keys(groupMap)
      .sort((a, b) => {
        // Empty (unassigned) goes last
        if (a === "" && b !== "") {
          return 1;
        }
        if (a !== "" && b === "") {
          return -1;
        }
        return a.localeCompare(b);
      })
      .map((project) => ({
        project,
        totalTimeSlots: groupMap[project].reduce(
          (sum, e) => sum + e.timeSlots,
          0,
        ),
        entries: groupMap[project],
      }));

    return {
      startOfDay,
      endOfDay,
      entries: overviewEntries,
      groups,
    };
  }

  private async copyRow(
    index: number,
    direction: "above" | "below",
  ): Promise<void> {
    const report = await this.loadTimeReport();
    const projects = await this.loadProjects();
    this.assignBranches(report, projects);

    const entry = report.entries[index];
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

    report.entries.push(newEntry);
    report.entries.sort((a, b) => a.key.localeCompare(b.key));

    // Update start/end of day based on the new entry
    this.updateStartEndOfDay(report);

    await this.saveReportToFile(report);
    await this.updateView();
  }

  updateStartEndOfDay(report: TimeReport): void {
    if (report.entries.length === 0) {
      return;
    }
    const keys = report.entries.map((e) => e.key).sort();
    const firstKey = keys[0];
    const lastKey = keys[keys.length - 1];
    const lastEndKey = this.shiftTimeKey(lastKey, 1);

    if (!report.startOfDay || firstKey < report.startOfDay) {
      report.startOfDay = firstKey;
    }
    if (!report.endOfDay || (lastEndKey && lastEndKey > report.endOfDay)) {
      report.endOfDay = lastEndKey || lastKey;
    }
  }

  shiftTimeKey(key: string, slots: number): string | null {
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

  private getTimeKey(date: Date): string {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = date.getMinutes();
    const groupSize = this.config.viewGroupByMinutes;
    const groupedMinutes = Math.floor(minutes / groupSize) * groupSize;
    const minutesStr = String(groupedMinutes).padStart(2, "0");
    return `${hours}:${minutesStr}`;
  }

  private async saveReportToFile(reportData: TimeReport): Promise<void> {
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

    // Only persist key, branch, directory, comment, project
    const savedReport: SavedTimeReport = {
      date: reportData.date,
      startOfDay: reportData.startOfDay || undefined,
      endOfDay: reportData.endOfDay || undefined,
      entries: reportData.entries.map((entry) => ({
        key: entry.key,
        branch: entry.branch,
        directory: entry.directory,
        comment: entry.comment,
        project: entry.project,
      })),
    };

    const reportPath = path.join(reportDir, `${day}.json`);
    await fs.writeFile(
      reportPath,
      JSON.stringify(savedReport, null, 2),
      "utf-8",
    );
    this.outputChannel.appendLine(`Time report written: ${reportPath}`);
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
      await this.saveReportToFile(reportData);

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
      if (branch === "_unbound") {
        const unbound = (projects as any)["_unbound"];
        if (Array.isArray(unbound)) {
          for (const name of unbound) {
            if (name) {
              allProjectNames.add(name);
            }
          }
        }
        continue;
      }
      if (typeof projects[branch] === "object" && projects[branch] !== null) {
        for (const dir of Object.keys(projects[branch])) {
          if (projects[branch][dir]) {
            allProjectNames.add(projects[branch][dir]);
          }
        }
      }
    }

    const projectNamesJson = JSON.stringify(Array.from(allProjectNames));

    const overviewRowsHtml = overview.groups
      .map((group) => {
        const groupTimeMinutes =
          group.totalTimeSlots * this.config.viewGroupByMinutes;
        const groupHours = Math.floor(groupTimeMinutes / 60);
        const groupMinutes = groupTimeMinutes % 60;
        const groupTimeStr =
          groupHours > 0
            ? `${groupHours}h ${groupMinutes}m`
            : `${groupMinutes}m`;
        const groupLabel = group.project || "Unassigned";

        const headerRow = `
            <tr class="project-group-header">
                <td colspan="3"><strong>${this.escapeHtml(groupLabel)}</strong></td>
                <td><strong>${this.escapeHtml(groupTimeStr)}</strong></td>
            </tr>`;

        const entryRows = group.entries
          .map((entry) => {
            const selectedProject = entry.project;
            const timeMinutes =
              entry.timeSlots * this.config.viewGroupByMinutes;
            const hours = Math.floor(timeMinutes / 60);
            const minutes = timeMinutes % 60;
            const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
            const branchCell = this.config.branchTaskUrl
              ? `<a href="${this.escapeHtml(this.config.branchTaskUrl.replace("{branch}", entry.branch))}" title="Open task">${this.escapeHtml(entry.branch)}</a>`
              : this.escapeHtml(entry.branch);
            const projectCell = `<div class="combobox-wrapper">
                    <input type="text" class="overview-project-input" data-branch="${this.escapeHtml(entry.branch)}" data-directory="${this.escapeHtml(entry.directory)}" value="${this.escapeHtml(selectedProject)}" placeholder="Select or type project..." autocomplete="off" />
                    <div class="combobox-dropdown"></div>
                </div>`;
            return `
            <tr class="project-group-entry">
                <td>${branchCell}</td>
                <td>${this.escapeHtml(entry.directory)}</td>
                <td>${projectCell}</td>
                <td>${this.escapeHtml(timeStr)}</td>
            </tr>`;
          })
          .join("");

        return headerRow + entryRows;
      })
      .join("");

    const entriesHtml = report.entries
      .map(
        (entry, index) => `
            <tr class="entry-row" data-index="${index}">
                <td class="row-buttons-cell">
                    <button class="row-btn copy-above-btn" data-index="${index}" title="Copy above">&#9650;</button>
                    <button class="row-btn copy-below-btn" data-index="${index}" title="Copy below">&#9660;</button>
                </td>
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
                }
                th, td {
                    text-align: left;
                    padding: 8px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                }
                td:nth-child(2) {
                    white-space: normal;
                    word-break: break-all;
                }
                td:has(.combobox-wrapper) {
                    overflow: visible;
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
                    overflow: visible;
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
                .combobox-wrapper {
                    position: relative;
                }
                .combobox-dropdown {
                    display: none;
                    position: absolute;
                    top: 100%;
                    left: 0;
                    right: 0;
                    z-index: 100;
                    background-color: var(--vscode-input-background);
                    border: 1px solid var(--vscode-input-border);
                    max-height: 150px;
                    overflow-y: auto;
                }
                .combobox-dropdown.open {
                    display: block;
                }
                .combobox-option {
                    padding: 4px 8px;
                    cursor: pointer;
                    color: var(--vscode-input-foreground);
                }
                .combobox-option:hover,
                .combobox-option.active {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .row-buttons-cell {
                    white-space: nowrap;
                    width: 1%;
                    padding: 2px 4px;
                }
                .row-btn {
                    display: inline-block;
                    padding: 2px 6px;
                    margin: 0 1px;
                    font-size: 10px;
                    line-height: 1;
                    min-width: 0;
                    cursor: pointer;
                    background-color: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    border-radius: 2px;
                }
                .row-btn:hover {
                    background-color: var(--vscode-button-secondaryHoverBackground);
                }
                .day-range-input {
                    width: 120px;
                    display: inline-block;
                }
                .project-group-header td {
                    background-color: var(--vscode-editor-lineHighlightBackground);
                    border-top: 2px solid var(--vscode-panel-border);
                    padding-top: 10px;
                }
                .project-group-entry td:first-child {
                    padding-left: 24px;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <h1>${this.escapeHtml(dateStr)}</h1>
                <div class="navigation">
                    <button id="refreshProjectsBtn" title="Re-apply project mappings from projects.json">&#8635; Update Projects</button>
                    <button id="prevDay">&#8592; Previous</button>
                    <button id="today">Today</button>
                    <button id="nextDay">Next &#8594;</button>
                </div>
            </div>

            <div class="overview-section">
                <h2>Overview</h2>
                <div class="day-range">
                    <span><strong>Start:</strong> <input type="text" id="startOfDay" class="day-range-input" value="${this.escapeHtml(overview.startOfDay || "")}" placeholder="—" /></span>
                    <span><strong>End:</strong> <input type="text" id="endOfDay" class="day-range-input" value="${this.escapeHtml(overview.endOfDay || "")}" placeholder="—" /></span>
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
                        <th></th>
                        <th>Time</th>
                        <th>Directory</th>
                        <th>Branch</th>
                        <th>Comment</th>
                        <th>Project</th>
                        <th>Assigned</th>
                    </tr>
                </thead>
                <tbody>
                    ${entriesHtml || '<tr><td colspan="7">No entries for this date</td></tr>'}
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
                let currentStartOfDay = '';
                let currentEndOfDay = '';
                
                window.addEventListener('message', event => {
                    const message = event.data;
                    if (message.command === 'loadEntries') {
                        currentEntries = message.entries;
                        currentDate = message.date;
                        currentProjects = message.projects || {};
                        currentStartOfDay = message.overview.startOfDay || '';
                        currentEndOfDay = message.overview.endOfDay || '';
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

                document.getElementById('refreshProjectsBtn').addEventListener('click', () => {
                    vscode.postMessage({ command: 'refreshProjects' });
                });

                // Overview project combobox handlers
                const allProjectNames = ${projectNamesJson};
                let activeIndex = -1;

                function setActiveOption(dropdown, index) {
                    const options = dropdown.querySelectorAll('.combobox-option');
                    options.forEach(o => o.classList.remove('active'));
                    if (index >= 0 && index < options.length) {
                        options[index].classList.add('active');
                        options[index].scrollIntoView({ block: 'nearest' });
                    }
                    activeIndex = index;
                }

                function showDropdown(input) {
                    const dropdown = input.parentElement.querySelector('.combobox-dropdown');
                    const filter = input.value.toLowerCase();
                    const matches = allProjectNames.filter(n => n.toLowerCase().includes(filter));
                    if (matches.length === 0) {
                        dropdown.classList.remove('open');
                        activeIndex = -1;
                        return;
                    }
                    dropdown.innerHTML = matches.map(n =>
                        '<div class="combobox-option">' + escapeHtml(n) + '</div>'
                    ).join('');
                    dropdown.classList.add('open');
                    activeIndex = -1;
                    dropdown.querySelectorAll('.combobox-option').forEach(opt => {
                        opt.addEventListener('mousedown', (ev) => {
                            ev.preventDefault();
                            input.value = opt.textContent;
                            dropdown.classList.remove('open');
                            activeIndex = -1;
                            input.dispatchEvent(new Event('change'));
                        });
                    });
                }

                function selectActiveOption(input) {
                    const dropdown = input.parentElement.querySelector('.combobox-dropdown');
                    const options = dropdown.querySelectorAll('.combobox-option');
                    if (activeIndex >= 0 && activeIndex < options.length) {
                        input.value = options[activeIndex].textContent;
                        dropdown.classList.remove('open');
                        activeIndex = -1;
                        input.dispatchEvent(new Event('change'));
                    }
                }

                document.querySelectorAll('.overview-project-input').forEach(input => {
                    input.addEventListener('focus', () => showDropdown(input));
                    input.addEventListener('input', () => showDropdown(input));
                    input.addEventListener('blur', () => {
                        const dropdown = input.parentElement.querySelector('.combobox-dropdown');
                        dropdown.classList.remove('open');
                        activeIndex = -1;
                    });
                    input.addEventListener('keydown', (e) => {
                        const dropdown = input.parentElement.querySelector('.combobox-dropdown');
                        const options = dropdown.querySelectorAll('.combobox-option');
                        if (!dropdown.classList.contains('open') || options.length === 0) {
                            return;
                        }
                        if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            setActiveOption(dropdown, Math.min(activeIndex + 1, options.length - 1));
                        } else if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            setActiveOption(dropdown, Math.max(activeIndex - 1, 0));
                        } else if (e.key === 'Enter') {
                            e.preventDefault();
                            selectActiveOption(input);
                        } else if (e.key === 'Escape') {
                            dropdown.classList.remove('open');
                            activeIndex = -1;
                        }
                    });
                    input.addEventListener('change', (e) => {
                        const branch = e.target.dataset.branch;
                        const directory = e.target.dataset.directory;
                        const project = e.target.value.trim();
                        vscode.postMessage({ command: 'updateProjectMapping', branch: branch, project: project, directory: directory });
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
                            entries: currentEntries,
                            startOfDay: document.getElementById('startOfDay').value.trim(),
                            endOfDay: document.getElementById('endOfDay').value.trim()
                        }
                    });
                });

                document.querySelectorAll('.entry-row').forEach(row => {
                    row.addEventListener('click', (e) => {
                        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') {
                            return;
                        }
                        const index = parseInt(row.dataset.index);
                        document.querySelectorAll('.entry-row').forEach(r => r.classList.remove('selected'));
                        row.classList.add('selected');
                        showDetail(index);
                    });
                });

                document.querySelectorAll('.copy-above-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const index = parseInt(btn.dataset.index);
                        vscode.postMessage({ command: 'copyRow', index: index, direction: 'above' });
                    });
                });

                document.querySelectorAll('.copy-below-btn').forEach(btn => {
                    btn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const index = parseInt(btn.dataset.index);
                        vscode.postMessage({ command: 'copyRow', index: index, direction: 'below' });
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
