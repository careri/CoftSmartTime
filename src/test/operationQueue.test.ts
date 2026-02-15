import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  OperationQueueWriter,
  OperationQueueProcessor,
  OperationRequest,
  WriteTimeReportRequest,
  UpdateProjectsRequest,
} from "../operationQueue";
import { GitManager } from "../git";
import { StorageManager } from "../storage";
import { CoftConfig } from "../config";

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
  };
}

suite("OperationQueue Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-operationqueue-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    outputChannel = vscode.window.createOutputChannel("OperationQueue Test");
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("OperationQueueWriter should create request file in operation_queue", async () => {
    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15" },
    };

    await OperationQueueWriter.write(testConfig, request, outputChannel);

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].endsWith(".json"));

    const content = await fs.readFile(
      path.join(testConfig.operationQueue, files[0]),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.type, "timereport");
    assert.strictEqual(parsed.file, "reports/2026/02/15.json");
    assert.ok(parsed.body);
  });

  test("OperationQueueWriter should create queue directory if missing", async () => {
    const request: UpdateProjectsRequest = {
      type: "projects",
      file: "projects.json",
      body: { feature: { "/project": "Alpha" } },
    };

    // operationQueue dir does not exist yet
    await OperationQueueWriter.write(testConfig, request, outputChannel);

    const stat = await fs.stat(testConfig.operationQueue);
    assert.ok(stat.isDirectory());
  });

  test("OperationQueueWriter should write multiple requests as separate files", async () => {
    await fs.mkdir(testConfig.operationQueue, { recursive: true });

    await OperationQueueWriter.write(
      testConfig,
      {
        type: "timereport",
        file: "reports/2026/02/15.json",
        body: { date: "2026-02-15" },
      },
      outputChannel,
    );
    await OperationQueueWriter.write(
      testConfig,
      { type: "projects", file: "projects.json", body: { a: {} } },
      outputChannel,
    );

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 2);
  });

  test("OperationQueueWriter should write ProcessBatchRequest", async () => {
    await OperationQueueWriter.write(
      testConfig,
      { type: "processBatch" },
      outputChannel,
    );

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);

    const content = await fs.readFile(
      path.join(testConfig.operationQueue, files[0]),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.type, "processBatch");
  });

  test("OperationQueueProcessor should write file and commit for timereport", async () => {
    // Initialize git repo
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    // Write a timereport request
    const reportData = { date: "2026-02-15", entries: [] };
    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: reportData,
    };
    await OperationQueueWriter.write(testConfig, request, outputChannel);

    // Process the queue
    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      outputChannel,
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
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    await OperationQueueWriter.write(
      testConfig,
      {
        type: "timereport",
        file: "reports/2026/02/15.json",
        body: { first: true },
      },
      outputChannel,
    );
    await OperationQueueWriter.write(
      testConfig,
      {
        type: "projects",
        file: "projects.json",
        body: { second: true },
      },
      outputChannel,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      outputChannel,
    );
    await processor.processQueue();

    // Both files should exist
    const file1 = await fs.readFile(
      path.join(testConfig.data, "reports", "2026", "02", "15.json"),
      "utf-8",
    );
    assert.deepStrictEqual(JSON.parse(file1), { first: true });

    const file2 = await fs.readFile(
      path.join(testConfig.data, "projects.json"),
      "utf-8",
    );
    assert.deepStrictEqual(JSON.parse(file2), { second: true });

    // Queue should be empty
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("OperationQueueProcessor should skip when queue dir does not exist", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      outputChannel,
    );
    // Should not throw
    await processor.processQueue();
  });

  test("OperationQueueProcessor should skip when queue is empty", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    await fs.mkdir(testConfig.operationQueue, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      outputChannel,
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
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
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
      outputChannel,
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

  test("OperationQueueProcessor request filename uses hash pattern", async () => {
    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15" },
    };

    await OperationQueueWriter.write(testConfig, request, outputChannel);

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);

    const filenamePattern = /^\d+_[a-f0-9]{12}\.json$/;
    assert.ok(
      filenamePattern.test(files[0]),
      `Filename ${files[0]} should match hash pattern`,
    );
  });

  test("OperationQueueProcessor creates target subdirectories", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15", entries: [] },
    };
    await OperationQueueWriter.write(testConfig, request, outputChannel);

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      outputChannel,
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
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    // Write some queue entries that the batch processor would normally create
    await storage.writeQueueEntry("/workspace/project1", "src/app.ts", "main");
    await storage.writeQueueEntry("/workspace/project1", "src/util.ts", "main");

    // Write a ProcessBatchRequest
    await OperationQueueWriter.write(
      testConfig,
      { type: "processBatch" },
      outputChannel,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      outputChannel,
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
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    // Write a ProcessBatchRequest with no queue files
    await OperationQueueWriter.write(
      testConfig,
      { type: "processBatch" },
      outputChannel,
    );

    const processor = new OperationQueueProcessor(
      testConfig,
      git,
      storage,
      outputChannel,
    );
    await processor.processQueue();

    // Operation queue should be empty (request processed even though no batch files)
    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });
});
