import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
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
    exportDir: "",
    exportAgeDays: 90,
  };
}

suite("Storage Test Suite", () => {
  vscode.window.showInformationMessage("Start storage tests.");

  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });

    testConfig = createTestConfig(testRoot);

    outputChannel = vscode.window.createOutputChannel("Test");
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("StorageManager should initialize directories", async () => {
    const storage = new StorageManager(testConfig, outputChannel);
    const result = await storage.initialize();

    assert.strictEqual(result, true);

    // Check directories exist
    const queueStat = await fs.stat(testConfig.queue);
    assert.ok(queueStat.isDirectory());

    const batchStat = await fs.stat(testConfig.queueBatch);
    assert.ok(batchStat.isDirectory());

    const backupStat = await fs.stat(testConfig.queueBackup);
    assert.ok(backupStat.isDirectory());

    const dataStat = await fs.stat(testConfig.data);
    assert.ok(dataStat.isDirectory());
  });

  test("StorageManager should auto-create root directory if it does not exist", async () => {
    const nonExistentRoot = path.join(
      os.tmpdir(),
      `coft-autocreate-${Date.now()}`,
    );
    const autoConfig: CoftConfig = {
      root: nonExistentRoot,
      queue: path.join(nonExistentRoot, "queue"),
      queueBatch: path.join(nonExistentRoot, "queue_batch"),
      queueBackup: path.join(nonExistentRoot, "queue_backup"),
      operationQueue: path.join(nonExistentRoot, "operation_queue"),
      operationQueueBackup: path.join(
        nonExistentRoot,
        "operation_queue_backup",
      ),
      data: path.join(nonExistentRoot, "data"),
      backup: path.join(nonExistentRoot, "backup"),
      intervalSeconds: 60,
      viewGroupByMinutes: 15,
      branchTaskUrl: "",
      exportDir: "",
      exportAgeDays: 90,
    };

    const storage = new StorageManager(autoConfig, outputChannel);
    const result = await storage.initialize();

    assert.strictEqual(result, true);

    const rootStat = await fs.stat(nonExistentRoot);
    assert.ok(rootStat.isDirectory());

    await fs.rm(nonExistentRoot, { recursive: true, force: true });
  });

  test("StorageManager should write queue entry", async () => {
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    await storage.writeQueueEntry("/test/workspace", "test.txt", "main");

    const files = await fs.readdir(testConfig.queue);
    assert.strictEqual(files.length, 1);

    const content = await fs.readFile(
      path.join(testConfig.queue, files[0]),
      "utf-8",
    );
    const entry = JSON.parse(content);

    assert.strictEqual(entry.directory, "/test/workspace");
    assert.strictEqual(entry.filename, "test.txt");
    assert.strictEqual(entry.gitBranch, "main");
    assert.ok(entry.timestamp);
  });

  test("StorageManager should move queue to batch", async () => {
    const storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    await storage.writeQueueEntry("/test/workspace", "test1.txt", "main");
    await storage.writeQueueEntry("/test/workspace", "test2.txt", "main");

    const movedFiles = await storage.moveQueueToBatch();
    assert.strictEqual(movedFiles.length, 2);

    const queueFiles = await fs.readdir(testConfig.queue);
    assert.strictEqual(queueFiles.length, 0);

    const batchFiles = await fs.readdir(testConfig.queueBatch);
    assert.strictEqual(batchFiles.length, 2);
  });

  test("writeQueueEntry should ensure queue directory exists", async () => {
    const isolatedRoot = path.join(
      os.tmpdir(),
      `coft-ensure-dir-test-${Date.now()}`,
    );
    const isolatedConfig = createTestConfig(isolatedRoot);
    const storage = new StorageManager(isolatedConfig, outputChannel);
    // Do not call initialize - directory won't exist yet

    await storage.writeQueueEntry("/test/workspace", "test.txt", "main");

    const files = await fs.readdir(isolatedConfig.queue);
    assert.strictEqual(files.length, 1);

    await fs.rm(isolatedRoot, { recursive: true, force: true });
  });
});
