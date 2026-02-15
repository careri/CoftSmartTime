import * as vscode from "vscode";
import * as path from "path";
import { ConfigManager, CoftConfig } from "./config";
import { StorageManager } from "./storage";
import { GitManager } from "./git";
import { BatchProcessor } from "./batch";
import { OperationQueueProcessor } from "./operationQueue";
import { TimeReportProvider } from "./timeReport";

let outputChannel: vscode.OutputChannel;
let batchProcessor: BatchProcessor | null = null;
let operationQueueProcessor: OperationQueueProcessor | null = null;
let timeReportProvider: TimeReportProvider | null = null;
let storage: StorageManager | null = null;
let git: GitManager | null = null;
let isEnabled = false;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("COFT SmartTime");
  outputChannel.appendLine("COFT SmartTime extension activating...");

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

  // Register backup command
  const backupDisposable = vscode.commands.registerCommand(
    "coft-smarttime.backup",
    async () => {
      if (git) {
        await git.housekeeping();
      } else {
        vscode.window.showErrorMessage("COFT SmartTime is not initialized");
      }
    },
  );

  // Listen for config changes
  const configChangeDisposable = vscode.workspace.onDidChangeConfiguration(
    async (event) => {
      if (event.affectsConfiguration("coft.smarttime")) {
        outputChannel.appendLine("Configuration changed, reinitializing...");
        shutdown();
        await initialize(context);
      }
    },
  );

  context.subscriptions.push(
    saveDisposable,
    timeReportDisposable,
    backupDisposable,
    configChangeDisposable,
  );

  // Initialize
  const initialized = await initialize(context);
  if (!initialized) {
    outputChannel.appendLine("Extension initialization failed");
    return;
  }

  outputChannel.appendLine("COFT SmartTime extension activated successfully");
}

export function deactivate() {
  shutdown();
  outputChannel.appendLine("COFT SmartTime extension deactivated");
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
  storage = null;
  git = null;
  isEnabled = false;
}

async function initialize(context: vscode.ExtensionContext): Promise<boolean> {
  try {
    // Get configuration
    const configManager = new ConfigManager(outputChannel);
    const config = configManager.getConfig();

    outputChannel.appendLine(`COFT_ROOT: ${config.root}`);
    outputChannel.appendLine(
      `COFT_INTERVAL_SECONDS: ${config.intervalSeconds}`,
    );
    outputChannel.appendLine(
      `COFT_VIEW_GROUP_BY_MINUTES: ${config.viewGroupByMinutes}`,
    );

    // Initialize storage
    storage = new StorageManager(config, outputChannel);
    const storageInitialized = await storage.initialize();
    if (!storageInitialized) {
      return false;
    }

    // Initialize git
    const extensionVersion = context.extension.packageJSON.version || "0.0.1";
    git = new GitManager(config, outputChannel, extensionVersion);
    await git.initialize();

    // Start batch processor
    batchProcessor = new BatchProcessor(config, storage, outputChannel);
    batchProcessor.start();

    // Start operation queue processor
    operationQueueProcessor = new OperationQueueProcessor(
      config,
      git,
      storage,
      outputChannel,
    );
    operationQueueProcessor.start();

    // Create time report provider
    timeReportProvider = new TimeReportProvider(config, outputChannel);

    isEnabled = true;
    return true;
  } catch (error) {
    outputChannel.appendLine(`Initialization error: ${error}`);
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
    outputChannel.appendLine(`Error handling file save: ${error}`);
    vscode.window.showErrorMessage(
      `COFT SmartTime: Failed to save time entry: ${error}`,
    );
  }
}
