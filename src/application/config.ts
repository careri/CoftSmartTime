import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";

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
}

export class ConfigManager {
  private outputChannel: vscode.OutputChannel;

  constructor(outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
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
      this.outputChannel.appendLine(
        `Warning: coft.smarttime.root is not a valid path: ${root}. Using default: ${defaultRoot}`,
      );
      root = defaultRoot;
    }

    // Validate interval seconds
    let intervalSeconds = config.get<number>("intervalSeconds", 60);
    if (intervalSeconds < 60 || intervalSeconds > 300) {
      this.outputChannel.appendLine(
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
      this.outputChannel.appendLine(
        `Warning: viewGroupByMinutes (${viewGroupByMinutes}) is invalid. Using default value: 15`,
      );
      viewGroupByMinutes = 15;
    }

    // Get branch task URL
    const branchTaskUrl = config.get<string>("branchTaskUrl", "");

    // Get export directory
    let exportDir = config.get<string>("exportDir", "");
    if (exportDir && !this.isValidPath(exportDir)) {
      this.outputChannel.appendLine(
        `Warning: coft.smarttime.exportDir is not a valid path: ${exportDir}. Export disabled.`,
      );
      exportDir = "";
    }

    // Get export age days
    let exportAgeDays = config.get<number>("exportAgeDays", 90);
    if (exportAgeDays < 1) {
      this.outputChannel.appendLine(
        `Warning: exportAgeDays (${exportAgeDays}) is invalid. Using default value: 90`,
      );
      exportAgeDays = 90;
    }

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
