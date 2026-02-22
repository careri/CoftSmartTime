import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { OperationQueueWriter } from "./operationQueueWriter";
import { OperationRepository } from "../storage/operationRepository";
import {
  WriteTimeReportRequest,
  UpdateProjectsRequest,
} from "../types/operation";
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

suite("OperationQueueWriter Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let outputChannel: vscode.OutputChannel;
  let logger: Logger;
  let operationRepository: OperationRepository;

  setup(async () => {
    testRoot = path.join(
      os.tmpdir(),
      `coft-operationqueue-writer-test-${Date.now()}`,
    );
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    outputChannel = vscode.window.createOutputChannel(
      "OperationQueueWriter Test",
    );
    logger = new Logger(outputChannel, true);
    operationRepository = new OperationRepository(testConfig, logger);
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
      body: { date: "2026-02-15", entries: [] },
    };

    await OperationQueueWriter.write(operationRepository, request, logger);

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);

    const content = await fs.readFile(
      path.join(testConfig.operationQueue, files[0]),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.type, "timereport");
    assert.strictEqual(parsed.file, "reports/2026/02/15.json");
    assert.deepStrictEqual(parsed.body, { date: "2026-02-15", entries: [] });
  });

  test("OperationQueueWriter should create queue directory if missing", async () => {
    // Remove the queue directory
    await fs.rm(testConfig.operationQueue, { recursive: true, force: true });

    const request: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15", entries: [] },
    };

    await OperationQueueWriter.write(operationRepository, request, logger);

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);
  });

  test("OperationQueueWriter should write multiple requests as separate files", async () => {
    const request1: WriteTimeReportRequest = {
      type: "timereport",
      file: "reports/2026/02/15.json",
      body: { date: "2026-02-15", entries: [] },
    };

    const request2: UpdateProjectsRequest = {
      type: "projects",
      file: "projects.json",
      body: { branch: { dir: "project" } },
    };

    await OperationQueueWriter.write(operationRepository, request1, logger);
    await OperationQueueWriter.write(operationRepository, request2, logger);

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 2);

    const contents = await Promise.all(
      files.map((file) =>
        fs.readFile(path.join(testConfig.operationQueue, file), "utf-8"),
      ),
    );

    const parsed = contents.map((c) => JSON.parse(c));
    assert.strictEqual(parsed.length, 2);
    assert.ok(
      parsed.some((p) => p.type === "timereport"),
      "Should contain timereport request",
    );
    assert.ok(
      parsed.some((p) => p.type === "projects"),
      "Should contain projects request",
    );
  });

  test("OperationQueueWriter should write ProcessBatchRequest", async () => {
    await OperationQueueWriter.write(
      operationRepository,
      { type: "processBatch" },
      logger,
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

  test("OperationQueueWriter should write HousekeepingRequest", async () => {
    await OperationQueueWriter.write(
      operationRepository,
      { type: "housekeeping" },
      logger,
    );

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1);

    const content = await fs.readFile(
      path.join(testConfig.operationQueue, files[0]),
      "utf-8",
    );
    const parsed = JSON.parse(content);
    assert.strictEqual(parsed.type, "housekeeping");
  });
});
