import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { CoftConfig } from "../application/config";
import { OperationRepository } from "../storage/operationRepository";
import { OperationQueueWriter } from "../application/operationQueueWriter";
import { BatchService } from "../services/batchService";
import { TimeEntry, TimeReport } from "../storage/batchRepository";
import {
  TimeReportRepository,
  SavedTimeEntry,
  SavedTimeReport,
} from "../storage/timeReportRepository";
import { ProjectRepository, ProjectMap } from "../storage/projectRepository";
import { Logger } from "../utils/logger";
import {
  OverviewData,
  QueuedOperation,
  ProjectGroup,
  OverviewEntry,
} from "./types";
import { TimeReportViewModel } from "./timeReportViewModel";
import template from "./timeReportTemplate.html";

const DEFAULT_BRANCHES = ["main", "master", "no-branch"];

export class TimeReportProvider {
  private config: CoftConfig;
  private logger: Logger;
  private version: string;
  private currentDate: Date;
  private panel: vscode.WebviewPanel | null = null;
  private currentReport: TimeReport | null = null;
  private currentReportDate: string | null = null;
  private processedBatchFiles: Set<string> = new Set();
  private cachedProjects: ProjectMap | null = null;
  private operationQueue: QueuedOperation[] = [];
  private defaultBranchProjects: { [compositeKey: string]: string } = {};
  private timeReportRepository: TimeReportRepository;
  private projectRepository: ProjectRepository;
  private operationRepository: OperationRepository;
  private batchService: BatchService;
  private viewModelInstance: TimeReportViewModel;

  constructor(config: CoftConfig, logger: Logger, version: string) {
    this.config = config;
    this.logger = logger;
    this.version = version;
    this.currentDate = new Date();
    this.timeReportRepository = new TimeReportRepository(config);
    this.projectRepository = new ProjectRepository(config, logger);
    this.operationRepository = new OperationRepository(config, logger);
    this.batchService = new BatchService(config, logger);
    this.viewModelInstance = new TimeReportViewModel(config, logger);
  }

