import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { QueueRepository } from "./queueRepository";
import { CoftConfig } from "../application/config";
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
    startOfWeek: "monday",
  };
}

suite("QueueRepository Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let logger: Logger;
  let repository: QueueRepository;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-queue-repo-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    await fs.mkdir(testConfig.queue, { recursive: true });
    await fs.mkdir(testConfig.queueBatch, { recursive: true });
    await fs.mkdir(testConfig.queueBackup, { recursive: true });
    const outputChannel = vscode.window.createOutputChannel(
      "QueueRepository Test",
    );
    logger = new Logger(outputChannel, false);
    repository = new QueueRepository(testConfig, logger);
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("addEntry creates a JSON file in the queue directory", async () => {
    await repository.addEntry("/workspace/project", "src/app.ts", "main");
    const files = await fs.readdir(testConfig.queue);
    assert.strictEqual(files.length, 1);
    assert.ok(files[0].endsWith(".json"));
  });

  test("addEntry file contains correct entry data", async () => {
    await repository.addEntry("/workspace/project", "src/index.ts", "feature");
    const files = await fs.readdir(testConfig.queue);
    const content = await fs.readFile(
      path.join(testConfig.queue, files[0]),
      "utf-8",
    );
    const entry = JSON.parse(content);
    assert.strictEqual(entry.directory, "/workspace/project");
    assert.strictEqual(entry.filename, "src/index.ts");
    assert.strictEqual(entry.gitBranch, "feature");
    assert.strictEqual(typeof entry.timestamp, "number");
  });

  test("addEntry with no branch stores null for gitBranch", async () => {
    await repository.addEntry("/workspace/project", "src/index.ts");
    const files = await fs.readdir(testConfig.queue);
    const content = await fs.readFile(
      path.join(testConfig.queue, files[0]),
      "utf-8",
    );
    const entry = JSON.parse(content);
    assert.strictEqual(entry.gitBranch, null);
  });

  test("hasQueueFiles returns false when queue is empty", async () => {
    const result = await repository.hasQueueFiles();
    assert.strictEqual(result, false);
  });

  test("hasQueueFiles returns true after addEntry", async () => {
    await repository.addEntry("/workspace/project", "src/app.ts", "main");
    const result = await repository.hasQueueFiles();
    assert.strictEqual(result, true);
  });

  test("moveToBatch moves all files from queue to queueBatch", async () => {
    await repository.addEntry("/workspace/project", "a.ts", "main");
    await repository.addEntry("/workspace/project", "b.ts", "main");
    const moved = await repository.moveToBatch();
    assert.strictEqual(moved.length, 2);

    const queueFiles = await fs.readdir(testConfig.queue);
    assert.strictEqual(
      queueFiles.length,
      0,
      "queue should be empty after move",
    );

    const batchFiles = await fs.readdir(testConfig.queueBatch);
    assert.strictEqual(batchFiles.length, 2, "batch should have 2 files");
  });

  test("moveToBatch returns empty array when queue is empty", async () => {
    const moved = await repository.moveToBatch();
    assert.deepStrictEqual(moved, []);
  });

  test("moveToQueue moves files from queueBatch back to queue", async () => {
    await repository.addEntry("/workspace/project", "a.ts", "main");
    await repository.moveToBatch();
    await repository.moveToQueue();

    const queueFiles = await fs.readdir(testConfig.queue);
    assert.strictEqual(queueFiles.length, 1);

    const batchFiles = await fs.readdir(testConfig.queueBatch);
    assert.strictEqual(batchFiles.length, 0);
  });

  test("hasQueueFiles returns false when queue directory does not exist", async () => {
    // Don't create the queue dir at all
    const freshRoot = path.join(os.tmpdir(), `coft-fresh-${Date.now()}`);
    const freshConfig = createTestConfig(freshRoot);
    const repo = new QueueRepository(freshConfig, logger);
    const result = await repo.hasQueueFiles();
    assert.strictEqual(result, false);
  });
});
