import * as vscode from "vscode";
import * as path from "path";
import { ConfigManager } from "./application/config";
import { StorageManager } from "./storage/storage";
import { GitManager } from "./storage/git";
import { BatchProcessor } from "./application/batchProcessor";
import { OperationQueueProcessor } from "./application/operationQueueProcessor";
import { OperationQueueWriter } from "./application/operationQueueWriter";
import { TimeReportProvider } from "./presentation/timeReport";
import { TimeSummaryProvider } from "./presentation/timeSummary";
import { Logger } from "./utils/logger";

let outputChannel: vscode.OutputChannel;
let logger: Logger;
let batchProcessor: BatchProcessor | null = null;
let operationQueueProcessor: OperationQueueProcessor | null = null;
let timeReportProvider: TimeReportProvider | null = null;
let timeSummaryProvider: TimeSummaryProvider | null = null;
let storage: StorageManager | null = null;
let git: GitManager | null = null;
let isEnabled = false;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("COFT SmartTime");
  const debugEnabled = vscode.workspace
    .getConfiguration("coft.smarttime")
    .get("enableDebugLogs", false);
  logger = new Logger(outputChannel, debugEnabled);
  logger.info("COFT SmartTime extension activating...");
  const version = context.extension.packageJSON.version;
  logger.info(`Extension version: ${version}`);

  // Register save hook
  const saveDisposable = vscode.workspace.onDidSaveTextDocument(
    async (document) => {
      if (isEnabled) {
        await handleFileSave(document);
      }
    },
  );

  // Register time report command
  const timeReportDisposable = vscode.commands.registerCommand(
    "coft-smarttime.showTimeReport",
    async () => {
      if (timeReportProvider) {
        await timeReportProvider.show(context);
      } else {
        vscode.window.showErrorMessage("COFT SmartTime is not initialized");
      }
    },
  );

  // Register time summary command
  const timeSummaryDisposable = vscode.commands.registerCommand(
    "coft-smarttime.showTimeSummary",
    async () => {
      if (timeSummaryProvider) {
        await timeSummaryProvider.show(context);
      } else {
        vscode.window.showErrorMessage("COFT SmartTime is not initialized");
      }
    },
  );

  // Register backup command
  const backupDisposable = vscode.commands.registerCommand(
    "coft-smarttime.backup",
    async () => {
      if (storage) {
        await OperationQueueWriter.write(
          storage.operationRepository,
          { type: "housekeeping" },
          logger,
        );
      }
    },
  );

  // Register save time report command (Ctrl+S when webview focused)
  const saveReportDisposable = vscode.commands.registerCommand(
    "coft-smarttime.saveTimeReport",
    () => {
      if (timeReportProvider) {
        timeReportProvider.triggerSave();
      }
    },
  );

  // Listen for config changes
  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
    async (event) => {
      if (event.affectsConfiguration("coft.smarttime")) {
        logger.info("Configuration changed, reinitializing...");
        shutdown();
        const newDebugEnabled = vscode.workspace
          .getConfiguration("coft.smarttime")
          .get("enableDebugLogs", false);
        logger = new Logger(outputChannel, newDebugEnabled);
        await initialize(context);
      }
    },
  );

  context.subscriptions.push(
    saveDisposable,
    timeReportDisposable,
    timeSummaryDisposable,
    backupDisposable,
    saveReportDisposable,
    configChangeDisposable,
  );

  // Initialize
  const initialized = await initialize(context);
  if (!initialized) {
    logger.error("Extension initialization failed");
    return;
  }

  logger.info("COFT SmartTime extension activated successfully");
}

export function deactivate() {
  shutdown();
  logger.info("COFT SmartTime extension deactivated");
}

function shutdown(): void {
  if (batchProcessor) {
    batchProcessor.stop();
    batchProcessor = null;
  }
  if (operationQueueProcessor) {
    operationQueueProcessor.stop();
    operationQueueProcessor = null;
  }
  timeReportProvider = null;
  timeSummaryProvider = null;
  storage = null;
  git = null;
  isEnabled = false;
}

async function initialize(context: vscode.ExtensionContext): Promise<boolean> {
  try {
    const version = context.extension.packageJSON.version;

    // Get configuration
    const configManager = new ConfigManager(logger);
    const config = configManager.getConfig();

    logger.info(`COFT_ROOT: ${config.root}`);
    logger.info(`COFT_INTERVAL_SECONDS: ${config.intervalSeconds}`);
    logger.info(`COFT_VIEW_GROUP_BY_MINUTES: ${config.viewGroupByMinutes}`);

    // Initialize storage
    storage = new StorageManager(config, logger);
    const storageInitialized = await storage.initialize();
    if (!storageInitialized) {
      return false;
    }

    // Initialize git
    const extensionVersion = context.extension.packageJSON.version || "0.0.1";
    git = new GitManager(config, logger, extensionVersion);
    await git.initialize();

    // Start batch processor
    batchProcessor = new BatchProcessor(config, storage, logger);
    batchProcessor.start();

    // Start operation queue processor
    operationQueueProcessor = new OperationQueueProcessor(
      config,
      git,
      storage,
      logger,
    );
    operationQueueProcessor.start();

    // Create time report provider
    timeReportProvider = new TimeReportProvider(config, logger, version);

    // Create time summary provider
    timeSummaryProvider = new TimeSummaryProvider(
      config,
      logger,
      async (date: Date) => {
        if (timeReportProvider) {
          await timeReportProvider.showForDate(context, date);
        }
      },
    );

    isEnabled = true;
    return true;
  } catch (error) {
    logger.error(`Initialization error: ${error}`);
    return false;
  }
}

async function handleFileSave(document: vscode.TextDocument): Promise<void> {
  try {
    if (!storage || !git) {
      return;
    }

    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;
    const relativePath = path.relative(workspaceRoot, document.uri.fsPath);
    const gitBranch = await git.getBranch(workspaceFolder);

    await storage.writeQueueEntry(workspaceRoot, relativePath, gitBranch);
  } catch (error) {
    logger.error(`Error handling file save: ${error}`);
    vscode.window.showErrorMessage(
      `COFT SmartTime: Failed to save time entry: ${error}`,
    );
  }
}