  private lookupProject(
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

  private assignBranches(
    report: TimeReport,
    projects: ProjectMap,
    forceRefresh: boolean = false,
  ): void {
    // Pre-populate defaultBranchProjects from saved entries so new
    // timeslots for the same default branch + directory inherit the project
    for (const entry of report.entries) {
      const branch = entry.assignedBranch || entry.branch;
      if (DEFAULT_BRANCHES.includes(branch) && entry.project) {
        const compositeKey = `${branch}\0${entry.directory}`;
        if (this.defaultBranchProjects[compositeKey] === undefined) {
          this.defaultBranchProjects[compositeKey] = entry.project;
        }
      }
    }

    // Group entries by time key
    const keyEntries: { [key: string]: TimeEntry[] } = {};
    for (const entry of report.entries) {
      if (!keyEntries[entry.key]) {
        keyEntries[entry.key] = [];
      }
      keyEntries[entry.key].push(entry);
    }

    // For each time key, select the entry with the most changed files
    const winningEntries: TimeEntry[] = [];
    for (const key of Object.keys(keyEntries)) {
      const entries = keyEntries[key];
      let winner = entries[0];
      for (let i = 1; i < entries.length; i++) {
        if (entries[i].files.length > winner.files.length) {
          winner = entries[i];
        }
      }

      // Set assignedBranch based on the winning entry's branch
      if (forceRefresh) {
        winner.assignedBranch = winner.branch;
      } else if (!winner.assignedBranch) {
        winner.assignedBranch = winner.branch;
      }

      // Only auto-assign projects when no saved report exists, or project is missing
      if (!report.hasSavedReport || !winner.project) {
        winner.project = this.lookupProject(
          projects,
          winner.assignedBranch,
          winner.directory,
        );
      }

      winningEntries.push(winner);
    }

    // Replace entries with only the winning entry per time key
    report.entries = winningEntries;
    report.entries.sort((a, b) => a.key.localeCompare(b.key));
  }

  private computeOverview(
    report: TimeReport,
    projects: ProjectMap,
  ): OverviewData {
    let earliestTimestamp = Infinity;
    let latestTimestamp = -Infinity;

    const compositeTimeSlots: {
      [compositeKey: string]: {
        branch: string;
        directory: string;
        keys: Set<string>;
      };
    } = {};

    for (const entry of report.entries) {
      const branchToUse = entry.assignedBranch || entry.branch;
      const compositeKey = `${branchToUse}\0${entry.directory}`;
      if (!compositeTimeSlots[compositeKey]) {
        compositeTimeSlots[compositeKey] = {
          branch: branchToUse,
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

    const totalSlots = groups.reduce((sum, g) => sum + g.totalTimeSlots, 0);
    const totalMinutes = totalSlots * this.config.viewGroupByMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    const totalHours =
      totalMinutes === 0
        ? ""
        : hours > 0
          ? `${hours}h ${minutes}m`
          : `${minutes}m`;

    return {
      startOfDay,
      endOfDay,
      totalHours,
      entries: overviewEntries,
      groups,
    };
  }

  private async processQueue(): Promise<void> {
    for (const op of this.operationQueue) {
      if (op.type === "saveReport") {
        if (this.currentReport) {
          await this.saveReportToFile(this.currentReport);
        }
      }
    }
    this.operationQueue = [];
  }

  private getDateString(): string {
    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(this.currentDate.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  resetViewModel(): void {
    this.currentReport = null;
    this.currentReportDate = null;
    this.viewModelInstance.setReport(null);
    this.processedBatchFiles = new Set();
  }

  triggerSave(): void {
    if (this.panel) {
      this.panel.webview.postMessage({ command: "triggerSave" });
    }
  }

  async show(
    context: vscode.ExtensionContext,
    forceNew: boolean = false,
  ): Promise<void> {
    this.logger.debug(`Showing time report, forceNew: ${forceNew}`);
    if (!forceNew && this.panel) {
      this.logger.debug("Revealing existing panel");
      this.panel.reveal();
      return;
    }

    this.logger.debug("Creating new webview panel");
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
      this.logger.debug("Panel disposed");
      this.panel = null;
      vscode.commands.executeCommand(
        "setContext",
        "coftTimeReportFocused",
        false,
      );
    });

    context.subscriptions.push(
      this.panel.onDidChangeViewState(() => {
        vscode.commands.executeCommand(
          "setContext",
          "coftTimeReportFocused",
          this.panel !== null && this.panel.active,
        );
      }),
    );

    this.panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.handleMessage(message);
      },
      undefined,
      context.subscriptions,
    );

    await this.updateView();
  }

  async showForDate(
    context: vscode.ExtensionContext,
    date: Date,
  ): Promise<void> {
    this.currentDate = date;
    this.resetViewModel();
    await this.show(context, true);
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      switch (message.command) {
        case "nextDay":
          this.currentDate.setDate(this.currentDate.getDate() + 1);
          this.resetViewModel();
          await this.updateView();
          break;
        case "previousDay":
          this.currentDate.setDate(this.currentDate.getDate() - 1);
          this.resetViewModel();
          await this.updateView();
          break;
        case "today":
          this.currentDate = new Date();
          this.resetViewModel();
          await this.updateView();
          break;
        case "save":
          if (!this.currentReport) {
            this.logger.error("No current report available to save");
            break;
          }
          await this.saveReport({
            ...this.currentReport,
            entries: message.entries ?? this.currentReport.entries,
          });
          await this.updateView();
          break;
        case "updateProjectMapping":
          if (DEFAULT_BRANCHES.includes(message.branch as string)) {
            const compositeKey = `${message.branch}\0${message.directory}`;
            this.defaultBranchProjects[compositeKey] =
              message.project as string;
          } else {
            // Update cached projects immediately for responsive UI
            if (this.cachedProjects) {
              if (!this.cachedProjects[message.branch as string]) {
                this.cachedProjects[message.branch as string] = {};
              }
              this.cachedProjects[message.branch as string][
                message.directory as string
              ] = message.project as string;
            }
            await this.viewModelInstance.updateProjectMapping(
              message.branch,
              message.project,
              message.directory,
            );
          }
          await this.updateView();
          break;
        case "copyRow":
          {
            this.viewModelInstance.copyRow(message.index, message.direction);
            await this.updateView();
          }
          break;
        case "refreshProjects":
          await this.refreshProjects();
          break;
        case "refreshView":
          await this.updateView();
          break;
        case "exportHtml":
          if (this.panel) {
            const html = this.panel.webview.html;
            const tmpDir = os.tmpdir();
            const fileName = `coft-report-${Date.now()}-v${this.version}.html`;
            const filePath = path.join(tmpDir, fileName);
            fs.writeFileSync(filePath, html);
            this.logger.info(`Exported HTML to ${filePath}`);
          }
          break;
      }
    } catch (error) {
      this.logger.error(`Error handling message ${message.command}: ${error}`);
    }
  }

  private async refreshProjects(): Promise<void> {
    const report = await this.loadTimeReport();

    // If report was previously saved, ask user for confirmation
    if (report.hasSavedReport) {
      const answer = await vscode.window.showWarningMessage(
        "This will update all assigned branches and projects. Continue?",
        "Yes",
        "No",
      );
      if (answer !== "Yes") {
        return;
      }
    }

    const projects = await this.loadProjects();
    this.assignBranches(report, projects, true);

    // Queue the save of the updated report
    this.operationQueue.push({ type: "saveReport" });

    // Update the view with the refreshed data
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
    try {
      if (!this.panel) {
        this.logger.debug("No panel available, skipping updateView");
        return;
      }
      this.logger.debug("Starting updateView");

      const report = await this.loadTimeReport();
      this.logger.debug(`Loaded report with ${report.entries.length} entries`);
      const projects = await this.loadProjects();
      this.logger.debug(
        `Loaded ${Object.keys(projects).length} project mappings`,
      );
      const projectsForView = this.mergeDefaultBranchProjects(projects);
      this.assignBranches(report, projectsForView);
      const overview = this.computeOverview(report, projectsForView);
      this.logger.debug(
        `Computed overview with ${overview.groups.length} groups`,
      );
      this.panel.webview.html = this.getHtmlContent(
        report,
        overview,
        projectsForView,
      );
      // Send report data via messaging to avoid XSS from inline JSON
      await this.panel.webview.postMessage({
        command: "loadEntries",
        entries: report.entries,
        date: report.date,
        overview: overview,
        projects: projectsForView,
      });
      this.logger.debug("UpdateView completed successfully");
    } catch (error) {
      this.logger.error(`Error updating view: ${error}`);
    }
  }

  private async loadTimeReport(): Promise<TimeReport> {
    try {
      const dateStr = this.getDateString();
      this.logger.debug(`Loading time report for date: ${dateStr}`);

      // Use cached view model if available for the same date
      if (this.currentReport !== null && this.currentReportDate === dateStr) {
        this.logger.debug("Using cached report");
        this.currentReport = await this.batchService.mergeBatchesIntoTimeReport(
          this.currentReport,
          this.currentDate,
          this.config.viewGroupByMinutes,
          this.processedBatchFiles,
        );
        this.viewModelInstance.setReport(this.currentReport);
        return this.currentReport;
      }

      // Full load - reset processed batch files
      this.processedBatchFiles = new Set();
      this.logger.debug("Performing full load");

      let savedEntries: SavedTimeEntry[] = [];
      let savedStartOfDay: string | undefined;
      let savedEndOfDay: string | undefined;
      let hasSavedReport = false;

      const saved = await this.timeReportRepository.readReport(
        this.currentDate,
      );
      if (saved) {
        savedEntries = saved.entries || [];
        savedStartOfDay = saved.startOfDay;
        savedEndOfDay = saved.endOfDay;
        hasSavedReport = true;
        this.logger.debug(
          `Loaded saved report with ${savedEntries.length} entries`,
        );
      } else {
        this.logger.debug("No saved report found");
      }

      // Build report entirely from batch data
      let report: TimeReport = {
        date: this.currentDate.toISOString(),
        entries: [],
      };
      report = await this.batchService.mergeBatchesIntoTimeReport(
        report,
        this.currentDate,
        this.config.viewGroupByMinutes,
      );
      this.logger.debug(
        `Merged batches into report with ${report.entries.length} entries`,
      );
      report.startOfDay = savedStartOfDay;
      report.endOfDay = savedEndOfDay;
      report.hasSavedReport = hasSavedReport;

      // Apply saved comments and projects back onto batch-derived entries
      for (const savedEntry of savedEntries) {
        const match = report.entries.find(
          (e) =>
            e.key === savedEntry.key && e.directory === savedEntry.directory,
        );
        if (match) {
          if (savedEntry.comment) {
            match.comment = savedEntry.comment;
          }
          if (savedEntry.project) {
            match.project = savedEntry.project;
          }
          if (savedEntry.branch) {
            match.branch = savedEntry.branch;
          }
          if (savedEntry.assignedBranch) {
            match.assignedBranch = savedEntry.assignedBranch;
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
            assignedBranch: savedEntry.assignedBranch || "",
          });
        }
      }

      report.entries.sort((a, b) => a.key.localeCompare(b.key));
      this.logger.debug(`Final report has ${report.entries.length} entries`);

      // Cache the loaded report as the view model
      this.currentReport = report;
      this.currentReportDate = dateStr;
      this.viewModelInstance.setReport(report);

      return report;
    } catch (error) {
      this.logger.error(`Error loading time report: ${error}`);
      throw error;
    }
  }

