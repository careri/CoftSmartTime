import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { GitScanService } from "../services/gitScanService";
import { Logger } from "../utils/logger";

/** Satisfied by StorageManager. */
export interface QueueEntryWriter {
  writeQueueEntry(
    workspaceRoot: string,
    relativePath: string,
    gitBranch?: string,
  ): Promise<void>;
}

/** Satisfied by GitManager. */
export interface BranchResolver {
  getBranch(
    workspaceFolder: vscode.WorkspaceFolder,
  ): Promise<string | undefined>;
}

export type FolderProvider = () => readonly vscode.WorkspaceFolder[];

/**
 * Timer that queues activity for file changes that never raised a save event —
 * writes made by AI agents or CLI tools straight to disk.
 *
 * Holds the last scan timestamp per workspace folder in memory. A folder is
 * baselined on first sight so activation does not backfill everything dirty.
 */
export class GitChangeWatcher {
  private config: CoftConfig;
  private storage: QueueEntryWriter;
  private git: BranchResolver;
  private scanService: GitScanService;
  private logger: Logger;
  private folderProvider: FolderProvider;
  private timer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private lastScan: Map<string, number> = new Map();

  constructor(
    config: CoftConfig,
    storage: QueueEntryWriter,
    git: BranchResolver,
    scanService: GitScanService,
    logger: Logger,
    folderProvider: FolderProvider = () =>
      vscode.workspace.workspaceFolders ?? [],
  ) {
    this.config = config;
    this.storage = storage;
    this.git = git;
    this.scanService = scanService;
    this.logger = logger;
    this.folderProvider = folderProvider;
  }

  start(): void {
    if (this.config.gitScanSeconds <= 0) {
      this.logger.info("Git change watcher disabled (gitScanSeconds = 0)");
      return;
    }

    this.logger.info(
      `Starting git change watcher with interval: ${this.config.gitScanSeconds}s`,
    );

    this.timer = setInterval(
      () => this.scanOnce(),
      this.config.gitScanSeconds * 1000,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("Git change watcher stopped");
    }
  }

  /** Runs one scan across all workspace folders. Returns queue entries written. */
  async scanOnce(now: number = Date.now()): Promise<number> {
    if (this.isScanning) {
      this.logger.debug("Git scan still running, skipping this tick");
      return 0;
    }

    this.isScanning = true;
    try {
      let written = 0;
      for (const folder of this.folderProvider()) {
        written += await this.scanFolder(folder, now);
      }
      return written;
    } catch (error) {
      this.logger.error(`Error in git change scan: ${error}`);
      return 0;
    } finally {
      this.isScanning = false;
    }
  }

  private async scanFolder(
    folder: vscode.WorkspaceFolder,
    now: number,
  ): Promise<number> {
    const workspaceRoot = folder.uri.fsPath;
    const since = this.lastScan.get(workspaceRoot);

    if (since === undefined) {
      this.lastScan.set(workspaceRoot, now);
      this.logger.debug(`Git scan baseline set for ${workspaceRoot}`);
      return 0;
    }

    try {
      const files = await this.scanService.findModifiedSince(
        workspaceRoot,
        since,
        now,
      );

      let written = 0;
      if (files.length > 0) {
        const branch = await this.git.getBranch(folder);
        for (const file of files) {
          const relativePath = path.relative(workspaceRoot, file);
          if (
            !relativePath ||
            relativePath.startsWith("..") ||
            path.isAbsolute(relativePath)
          ) {
            // Repo root sits above the workspace folder — outside our scope.
            continue;
          }
          await this.storage.writeQueueEntry(
            workspaceRoot,
            relativePath,
            branch,
          );
          written++;
        }
        this.logger.debug(
          `Git scan queued ${written} entry/entries for ${workspaceRoot}`,
        );
      }

      // Only advance on success, so a failed scan retries the same window.
      this.lastScan.set(workspaceRoot, now);
      return written;
    } catch (error) {
      this.logger.error(`Error scanning ${workspaceRoot}: ${error}`);
      return 0;
    }
  }
}
