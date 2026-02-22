import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { StorageManager, BatchEntry } from "../storage/storage";
import { GitManager } from "../storage/git";
import { CoftConfig } from "./config";
import { Logger } from "../utils/logger";

suite("Batch Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;
  let storage: StorageManager;
  let git: GitManager;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-batch-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });

    testConfig = {
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

    outputChannel = vscode.window.createOutputChannel("Batch Test");
    logger = new Logger(outputChannel, true);
    storage = new StorageManager(testConfig, logger);
    await storage.initialize();

    git = new GitManager(testConfig, logger, "0.0.1");
    await git.initialize();
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("BatchProcessor should generate batch entry from queue entries", async () => {
    // Write some queue entries
    await storage.writeQueueEntry("/workspace/project1", "src/app.ts", "main");
    await storage.writeQueueEntry("/workspace/project1", "src/util.ts", "main");
    await storage.writeQueueEntry("/workspace/project2", "index.ts", "develop");

    // Move to batch
    const movedFiles = await storage.moveQueueToBatch();
    assert.strictEqual(movedFiles.length, 3);

    // Create batch processor and trigger processing manually via storage
    const batchEntries = await storage.readBatchFiles();
    assert.strictEqual(batchEntries.length, 3);

    // Verify entries are properly typed
    for (const entry of batchEntries) {
      assert.ok(entry.directory);
      assert.ok(entry.filename);
      assert.ok(entry.timestamp);
    }
  });

  test("StorageManager should move batch to backup", async () => {
    await storage.writeQueueEntry("/workspace/project1", "src/app.ts", "main");
    await storage.moveQueueToBatch();

    await storage.moveBatchToBackup();

    const batchFiles = await fs.readdir(testConfig.queueBatch);
    assert.strictEqual(batchFiles.length, 0);

    const backupFiles = await fs.readdir(testConfig.queueBackup);
    assert.strictEqual(backupFiles.length, 1);
  });

  test("StorageManager should move batch back to queue on failure", async () => {
    await storage.writeQueueEntry("/workspace/project1", "src/app.ts", "main");
    await storage.writeQueueEntry("/workspace/project1", "src/util.ts", "main");
    await storage.moveQueueToBatch();

    // Simulate failure - move back to queue
    await storage.moveBatchToQueue();

    const batchFiles = await fs.readdir(testConfig.queueBatch);
    assert.strictEqual(batchFiles.length, 0);

    const queueFiles = await fs.readdir(testConfig.queue);
    assert.strictEqual(queueFiles.length, 2);
  });

  test("StorageManager should delete batch files", async () => {
    await storage.writeQueueEntry("/workspace/project1", "src/app.ts", "main");
    await storage.moveQueueToBatch();

    await storage.deleteBatchFiles();

    const batchFiles = await fs.readdir(testConfig.queueBatch);
    assert.strictEqual(batchFiles.length, 0);
  });

  test("Queue entry filename should use hash not base64", async () => {
    const longPath =
      "src/very/deeply/nested/directory/structure/with/lots/of/subdirectories/file.ts";
    await storage.writeQueueEntry("/workspace/project1", longPath, "main");

    const files = await fs.readdir(testConfig.queue);
    assert.strictEqual(files.length, 1);

    // Filename should match timestamp_hash.json pattern (not base64)
    const filenamePattern = /^\d+_[a-f0-9]{12}\.json$/;
    assert.ok(
      filenamePattern.test(files[0]),
      `Filename ${files[0]} should match hash pattern`,
    );

    // Should be well under 255 chars
    assert.ok(
      files[0].length < 100,
      `Filename length ${files[0].length} should be short`,
    );
  });

  test("collectBatches should collect old batch files into date hierarchy", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    // Create batch files with timestamps from yesterday
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayTimestamp = yesterday.getTime();

    const batch1: BatchEntry = {
      main: {
        "/workspace/project1": [
          { File: "src/app.ts", Timestamp: yesterdayTimestamp },
        ],
      },
    };
    const batch2: BatchEntry = {
      main: {
        "/workspace/project1": [
          { File: "src/util.ts", Timestamp: yesterdayTimestamp + 1000 },
        ],
      },
    };

    await fs.writeFile(
      path.join(batchesDir, `batch_${yesterdayTimestamp}_abc123.json`),
      JSON.stringify(batch1, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(batchesDir, `batch_${yesterdayTimestamp + 1000}_def456.json`),
      JSON.stringify(batch2, null, 2),
      "utf-8",
    );

    const result = await storage.collectBatches();

    assert.strictEqual(result.collected, true);
    assert.strictEqual(result.filesProcessed, 2);

    // Verify root files are deleted
    const rootFiles = (await fs.readdir(batchesDir)).filter((f) =>
      f.endsWith(".json"),
    );
    assert.strictEqual(rootFiles.length, 0);

    // Verify hierarchical file exists
    const year = String(yesterday.getUTCFullYear());
    const month = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getUTCDate()).padStart(2, "0");
    const hierarchicalPath = path.join(batchesDir, year, month, `${day}.json`);
    const content = await fs.readFile(hierarchicalPath, "utf-8");
    const merged: BatchEntry = JSON.parse(content);

    // Should have both files merged under main/project1
    assert.strictEqual(merged["main"]["/workspace/project1"].length, 2);
  });

  test("collectBatches should not collect today's batch files", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    // Create a batch file with today's timestamp
    const now = Date.now();
    const batch: BatchEntry = {
      main: {
        "/workspace/project1": [{ File: "src/app.ts", Timestamp: now }],
      },
    };

    await fs.writeFile(
      path.join(batchesDir, `batch_${now}_abc123.json`),
      JSON.stringify(batch, null, 2),
      "utf-8",
    );

    const result = await storage.collectBatches();

    assert.strictEqual(result.collected, false);
    assert.strictEqual(result.filesProcessed, 0);

    // Root file should still exist
    const rootFiles = (await fs.readdir(batchesDir)).filter((f) =>
      f.endsWith(".json"),
    );
    assert.strictEqual(rootFiles.length, 1);
  });

  test("collectBatches should return false when no batch files exist", async () => {
    const result = await storage.collectBatches();

    assert.strictEqual(result.collected, false);
    assert.strictEqual(result.filesProcessed, 0);
  });

  test("collectBatches should group by UTC date across multiple days", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    // Create batch files from two different past days
    const twoDaysAgo = new Date();
    twoDaysAgo.setUTCDate(twoDaysAgo.getUTCDate() - 2);
    const twoDaysAgoTimestamp = twoDaysAgo.getTime();

    const threeDaysAgo = new Date();
    threeDaysAgo.setUTCDate(threeDaysAgo.getUTCDate() - 3);
    const threeDaysAgoTimestamp = threeDaysAgo.getTime();

    const batch1: BatchEntry = {
      main: {
        "/workspace/project1": [
          { File: "src/a.ts", Timestamp: twoDaysAgoTimestamp },
        ],
      },
    };
    const batch2: BatchEntry = {
      develop: {
        "/workspace/project2": [
          { File: "src/b.ts", Timestamp: threeDaysAgoTimestamp },
        ],
      },
    };

    await fs.writeFile(
      path.join(batchesDir, `batch_${twoDaysAgoTimestamp}_aaa111.json`),
      JSON.stringify(batch1, null, 2),
      "utf-8",
    );
    await fs.writeFile(
      path.join(batchesDir, `batch_${threeDaysAgoTimestamp}_bbb222.json`),
      JSON.stringify(batch2, null, 2),
      "utf-8",
    );

    const result = await storage.collectBatches();

    assert.strictEqual(result.collected, true);
    assert.strictEqual(result.filesProcessed, 2);

    // Verify two separate hierarchical files were created
    const year2 = String(twoDaysAgo.getUTCFullYear());
    const month2 = String(twoDaysAgo.getUTCMonth() + 1).padStart(2, "0");
    const day2 = String(twoDaysAgo.getUTCDate()).padStart(2, "0");
    const path2 = path.join(batchesDir, year2, month2, `${day2}.json`);

    const year3 = String(threeDaysAgo.getUTCFullYear());
    const month3 = String(threeDaysAgo.getUTCMonth() + 1).padStart(2, "0");
    const day3 = String(threeDaysAgo.getUTCDate()).padStart(2, "0");
    const path3 = path.join(batchesDir, year3, month3, `${day3}.json`);

    const content2 = await fs.readFile(path2, "utf-8");
    const merged2: BatchEntry = JSON.parse(content2);
    assert.strictEqual(merged2["main"]["/workspace/project1"].length, 1);

    const content3 = await fs.readFile(path3, "utf-8");
    const merged3: BatchEntry = JSON.parse(content3);
    assert.strictEqual(merged3["develop"]["/workspace/project2"].length, 1);
  });

  test("collectBatches should merge with existing hierarchical file", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const yesterdayTimestamp = yesterday.getTime();

    const year = String(yesterday.getUTCFullYear());
    const month = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
    const day = String(yesterday.getUTCDate()).padStart(2, "0");

    // Create an existing hierarchical file
    const targetDir = path.join(batchesDir, year, month);
    await fs.mkdir(targetDir, { recursive: true });
    const existingBatch: BatchEntry = {
      main: {
        "/workspace/project1": [
          { File: "src/existing.ts", Timestamp: yesterdayTimestamp - 5000 },
        ],
      },
    };
    await fs.writeFile(
      path.join(targetDir, `${day}.json`),
      JSON.stringify(existingBatch, null, 2),
      "utf-8",
    );

    // Create a new batch file in root
    const newBatch: BatchEntry = {
      main: {
        "/workspace/project1": [
          { File: "src/new.ts", Timestamp: yesterdayTimestamp },
        ],
      },
    };
    await fs.writeFile(
      path.join(batchesDir, `batch_${yesterdayTimestamp}_abc123.json`),
      JSON.stringify(newBatch, null, 2),
      "utf-8",
    );

    const result = await storage.collectBatches();

    assert.strictEqual(result.collected, true);

    // Verify merged file has both entries
    const content = await fs.readFile(
      path.join(targetDir, `${day}.json`),
      "utf-8",
    );
    const merged: BatchEntry = JSON.parse(content);
    assert.strictEqual(merged["main"]["/workspace/project1"].length, 2);
  });

  test("collectBatches should skip directories and non-batch files", async () => {
    const batchesDir = path.join(testConfig.data, "batches");

    // Create a subdirectory (should be skipped)
    await fs.mkdir(path.join(batchesDir, "2025"), { recursive: true });

    // Create a non-batch json file (should be skipped)
    await fs.writeFile(path.join(batchesDir, "config.json"), "{}", "utf-8");

    const result = await storage.collectBatches();

    assert.strictEqual(result.collected, false);
    assert.strictEqual(result.filesProcessed, 0);
  });
});
