import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { OperationQueueWriter } from "./operationQueueWriter";
import { OperationQueueProcessor } from "./operationQueueProcessor";
import { WriteTimeReportRequest } from "../types/operation";
import { GitManager } from "../storage/git";
import { StorageManager } from "../storage/storage";
import { CoftConfig } from "./config";
import { Logger } from "../utils/logger";

function createTestConfig(testRoot: string): CoftConfig {
  return {
    root: testRoot,
    queue: path.join(testRoot, "queue"),
    queueBatch: path.join(testRoot, "queue_batch"),
    queueBackup: path.join(testRoot, "queue_backup"),
    operationQueue: path.join(testRoot, "operation_queue"),
    operationQueueBackup: path.join(testRoot, "operation_queue_backup"),
    data: path.join(testRoot, "data"),
    backup: path.join(testRoot, "backup"),
    intervalSeconds: 60,
    viewGroupByMinutes: 15,
    branchTaskUrl: "",
    exportDir: "",
    exportAgeDays: 90,
    startOfWeek: "auto",
  };
}

suite("OperationQueueProcessor Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;

  setup(async () => {
    testRoot = path.join(
      os.tmpdir(),
      `coft-operationqueue-processor-test-${Date.now()}`,
    );
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    outputChannel = vscode.window.createOutputChannel(
      "OperationQueueProcessor Test",
    );
    logger = new Logger(outputChannel, true);

    // Pre-set housekeeping date so processing doesn't auto-queue housekeeping
    await fs.mkdir(testConfig.data, { recursive: true });
    const today = new Date().toISOString().split("T")[0];
    await fs.writeFile(
      path.join(testConfig.data, ".last-housekeeping"),
      today,
      "utf-8",
    );
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("OperationQueueProcessor should write file and commit for timereport", async () => {
    // Initialize git repo
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    // Write a timereport request
    const reportData = { date: "2026-02-15", entries: [] };
    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: reportData,
    };
    await OperationQueueWriter.write(
      storage.operationRepository,
      request,
      logger,
    );

    // Process the queue
    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    // Verify file was written to data dir
    const targetPath = path.join(
      testConfig.data,
      "reports",
      "2026",
      "02",
      "15.json",
    );
    const content = await fs.readFile(targetPath, "utf-8");
    const parsed = JSON.parse(content);
    assert.deepStrictEqual(parsed, reportData);

    // Verify request file was deleted
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("OperationQueueProcessor should process multiple requests in order", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    await OperationQueueWriter.write(
      storage.operationRepository,
      {
        type: "timereport",
        file: "reports/2026/02/15.json",
        body: { date: "2026-02-15", entries: [] },
      },
      logger,
    );
    await OperationQueueWriter.write(
      storage.operationRepository,
      {
        type: "projects",
        file: "projects.json",
        body: { branch1: { dir1: "proj1" } },
      },
      logger,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    // Both files should exist
    const file1 = await fs.readFile(
      path.join(testConfig.data, "reports", "2026", "02", "15.json"),
      "utf-8",
    );
    assert.deepStrictEqual(JSON.parse(file1), {
      date: "2026-02-15",
      entries: [],
    });

    const file2 = await fs.readFile(
      path.join(testConfig.data, "projects.json"),
      "utf-8",
    );
    assert.deepStrictEqual(JSON.parse(file2), { branch1: { dir1: "proj1" } });

    // Queue should be empty
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("OperationQueueProcessor should skip when queue dir does not exist", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    // Should not throw
    await processor.processQueue();
  });

  test("OperationQueueProcessor should skip when queue is empty", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    await fs.mkdir(testConfig.operationQueue, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    // No files should be created in data
    const dataFiles = await fs.readdir(testConfig.data);
    // Only .git and .gitignore should be present
    assert.ok(dataFiles.includes(".git"));
  });

  test("OperationQueueProcessor should move request to backup after max failures", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    await fs.mkdir(testConfig.operationQueue, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    // Write a request file with invalid JSON so parsing always fails
    const requestFile = "001_test.json";
    await fs.writeFile(
      path.join(testConfig.operationQueue, requestFile),
      "NOT VALID JSON",
      "utf-8",
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );

    // Process 5 times to hit max failures
    for (let i = 0; i < 5; i++) {
      await processor.processQueue();
    }

    // Request should be moved to backup
    const backupFiles = await fs.readdir(testConfig.operationQueueBackup);
    assert.strictEqual(backupFiles.length, 1);
    assert.strictEqual(backupFiles[0], requestFile);

    // Queue should be empty
    const queueFiles = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(queueFiles.length, 0);
  });

  test("OperationQueueProcessor request filename uses timestamp pattern", async () => {
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15", entries: [] },
    };

    await OperationQueueWriter.write(
      storage.operationRepository,
      request,
      logger,
    );

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);

    const filenamePattern = /^\d+_[a-z0-9]+\.json$/;
    assert.ok(
      filenamePattern.test(files[0]),
      `Filename ${files[0]} should match timestamp pattern`,
    );
  });

  test("OperationQueueProcessor creates target subdirectories", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15", entries: [] },
    };
    await OperationQueueWriter.write(
      storage.operationRepository,
      request,
      logger,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    const targetPath = path.join(
      testConfig.data,
      "reports",
      "2026",
      "02",
      "15.json",
    );
    const content = await fs.readFile(targetPath, "utf-8");
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.date, "2026-02-15");
  });

  test("OperationQueueProcessor should process ProcessBatchRequest", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    // Write some queue entries that the batch processor would normally create
    await storage.writeQueueEntry("/workspace/project1", "src/app.ts", "main");
    await storage.writeQueueEntry("/workspace/project1", "src/util.ts", "main");

    // Write a ProcessBatchRequest
    await OperationQueueWriter.write(
      storage.operationRepository,
      { type: "processBatch" },
      logger,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    // Queue files should have been moved and processed
    const queueFiles = await fs.readdir(testConfig.queue);
    assert.strictEqual(queueFiles.length, 0);

    // Batch dir should be cleaned up
    const batchFiles = await fs.readdir(testConfig.queueBatch);
    assert.strictEqual(batchFiles.length, 0);

    // A batch file should exist in data/batches
    const batchDir = path.join(testConfig.data, "batches");
    const batches = await fs.readdir(batchDir);
    assert.strictEqual(batches.length, 1);
    assert.ok(batches[0].startsWith("batch_"));

    // Verify batch content
    const batchContent = await fs.readFile(
      path.join(batchDir, batches[0]),
      "utf-8",
    );
    const parsed = JSON.parse(batchContent);
    assert.ok(parsed["main"]);
    assert.ok(parsed["main"]["/workspace/project1"]);
    assert.strictEqual(parsed["main"]["/workspace/project1"].length, 2);

    // Operation queue should be empty
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("OperationQueueProcessor should handle ProcessBatchRequest with empty queue", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    // Write a ProcessBatchRequest with no queue files
    await OperationQueueWriter.write(
      storage.operationRepository,
      { type: "processBatch" },
      logger,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    // Operation queue should be empty (request processed even though no batch files)
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("OperationQueueProcessor should process HousekeepingRequest", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    // Remove .last-housekeeping so housekeeping actually runs
    const housekeepingPath = path.join(testConfig.data, ".last-housekeeping");
    try {
      await fs.unlink(housekeepingPath);
    } catch {
      // May not exist
    }

    // Create a file and commit so push has something
    const testFile = path.join(testConfig.data, "test.txt");
    await fs.writeFile(testFile, "housekeeping via queue", "utf-8");
    await git.commit("pre-housekeeping commit");

    // Write a HousekeepingRequest
    await OperationQueueWriter.write(
      storage.operationRepository,
      { type: "housekeeping" },
      logger,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    // Operation queue should be empty
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);

    // Housekeeping should have written .last-housekeeping
    const hkPath = path.join(testConfig.data, ".last-housekeeping");
    const lastDate = (await fs.readFile(hkPath, "utf-8")).trim();
    const today = new Date().toISOString().split("T")[0];
    assert.strictEqual(lastDate, today);
  });

  test("OperationQueueProcessor should skip housekeeping if already done today", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    // .last-housekeeping is already set to today by setup

    // Write a HousekeepingRequest
    await OperationQueueWriter.write(
      storage.operationRepository,
      { type: "housekeeping" },
      logger,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      logger,
    );
    await processor.processQueue();

    // Request should still be consumed
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });
});
