import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { OperationRepository } from "./operationRepository";
import { CoftConfig } from "../application/config";
import { Logger } from "../utils/logger";
import { OperationRequest } from "../types/operation";

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

suite("OperationRepository Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let logger: Logger;
  let repository: OperationRepository;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-op-repo-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    await fs.mkdir(testConfig.operationQueue, { recursive: true });
    const outputChannel = vscode.window.createOutputChannel(
      "OperationRepository Test",
    );
    logger = new Logger(outputChannel, false);
    repository = new OperationRepository(testConfig, logger);
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("readPendingOperations returns empty array when directory is empty", async () => {
    const ops = await repository.readPendingOperations();
    assert.deepStrictEqual(ops, []);
  });

  test("readPendingOperations returns empty array when directory does not exist", async () => {
    const freshRoot = path.join(os.tmpdir(), `coft-fresh-op-${Date.now()}`);
    const freshConfig = createTestConfig(freshRoot);
    const repo = new OperationRepository(freshConfig, logger);
    const ops = await repo.readPendingOperations();
    assert.deepStrictEqual(ops, []);
  });

  test("addOperation creates a JSON file in the operation queue", async () => {
    const request: OperationRequest = { type: "processBatch" };
    await repository.addOperation(request);
    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.filter((f) => f.endsWith(".json")).length, 1);
  });

  test("addOperation stores correct request data", async () => {
    const request: OperationRequest = {
      type: "projectChange",
      action: "add",
      branch: "main",
      directory: "/project",
      project: "Alpha",
    };
    await repository.addOperation(request);
    const files = await fs.readdir(testConfig.operationQueue);
    const content = await fs.readFile(
      path.join(testConfig.operationQueue, files[0]),
      "utf-8",
    );
    const saved = JSON.parse(content);
    assert.strictEqual(saved.type, "projectChange");
    assert.strictEqual(saved.branch, "main");
    assert.strictEqual(saved.project, "Alpha");
  });

  test("readPendingOperations reads all .json files and returns them sorted", async () => {
    const req1: OperationRequest = { type: "processBatch" };
    const req2: OperationRequest = { type: "housekeeping" };
    await repository.addOperation(req1);
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await repository.addOperation(req2);

    const ops = await repository.readPendingOperations();
    assert.strictEqual(ops.length, 2);
    assert.strictEqual(ops[0].request.type, "processBatch");
    assert.strictEqual(ops[1].request.type, "housekeeping");
  });

  test("readPendingOperations handles malformed JSON as invalid request", async () => {
    await fs.writeFile(
      path.join(testConfig.operationQueue, "0001_bad.json"),
      "not json",
      "utf-8",
    );
    const ops = await repository.readPendingOperations();
    assert.strictEqual(ops.length, 1);
    assert.strictEqual((ops[0].request as any).type, "invalid");
  });

  test("deleteOperation removes the file", async () => {
    const request: OperationRequest = { type: "processBatch" };
    await repository.addOperation(request);
    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);

    await repository.deleteOperation(files[0]);

    const remaining = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(remaining.length, 0);
  });

  test("deleteOperation does not throw when file does not exist", async () => {
    // Should silently handle missing file
    await repository.deleteOperation("nonexistent_file.json");
  });

  test("readPendingOperations ignores non-.json files", async () => {
    await fs.writeFile(
      path.join(testConfig.operationQueue, "notes.txt"),
      "ignored",
      "utf-8",
    );
    const ops = await repository.readPendingOperations();
    assert.strictEqual(ops.length, 0);
  });
});
