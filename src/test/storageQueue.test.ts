import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import {
  StorageQueueWriter,
  StorageQueueProcessor,
  StorageRequest,
} from "../storageQueue";
import { GitManager } from "../git";
import { CoftConfig } from "../config";

function createTestConfig(testRoot: string): CoftConfig {
  return {
    root: testRoot,
    queue: path.join(testRoot, "queue"),
    queueBatch: path.join(testRoot, "queue_batch"),
    queueBackup: path.join(testRoot, "queue_backup"),
    storageQueue: path.join(testRoot, "storage_queue"),
    storageQueueBackup: path.join(testRoot, "storage_queue_backup"),
    data: path.join(testRoot, "data"),
    backup: path.join(testRoot, "backup"),
    intervalSeconds: 60,
    viewGroupByMinutes: 15,
    branchTaskUrl: "",
  };
}

suite("StorageQueue Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-storagequeue-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    outputChannel = vscode.window.createOutputChannel("StorageQueue Test");
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("StorageQueueWriter should create request file in storage_queue", async () => {
    const request: StorageRequest = {
      type: "timebatch",
      file: "batches/batch_123.json",
      body: { main: { "/project": [{ File: "a.ts", Timestamp: 1000 }] } },
    };

    await StorageQueueWriter.write(testConfig, request, outputChannel);

    const files = await fs.readdir(testConfig.storageQueue);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].endsWith(".json"));

    const content = await fs.readFile(
      path.join(testConfig.storageQueue, files[0]),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.type, "timebatch");
    assert.strictEqual(parsed.file, "batches/batch_123.json");
    assert.ok(parsed.body);
  });

  test("StorageQueueWriter should create queue directory if missing", async () => {
    const request: StorageRequest = {
      type: "projects",
      file: "projects.json",
      body: { feature: { "/project": "Alpha" } },
    };

    // storageQueue dir does not exist yet
    await StorageQueueWriter.write(testConfig, request, outputChannel);

    const stat = await fs.stat(testConfig.storageQueue);
    assert.ok(stat.isDirectory());
  });

  test("StorageQueueWriter should write multiple requests as separate files", async () => {
    await fs.mkdir(testConfig.storageQueue, { recursive: true });

    await StorageQueueWriter.write(
      testConfig,
      {
        type: "timereport",
        file: "reports/2026/02/15.json",
        body: { date: "2026-02-15" },
      },
      outputChannel,
    );
    await StorageQueueWriter.write(
      testConfig,
      { type: "projects", file: "projects.json", body: { a: {} } },
      outputChannel,
    );

    const files = await fs.readdir(testConfig.storageQueue);
    assert.strictEqual(files.length, 2);
  });

  test("StorageQueueProcessor should write file and commit", async () => {
    // Initialize git repo
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();

    // Write a request
    const batchData = {
      main: { "/project": [{ File: "a.ts", Timestamp: 1000 }] },
    };
    const request: StorageRequest = {
      type: "timebatch",
      file: "batches/batch_test.json",
      body: batchData,
    };
    await StorageQueueWriter.write(testConfig, request, outputChannel);

    // Process the queue
    const processor = new StorageQueueProcessor(testConfig, git, outputChannel);
    await processor.processQueue();

    // Verify file was written to data dir
    const targetPath = path.join(testConfig.data, "batches", "batch_test.json");
    const content = await fs.readFile(targetPath, "utf-8");
    const parsed = JSON.parse(content);
    assert.deepStrictEqual(parsed, batchData);

    // Verify request file was deleted
    const remaining = await fs.readdir(testConfig.storageQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("StorageQueueProcessor should process multiple requests in order", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();

    await StorageQueueWriter.write(
      testConfig,
      {
        type: "timebatch",
        file: "batches/batch_1.json",
        body: { first: true },
      },
      outputChannel,
    );
    await StorageQueueWriter.write(
      testConfig,
      {
        type: "timebatch",
        file: "batches/batch_2.json",
        body: { second: true },
      },
      outputChannel,
    );

    const processor = new StorageQueueProcessor(testConfig, git, outputChannel);
    await processor.processQueue();

    // Both files should exist
    const file1 = await fs.readFile(
      path.join(testConfig.data, "batches", "batch_1.json"),
      "utf-8",
    );
    assert.deepStrictEqual(JSON.parse(file1), { first: true });

    const file2 = await fs.readFile(
      path.join(testConfig.data, "batches", "batch_2.json"),
      "utf-8",
    );
    assert.deepStrictEqual(JSON.parse(file2), { second: true });

    // Queue should be empty
    const remaining = await fs.readdir(testConfig.storageQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("StorageQueueProcessor should skip when queue dir does not exist", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();

    const processor = new StorageQueueProcessor(testConfig, git, outputChannel);
    // Should not throw
    await processor.processQueue();
  });

  test("StorageQueueProcessor should skip when queue is empty", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    await fs.mkdir(testConfig.storageQueue, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();

    const processor = new StorageQueueProcessor(testConfig, git, outputChannel);
    await processor.processQueue();

    // No files should be created in data
    const dataFiles = await fs.readdir(testConfig.data);
    // Only .git and .gitignore should be present
    assert.ok(dataFiles.includes(".git"));
  });

  test("StorageQueueProcessor should move request to backup after max failures", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    await fs.mkdir(testConfig.storageQueue, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();

    // Write a request file with invalid JSON so parsing always fails
    const requestFile = "001_test.json";
    await fs.writeFile(
      path.join(testConfig.storageQueue, requestFile),
      "NOT VALID JSON",
      "utf-8",
    );

    const processor = new StorageQueueProcessor(testConfig, git, outputChannel);

    // Process 5 times to hit max failures
    for (let i = 0; i < 5; i++) {
      await processor.processQueue();
    }

    // Request should be moved to backup
    const backupFiles = await fs.readdir(testConfig.storageQueueBackup);
    assert.strictEqual(backupFiles.length, 1);
    assert.strictEqual(backupFiles[0], requestFile);

    // Queue should be empty
    const queueFiles = await fs.readdir(testConfig.storageQueue);
    assert.strictEqual(queueFiles.length, 0);
  });

  test("StorageQueueProcessor request filename uses hash pattern", async () => {
    const request: StorageRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15" },
    };

    await StorageQueueWriter.write(testConfig, request, outputChannel);

    const files = await fs.readdir(testConfig.storageQueue);
    assert.strictEqual(files.length, 1);

    const filenamePattern = /^\d+_[a-f0-9]{12}\.json$/;
    assert.ok(
      filenamePattern.test(files[0]),
      `Filename ${files[0]} should match hash pattern`,
    );
  });

  test("StorageQueueProcessor creates target subdirectories", async () => {
    await fs.mkdir(testConfig.data, { recursive: true });
    await fs.mkdir(testConfig.backup, { recursive: true });
    const git = new GitManager(testConfig, outputChannel, "0.0.1");
    await git.initialize();

    const request: StorageRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15", entries: [] },
    };
    await StorageQueueWriter.write(testConfig, request, outputChannel);

    const processor = new StorageQueueProcessor(testConfig, git, outputChannel);
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
});
