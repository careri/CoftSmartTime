import * as assert from "assert";
import * as vscode from "vscode";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TimeReportViewModel } from "./timeReportViewModel";
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

suite("TimeReportViewModel Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let logger: Logger;
  let vm: TimeReportViewModel;

  setup(async () => {
    testRoot = path.join(os.tmpdir(), `coft-vm-test-${Date.now()}`);
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    await fs.mkdir(testConfig.operationQueue, { recursive: true });

    const outputChannel = vscode.window.createOutputChannel("ViewModel Test");
    logger = new Logger(outputChannel, false);
    vm = new TimeReportViewModel(testConfig, logger);
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // ── shiftTimeKey ──────────────────────────────────────────────────────────

  test("shiftTimeKey shifts forward by 1 slot", () => {
    const result = (vm as any).shiftTimeKey("09:00", 1);
    assert.strictEqual(result, "09:15");
  });

  test("shiftTimeKey shifts backward by 1 slot", () => {
    const result = (vm as any).shiftTimeKey("09:15", -1);
    assert.strictEqual(result, "09:00");
  });

  test("shiftTimeKey shifts forward across hour boundary", () => {
    const result = (vm as any).shiftTimeKey("09:45", 1);
    assert.strictEqual(result, "10:00");
  });

  test("shiftTimeKey shifts backward across hour boundary", () => {
    const result = (vm as any).shiftTimeKey("10:00", -1);
    assert.strictEqual(result, "09:45");
  });

  test("shiftTimeKey returns null when result would exceed 23:59", () => {
    const result = (vm as any).shiftTimeKey("23:45", 1);
    assert.strictEqual(result, null);
  });

  test("shiftTimeKey returns null when result would be before 00:00", () => {
    const result = (vm as any).shiftTimeKey("00:00", -1);
    assert.strictEqual(result, null);
  });

  test("shiftTimeKey returns null for invalid key format", () => {
    const result = (vm as any).shiftTimeKey("invalid", 1);
    assert.strictEqual(result, null);
  });

  test("shiftTimeKey returns null for key missing colon", () => {
    const result = (vm as any).shiftTimeKey("0900", 1);
    assert.strictEqual(result, null);
  });

  test("shiftTimeKey pads hours and minutes with leading zeros", () => {
    const result = (vm as any).shiftTimeKey("00:45", -1);
    assert.strictEqual(result, "00:30");
  });

  // ── updateProjectMapping ──────────────────────────────────────────────────

  test("updateProjectMapping enqueues a projectChange operation", async () => {
    await vm.updateProjectMapping("feature/test", "My Project", "/workspace");
    const queue: unknown[] = (vm as any).operationQueue;
    assert.strictEqual(queue.length, 1);
    const op = queue[0] as {
      type: string;
      branch: string;
      project: string;
      directory: string;
      action: string;
    };
    assert.strictEqual(op.type, "projectChange");
    assert.strictEqual(op.action, "add");
    assert.strictEqual(op.branch, "feature/test");
    assert.strictEqual(op.project, "My Project");
    assert.strictEqual(op.directory, "/workspace");
  });

  test("updateProjectMapping enqueues multiple operations", async () => {
    await vm.updateProjectMapping("main", "Project A", "/a");
    await vm.updateProjectMapping("develop", "Project B", "/b");
    const queue: unknown[] = (vm as any).operationQueue;
    assert.strictEqual(queue.length, 2);
  });

  // ── save ──────────────────────────────────────────────────────────────────

  test("save writes queued operations and clears the queue", async () => {
    await vm.updateProjectMapping("main", "Alpha", "/p");
    await vm.save();

    const queue: unknown[] = (vm as any).operationQueue;
    assert.strictEqual(queue.length, 0, "queue should be cleared after save");

    // The operation file should exist in the operationQueue dir
    const files = await fs.readdir(testConfig.operationQueue);
    assert.ok(
      files.length >= 1,
      "at least one operation file should be written",
    );
  });

  test("save with no report only writes queued operations", async () => {
    // No report set, no queued ops
    await vm.save();
    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 0);
  });

  test("save with a report writes a timereport operation", async () => {
    vm.setReport({
      date: "2026-02-10T00:00:00.000Z",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          files: ["a.ts"],
          fileDetails: [],
          comment: "",
          project: "Alpha",
          assignedBranch: "main",
        },
      ],
    });

    await vm.save();

    const files = await fs.readdir(testConfig.operationQueue);
    assert.strictEqual(files.length, 1, "one operation file for the report");

    const content = await fs.readFile(
      path.join(testConfig.operationQueue, files[0]),
      "utf-8",
    );
    const op = JSON.parse(content);
    assert.strictEqual(op.type, "timereport");
  });

  // ── copyRow ───────────────────────────────────────────────────────────────

  test("copyRow above inserts entry one slot before", () => {
    vm.setReport({
      date: "2026-02-10T00:00:00.000Z",
      entries: [
        {
          key: "09:15",
          branch: "main",
          directory: "/p",
          files: [],
          fileDetails: [],
          comment: "",
          project: "A",
          assignedBranch: "main",
        },
      ],
    });
    vm.copyRow(0, "above");
    const entries = (vm as any).report.entries as { key: string }[];
    assert.ok(entries.some((e) => e.key === "09:00"));
  });

  test("copyRow below inserts entry one slot after", () => {
    vm.setReport({
      date: "2026-02-10T00:00:00.000Z",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/p",
          files: [],
          fileDetails: [],
          comment: "",
          project: "A",
          assignedBranch: "main",
        },
      ],
    });
    vm.copyRow(0, "below");
    const entries = (vm as any).report.entries as { key: string }[];
    assert.ok(entries.some((e) => e.key === "09:15"));
  });

  test("copyRow does not insert when shift would go out of bounds", () => {
    vm.setReport({
      date: "2026-02-10T00:00:00.000Z",
      entries: [
        {
          key: "23:45",
          branch: "main",
          directory: "/p",
          files: [],
          fileDetails: [],
          comment: "",
          project: "A",
          assignedBranch: "main",
        },
      ],
    });
    vm.copyRow(0, "below");
    const entries = (vm as any).report.entries as { key: string }[];
    assert.strictEqual(entries.length, 1, "no new entry should be added");
  });

  // ── updateStartEndOfDay ───────────────────────────────────────────────────

  test("updateStartEndOfDay sets startOfDay to earliest key", () => {
    vm.setReport({
      date: "2026-02-10T00:00:00.000Z",
      entries: [
        {
          key: "10:00",
          branch: "main",
          directory: "/p",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
        {
          key: "09:00",
          branch: "main",
          directory: "/p",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    });
    vm.updateStartEndOfDay();
    assert.strictEqual((vm as any).report.startOfDay, "09:00");
  });

  test("updateStartEndOfDay sets endOfDay to slot after latest key", () => {
    vm.setReport({
      date: "2026-02-10T00:00:00.000Z",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/p",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
        {
          key: "09:30",
          branch: "main",
          directory: "/p",
          files: [],
          fileDetails: [],
          comment: "",
          project: "",
          assignedBranch: "main",
        },
      ],
    });
    vm.updateStartEndOfDay();
    assert.strictEqual((vm as any).report.endOfDay, "09:45");
  });
});
