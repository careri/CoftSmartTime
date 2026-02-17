import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { BatchRepository } from "../batchRepository";
import { CoftConfig } from "../config";
import { QueueEntry, BatchEntry } from "../storage";

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

suite("BatchRepository Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
  let repository: BatchRepository;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-batch-repo-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });

    testConfig = createTestConfig(testRoot);
    outputChannel = vscode.window.createOutputChannel("BatchRepository Test");
    repository = new BatchRepository(testConfig, outputChannel);

    // Create necessary directories
    await fs.mkdir(testConfig.queueBatch, { recursive: true });
    await fs.mkdir(path.join(testConfig.data, "batches"), { recursive: true });
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("readBatchFiles should read all batch files", async () => {
    // Create test batch files
    const entry1: QueueEntry = {
      directory: "/workspace/project1",
      filename: "src/app.ts",
      gitBranch: "main",
      timestamp: Date.now(),
    };
    const entry2: QueueEntry = {
      directory: "/workspace/project1",
      filename: "src/util.ts",
      gitBranch: "main",
      timestamp: Date.now(),
    };

    await fs.writeFile(
      path.join(testConfig.queueBatch, "batch1.json"),
      JSON.stringify(entry1, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(testConfig.queueBatch, "batch2.json"),
      JSON.stringify(entry2, null, 2),
      "utf-8",
    );

    const entries = await repository.readBatchFiles();

    assert.strictEqual(entries.length, 2);
    assert.ok(entries.some((e) => e.filename === "src/app.ts"));
    assert.ok(entries.some((e) => e.filename === "src/util.ts"));
  });

  test("readBatchFiles should return empty array when no files exist", async () => {
    const entries = await repository.readBatchFiles();
    assert.strictEqual(entries.length, 0);
  });

  test("collectBatches should collect old batch files into date hierarchy", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    // Create batch files for yesterday
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(12, 0, 0, 0);
    const yesterdayTimestamp = yesterday.getTime();

    const batch1: BatchEntry = {
      main: {
        "/workspace/project1": [
          { File: "src/app.ts", Timestamp: yesterdayTimestamp },
        ],
      },
    };

    await fs.writeFile(
      path.join(batchesDir, `batch_${yesterdayTimestamp}_abc123.json`),
      JSON.stringify(batch1, null, 2),
      "utf-8",
    );

    const result = await repository.collectBatches();

    assert.strictEqual(result.collected, true);
    assert.strictEqual(result.filesProcessed, 1);

    // Verify hierarchical file was created
    const year = String(yesterday.getUTCFullYear());
    const month = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getUTCDate()).padStart(2, "0");
    const hierarchicalPath = path.join(batchesDir, year, month, `${day}.json`);

    const content = await fs.readFile(hierarchicalPath, "utf-8");
    const collected: BatchEntry = JSON.parse(content);

    assert.ok(collected.main);
    assert.ok(collected.main["/workspace/project1"]);
    assert.strictEqual(collected.main["/workspace/project1"].length, 1);
  });

  test("collectBatches should not collect today's batch files", async () => {
    const batchesDir = path.join(testConfig.data, "batches");
    const todayTimestamp = Date.now();

    const batch: BatchEntry = {
      main: {
        "/workspace/project1": [
          { File: "src/app.ts", Timestamp: todayTimestamp },
        ],
      },
    };

    await fs.writeFile(
      path.join(batchesDir, `batch_${todayTimestamp}_abc123.json`),
      JSON.stringify(batch, null, 2),
      "utf-8",
    );

    const result = await repository.collectBatches();

    assert.strictEqual(result.collected, false);
    assert.strictEqual(result.filesProcessed, 0);

    // Verify today's file still exists
    const files = await fs.readdir(batchesDir);
    assert.ok(files.some((f) => f.startsWith("batch_")));
  });

  test("collectBatches should return false when no batch files exist", async () => {
    const result = await repository.collectBatches();
    assert.strictEqual(result.collected, false);
    assert.strictEqual(result.filesProcessed, 0);
  });

  test("collectBatches should merge multiple batch files from same day", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    yesterday.setUTCHours(10, 0, 0, 0);
    const timestamp1 = yesterday.getTime();

    yesterday.setUTCHours(14, 0, 0, 0);
    const timestamp2 = yesterday.getTime();

    const batch1: BatchEntry = {
      main: {
        "/workspace/project1": [{ File: "src/app.ts", Timestamp: timestamp1 }],
      },
    };

    const batch2: BatchEntry = {
      main: {
        "/workspace/project1": [{ File: "src/util.ts", Timestamp: timestamp2 }],
      },
    };

    await fs.writeFile(
      path.join(batchesDir, `batch_${timestamp1}_abc123.json`),
      JSON.stringify(batch1, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(batchesDir, `batch_${timestamp2}_def456.json`),
      JSON.stringify(batch2, null, 2),
      "utf-8",
    );

    const result = await repository.collectBatches();

    assert.strictEqual(result.collected, true);
    assert.strictEqual(result.filesProcessed, 2);

    // Verify merged file
    const year = String(yesterday.getUTCFullYear());
    const month = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getUTCDate()).padStart(2, "0");
    const hierarchicalPath = path.join(batchesDir, year, month, `${day}.json`);

    const content = await fs.readFile(hierarchicalPath, "utf-8");
    const collected: BatchEntry = JSON.parse(content);

    assert.strictEqual(collected.main["/workspace/project1"].length, 2);
  });

  test("collectBatches should skip directories and non-batch files", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    // Create a directory
    await fs.mkdir(path.join(batchesDir, "subdir"));

    // Create a non-batch file
    await fs.writeFile(
      path.join(batchesDir, "other.json"),
      JSON.stringify({ data: "test" }),
      "utf-8",
    );

    const result = await repository.collectBatches();

    assert.strictEqual(result.collected, false);
    assert.strictEqual(result.filesProcessed, 0);
  });
});
