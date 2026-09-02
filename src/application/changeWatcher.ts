import * as path from "path";
import * as vscode from "vscode";
import { CoftConfig } from "./config";
import { ChangeScanner } from "../services/changeScanner";
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
 * Each tick picks a scanner per workspace folder: git repositories are scanned
 * with `git status` (cheap and `.gitignore`-aware), everything else falls back
 * to a directory walk. The check runs every tick, so a folder that becomes a
 * repository later is picked up without a restart.
 *
 * Holds the last scan timestamp per workspace folder in memory. A folder is
 * baselined on first sight so activation does not backfill everything dirty.
 */
export class ChangeWatcher {
  private config: CoftConfig;
  private storage: QueueEntryWriter;
  private git: BranchResolver;
  private gitScanService: GitScanService;
  private folderScanService: ChangeScanner;
  private logger: Logger;
  private folderProvider: FolderProvider;
  private timer: NodeJS.Timeout | null = null;
  private isScanning = false;
  private lastScan: Map<string, number> = new Map();

  constructor(
    config: CoftConfig,
    storage: QueueEntryWriter,
    git: BranchResolver,
    gitScanService: GitScanService,
    folderScanService: ChangeScanner,
    logger: Logger,
    folderProvider: FolderProvider = () =>
      vscode.workspace.workspaceFolders ?? [],
  ) {
    this.config = config;
    this.storage = storage;
    this.git = git;
    this.gitScanService = gitScanService;
    this.folderScanService = folderScanService;
    this.logger = logger;
    this.folderProvider = folderProvider;
  }

  start(): void {
    if (this.config.changeScanSeconds <= 0) {
      this.logger.info("Change watcher disabled (changeScanSeconds = 0)");
      return;
    }

    this.logger.info(
      `Starting change watcher with interval: ${this.config.changeScanSeconds}s`,
    );

    this.timer = setInterval(
      () => this.scanOnce(),
      this.config.changeScanSeconds * 1000,
    );
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger.info("Change watcher stopped");
    }
  }

  /** Runs one scan across all workspace folders. Returns queue entries written. */
  async scanOnce(now: number = Date.now()): Promise<number> {
    if (this.isScanning) {
      this.logger.debug("Scan still running, skipping this tick");
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
      this.logger.error(`Error in change scan: ${error}`);
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
      this.logger.debug(`Scan baseline set for ${workspaceRoot}`);
      return 0;
    }

    try {
      const useGit = await this.gitScanService.canScan(workspaceRoot);
      const scanner: ChangeScanner = useGit
        ? this.gitScanService
        : this.folderScanService;
      const files = await scanner.findModifiedSince(workspaceRoot, since, now);

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
        // INFO, so a running scan is verifiable without debug logs. Silent
        // when nothing changed, so at most one line per folder per tick.
        if (written > 0) {
          this.logger.info(
            `Change scan queued ${written} entry/entries for ${workspaceRoot} (${useGit ? "git" : "folder"} scan)`,
          );
        }
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
