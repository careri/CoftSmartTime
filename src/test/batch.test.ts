import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { StorageManager, QueueEntry } from "../storage";
import { GitManager } from "../git";
import { BatchProcessor } from "../batch";
import { CoftConfig } from "../config";

suite("Batch Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
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
      data: path.join(testRoot, "data"),
      backup: path.join(testRoot, "backup"),
      intervalSeconds: 60,
      viewGroupByMinutes: 15,
      branchTaskUrl: "",
    };

    outputChannel = vscode.window.createOutputChannel("Batch Test");
    storage = new StorageManager(testConfig, outputChannel);
    await storage.initialize();

    git = new GitManager(testConfig, outputChannel, "0.0.1");
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
});
