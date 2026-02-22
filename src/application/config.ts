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
