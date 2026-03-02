import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { Logger } from "../utils/logger";

export interface CoftConfig {
  root: string;
  queue: string;
  queueBatch: string;
  queueBackup: string;
  operationQueue: string;
  operationQueueBackup: string;
  data: string;
  backup: string;
  intervalSeconds: number;
  viewGroupByMinutes: number;
  branchTaskUrl: string;
  exportDir: string;
  exportAgeDays: number;
  startOfWeek: string;
  /** Default working hours per weekday in minutes. */
  workingHoursDefault: number;
  /** Per-weekday working hours in minutes. Index 0 = Sunday, 1 = Monday, …, 6 = Saturday. */
  workingHoursByDay: number[];
  /** True when the master `coft.smarttime.working.hours` setting is absent; a fallback of 8 h is used. */
  workingHoursMissingConfig: boolean;
}

/**
 * Returns the normal working hours (in minutes) for the given date,
 * using per-weekday overrides when available, falling back to the master default.
 */
export function resolveWorkingHours(config: CoftConfig, date: Date): number {
  return config.workingHoursByDay[date.getDay()];
}

export function getStartDayOfWeek(startOfWeek: string): number {
  if (startOfWeek === "sunday") {
    return 0;
  }
  if (startOfWeek === "monday") {
    return 1;
  }
  // For auto, approximate culture default
  const locale = Intl.DateTimeFormat().resolvedOptions().locale;
  return locale.startsWith("en-US") ? 0 : 1; // Sunday for US, Monday for others
}

export class ConfigManager {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  getConfig(): CoftConfig {
    const config = vscode.workspace.getConfiguration("coft.smarttime");

    // Get root directory
    const defaultRoot = path.join(os.homedir(), ".coft.smarttime");
    let root = config.get<string>("root", "");
    if (!root) {
      root = defaultRoot;
    }

    // Validate root path
    if (!this.isValidPath(root)) {
      this.logger.info(
        `Warning: coft.smarttime.root is not a valid path: ${root}. Using default: ${defaultRoot}`,
      );
      root = defaultRoot;
    }

    // Validate interval seconds
    let intervalSeconds = config.get<number>("intervalSeconds", 60);
    if (intervalSeconds < 60 || intervalSeconds > 300) {
      this.logger.info(
        `Warning: intervalSeconds (${intervalSeconds}) is out of range. Using default value: 60`,
      );
      intervalSeconds = 60;
    }

    // Validate view group by minutes
    let viewGroupByMinutes = config.get<number>("viewGroupByMinutes", 15);
    if (
      viewGroupByMinutes <= 0 ||
      viewGroupByMinutes > 60 ||
      60 % viewGroupByMinutes !== 0
    ) {
      this.logger.info(
        `Warning: viewGroupByMinutes (${viewGroupByMinutes}) is invalid. Using default value: 15`,
      );
      viewGroupByMinutes = 15;
    }

    // Get branch task URL
    const branchTaskUrl = config.get<string>("branchTaskUrl", "");

    // Get export directory
    let exportDir = config.get<string>("exportDir", "");
    if (exportDir && !this.isValidPath(exportDir)) {
      this.logger.info(
        `Warning: coft.smarttime.exportDir is not a valid path: ${exportDir}. Export disabled.`,
      );
      exportDir = "";
    }

    // Get export age days
    let exportAgeDays = config.get<number>("exportAgeDays", 90);
    if (exportAgeDays < 1) {
      this.logger.info(
        `Warning: exportAgeDays (${exportAgeDays}) is invalid. Using default value: 90`,
      );
      exportAgeDays = 90;
    }

    // Get start of week
    const startOfWeek = config.get<string>("startOfWeek", "auto");

    // Get working hours
    const masterHoursRaw = config.get<number | undefined>(
      "working.hours",
      undefined,
    );
    const workingHoursMissingConfig =
      masterHoursRaw === undefined ||
      masterHoursRaw === null ||
      typeof masterHoursRaw !== "number" ||
      masterHoursRaw < 0 ||
      isNaN(masterHoursRaw);
    const masterHoursPerDay = workingHoursMissingConfig ? 8 : masterHoursRaw!;

    const dayNames = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    const defaultsByDow = [
      0,
      masterHoursPerDay,
      masterHoursPerDay,
      masterHoursPerDay,
      masterHoursPerDay,
      masterHoursPerDay,
      0,
    ];
    const workingHoursByDay: number[] = dayNames.map((day, idx) => {
      const raw = config.get<number | undefined>(
        `working.hours.${day}`,
        undefined,
      );
      if (
        raw === undefined ||
        raw === null ||
        typeof raw !== "number" ||
        raw < 0 ||
        isNaN(raw)
      ) {
        return defaultsByDow[idx] * 60;
      }
      return raw * 60;
    });

    return {
      root,
      queue: path.join(root, "queue"),
      queueBatch: path.join(root, "queue_batch"),
      queueBackup: path.join(root, "queue_backup"),
      operationQueue: path.join(root, "operation_queue"),
      operationQueueBackup: path.join(root, "operation_queue_backup"),
      data: path.join(root, "data"),
      backup: path.join(root, "backup"),
      intervalSeconds,
      viewGroupByMinutes,
      branchTaskUrl,
      exportDir,
      exportAgeDays,
      startOfWeek,
      workingHoursDefault: masterHoursPerDay * 60,
      workingHoursByDay,
      workingHoursMissingConfig,
    };
  }

  private isValidPath(filePath: string): boolean {
    try {
      path.resolve(filePath);
    } catch {
      return false;
    }

    if (filePath.length === 0) {
      return false;
    }

    // Check for null bytes
    if (filePath.includes("\0")) {
      return false;
    }

    // Must be an absolute path
    if (!path.isAbsolute(filePath)) {
      return false;
    }

    return true;
  }
}
