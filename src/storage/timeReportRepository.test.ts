import * as assert from "assert";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { TimeReportRepository, SavedTimeReport } from "./timeReportRepository";
import { CoftConfig } from "../application/config";

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

suite("TimeReportRepository Test Suite", () => {
  let testRoot: string;
  let testConfig: CoftConfig;
  let repository: TimeReportRepository;

  setup(async () => {
    testRoot = path.join(
      os.tmpdir(),
      `coft-timereport-repo-test-${Date.now()}`,
    );
    await fs.mkdir(testRoot, { recursive: true });
    testConfig = createTestConfig(testRoot);
    await fs.mkdir(path.join(testConfig.data, "reports"), { recursive: true });
    repository = new TimeReportRepository(testConfig);
  });

  teardown(async () => {
    try {
      await fs.rm(testRoot, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("readReport returns null when file does not exist", async () => {
    const result = await repository.readReport(new Date(2026, 1, 10));
    assert.strictEqual(result, null);
  });

  test("readReport returns null for invalid JSON", async () => {
    const reportDir = path.join(testConfig.data, "reports", "2026", "02");
    await fs.mkdir(reportDir, { recursive: true });
    await fs.writeFile(path.join(reportDir, "10.json"), "not json", "utf-8");
    const result = await repository.readReport(new Date(2026, 1, 10));
    assert.strictEqual(result, null);
  });

  test("saveReport + readReport round-trip preserves data", async () => {
    const report: SavedTimeReport = {
      date: "2026-02-10",
      entries: [
        {
          key: "09:00",
          branch: "main",
          directory: "/project",
          comment: "Morning work",
          project: "Alpha",
          assignedBranch: "main",
        },
      ],
      startOfDay: "09:00",
      endOfDay: "10:00",
    };
    await repository.saveReport(report);
    const loaded = await repository.readReport(new Date(2026, 1, 10));
    assert.ok(loaded, "loaded report should not be null");
    assert.strictEqual(loaded!.date, report.date);
    assert.strictEqual(loaded!.startOfDay, "09:00");
    assert.strictEqual(loaded!.endOfDay, "10:00");
    assert.strictEqual(loaded!.entries.length, 1);
    assert.strictEqual(loaded!.entries[0].key, "09:00");
    assert.strictEqual(loaded!.entries[0].project, "Alpha");
  });

  test("saveReport creates intermediate directories", async () => {
    const report: SavedTimeReport = {
      date: "2026-03-15",
      entries: [],
    };
    await repository.saveReport(report);
    const reportPath = path.join(
      testConfig.data,
      "reports",
      "2026",
      "03",
      "15.json",
    );
    const exists = await fs
      .stat(reportPath)
      .then(() => true)
      .catch(() => false);
    assert.ok(exists, "report file should be created at expected path");
  });

  test("saveReport overwrites existing report", async () => {
    const report1: SavedTimeReport = {
      date: "2026-02-10",
      entries: [],
      startOfDay: "09:00",
    };
    const report2: SavedTimeReport = {
      date: "2026-02-10",
      entries: [],
      startOfDay: "10:00",
    };
    await repository.saveReport(report1);
    await repository.saveReport(report2);
    const loaded = await repository.readReport(new Date(2026, 1, 10));
    assert.strictEqual(loaded!.startOfDay, "10:00");
  });

  test("readReport returns report with optional fields undefined when absent", async () => {
    const report: SavedTimeReport = {
      date: "2026-02-11",
      entries: [],
    };
    await repository.saveReport(report);
    const loaded = await repository.readReport(new Date(2026, 1, 11));
    assert.ok(loaded);
    assert.strictEqual(loaded!.startOfDay, undefined);
    assert.strictEqual(loaded!.endOfDay, undefined);
  });
});