  private mergeDefaultBranchProjects(projects: ProjectMap): ProjectMap {
    if (Object.keys(this.defaultBranchProjects).length === 0) {
      return projects;
    }
    const merged: ProjectMap = { ...projects };
    for (const [compositeKey, project] of Object.entries(
      this.defaultBranchProjects,
    )) {
      const separatorIndex = compositeKey.indexOf("\0");
      const branch = compositeKey.substring(0, separatorIndex);
      const directory = compositeKey.substring(separatorIndex + 1);
      merged[branch] = { ...(merged[branch] ?? {}), [directory]: project };
    }
    return merged;
  }

  async loadProjects(): Promise<ProjectMap> {
    if (this.cachedProjects !== null) {
      this.logger.debug("Using cached projects");
      return this.cachedProjects;
    }
    this.logger.debug("Loading projects from repository");
    this.cachedProjects = await this.projectRepository.readProjects();
    this.logger.debug(
      `Loaded projects: ${JSON.stringify(this.cachedProjects)}`,
    );
    return this.cachedProjects;
  }

  formatTotalWorkedHours(overview: OverviewData): string {
    const totalSlots = overview.groups.reduce(
      (sum, group) => sum + group.totalTimeSlots,
      0,
    );
    const totalMinutes = totalSlots * this.config.viewGroupByMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (totalMinutes === 0) {
      return "";
    }
    return hours > 0 ? `Total: ${hours}h ${minutes}m` : `Total: ${minutes}m`;
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

  hasTimeGap(entries: TimeEntry[], index: number): boolean {
    if (index < 0 || index >= entries.length - 1) {
      return false;
    }
    const expectedNext = this.shiftTimeKey(entries[index].key, 1);
    if (expectedNext === null) {
      return false;
    }
    return entries[index + 1].key !== expectedNext;
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

  private async saveReportToFile(reportData: TimeReport): Promise<void> {
    // Update the in-memory view model immediately
    this.currentReport = reportData;
    this.currentReportDate = this.getDateString();
    this.viewModelInstance.setReport(reportData);

    const year = this.currentDate.getFullYear();
    const month = String(this.currentDate.getMonth() + 1).padStart(2, "0");
    const day = String(this.currentDate.getDate()).padStart(2, "0");
    const reportFile = path.join("reports", String(year), month, `${day}.json`);

    await OperationQueueWriter.write(
      this.operationRepository,
      {
        type: "timereport",
        file: reportFile,
        body: this.buildSavedReport(reportData),
      },
      this.logger,
    );
  }

  private async saveReport(reportData: TimeReport): Promise<void> {
    await this.timeReportRepository.saveReport(reportData);
    this.currentReport = reportData;
    this.viewModelInstance.setReport(reportData);
    await this.processQueue();
    try {
      // Save project mappings from report entries
      for (const entry of reportData.entries) {
        const mappingBranch = entry.assignedBranch || entry.branch;
        if (DEFAULT_BRANCHES.includes(mappingBranch)) {
          continue;
        }
        if (entry.project) {
          await OperationQueueWriter.write(
            this.operationRepository,
            {
              type: "projectChange",
              action: "add",
              branch: mappingBranch,
              directory: entry.directory,
              project: entry.project,
            },
            this.logger,
          );
        }
      }

      vscode.window.showInformationMessage("Time report saved successfully");
    } catch (error) {
      this.logger.error(`Error saving time report: ${error}`);
      vscode.window.showErrorMessage(`Failed to save time report: ${error}`);
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

    const existingKeys = new Set(report.entries.map((e) => e.key));

    const entriesHtml = report.entries
      .map((entry, index) => {
        const gapClass = this.hasTimeGap(report.entries, index)
          ? " time-gap"
          : "";
        const keyAbove = this.shiftTimeKey(entry.key, -1);
        const keyBelow = this.shiftTimeKey(entry.key, 1);
        const disabledAbove =
          keyAbove === null || existingKeys.has(keyAbove) ? " disabled" : "";
        const disabledBelow =
          keyBelow === null || existingKeys.has(keyBelow) ? " disabled" : "";
        return `
            <tr class="entry-row${gapClass}" data-index="${index}">
                <td class="row-buttons-cell">
                    <button class="row-btn copy-above-btn" data-index="${index}" title="Copy above"${disabledAbove}>&#9650;</button>
                    <button class="row-btn copy-below-btn" data-index="${index}" title="Copy below"${disabledBelow}>&#9660;</button>
                    <button class="row-btn edit-btn" data-index="${index}" title="Edit branch">&#9998;</button>
                </td>
                <td>${this.escapeHtml(entry.key)}</td>
                <td>${this.escapeHtml(entry.directory)}</td>
                <td class="branch-cell">${this.escapeHtml(entry.branch)}</td>
                <td><input type="text" class="comment-field" data-index="${index}" value="${this.escapeHtml(entry.comment)}" /></td>
                <td class="project-cell">${this.escapeHtml(entry.project)}</td>
                <td class="assigned-branch-cell">${this.escapeHtml(entry.assignedBranch)}</td>
            </tr>
        `;
      })
      .join("");

    const allProjectNames = new Set<string>();
    for (const branch of Object.keys(projects)) {
      if (branch === "_unbound") {
        const unbound = (projects as { _unbound?: string[] })["_unbound"];
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

    const replacements = {
      dateStr: this.escapeHtml(dateStr),
      startOfDay: this.escapeHtml(overview.startOfDay || ""),
      endOfDay: this.escapeHtml(overview.endOfDay || ""),
      totalHours: this.escapeHtml(overview.totalHours || ""),
      overviewHtml: overviewRowsHtml,
      entriesHtml: entriesHtml,
      entriesJson: JSON.stringify(report.entries),
      projectsJson: JSON.stringify(projects),
      overviewJson: JSON.stringify(overview),
      projectNamesJson: JSON.stringify(Array.from(allProjectNames)),
      exportButton: this.logger.isDebugEnabled()
        ? '<button id="exportHtml">Export HTML</button>'
        : "",
    };

    return template.replace(
      /{{(\w+)}}/g,
      (match: string, key: string) =>
        replacements[key as keyof typeof replacements] || match,
    );
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
