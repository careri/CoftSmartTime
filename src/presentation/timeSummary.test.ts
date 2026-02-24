import * as assert from "assert";
import * as vscode from "vscode";
import * as path from "path";
import * as os from "os";
import { TimeSummaryProvider } from "./timeSummary";
import { CoftConfig } from "../application/config";
import { Logger } from "../utils/logger";
import { TimeReport } from "../storage/batchRepository";

function createTestConfig(
  testRoot: string,
  startOfWeek = "monday",
): CoftConfig {
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
    startOfWeek,
  };
}

function makeProvider(startOfWeek = "monday"): TimeSummaryProvider {
  const testRoot = path.join(
    os.tmpdir(),
    `coft-timesummary-test-${Date.now()}`,
  );
  const config = createTestConfig(testRoot, startOfWeek);
  const outputChannel = vscode.window.createOutputChannel("TimeSummary Test");
  const logger = new Logger(outputChannel, false);
  return new TimeSummaryProvider(config, logger);
}

suite("TimeSummaryProvider Navigation Test Suite", () => {
  // ── setCurrentWeek ────────────────────────────────────────────────────────

  test("setCurrentWeek with monday: startDate is a Monday", () => {
    const provider = makeProvider("monday");
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getDay(), 1, "startDate should be Monday");
  });

  test("setCurrentWeek with sunday: startDate is a Sunday", () => {
    const provider = makeProvider("sunday");
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getDay(), 0, "startDate should be Sunday");
  });

  test("setCurrentWeek: endDate is 6 days after startDate", () => {
    const provider = makeProvider("monday");
    const startDate: Date = (provider as any).startDate;
    const endDate: Date = (provider as any).endDate;
    const diff = Math.round(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    assert.strictEqual(diff, 6, "week should span 6 days");
  });

  test("setCurrentWeek: startDate is on or before today", () => {
    const provider = makeProvider("monday");
    const startDate: Date = (provider as any).startDate;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    assert.ok(startDate <= today, "startDate should not be in the future");
  });

  // ── setCurrentMonth ───────────────────────────────────────────────────────

  test("setCurrentMonth: startDate is first day of current month", () => {
    const provider = makeProvider();
    (provider as any).setCurrentMonth();
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getDate(), 1);
    assert.strictEqual(startDate.getMonth(), new Date().getMonth());
    assert.strictEqual(startDate.getFullYear(), new Date().getFullYear());
  });

  test("setCurrentMonth: endDate is last day of current month", () => {
    const provider = makeProvider();
    (provider as any).setCurrentMonth();
    const endDate: Date = (provider as any).endDate;
    const now = new Date();
    const lastDay = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    assert.strictEqual(endDate.getDate(), lastDay);
    assert.strictEqual(endDate.getMonth(), now.getMonth());
  });

  // ── moveForward ───────────────────────────────────────────────────────────

  test("moveForward week: shifts startDate and endDate by +7 days", () => {
    const provider = makeProvider();
    const before: Date = new Date((provider as any).startDate);
    const beforeEnd: Date = new Date((provider as any).endDate);
    (provider as any).moveForward("week");
    const after: Date = (provider as any).startDate;
    const afterEnd: Date = (provider as any).endDate;
    assert.strictEqual(
      after.getTime() - before.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
    assert.strictEqual(
      afterEnd.getTime() - beforeEnd.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
  });

  test("moveForward month: advances to next month", () => {
    const provider = makeProvider();
    // Set to a known month
    (provider as any).startDate = new Date(2026, 0, 1); // Jan 1
    (provider as any).endDate = new Date(2026, 0, 31); // Jan 31
    (provider as any).moveForward("month");
    const startDate: Date = (provider as any).startDate;
    const endDate: Date = (provider as any).endDate;
    assert.strictEqual(startDate.getMonth(), 1); // February
    assert.strictEqual(endDate.getMonth(), 1);
    assert.strictEqual(endDate.getDate(), 28); // Feb 2026 has 28 days
  });

  test("moveForward month: Dec wraps to Jan of next year", () => {
    const provider = makeProvider();
    (provider as any).startDate = new Date(2026, 11, 1); // Dec 1
    (provider as any).endDate = new Date(2026, 11, 31); // Dec 31
    (provider as any).moveForward("month");
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getMonth(), 0); // January
    assert.strictEqual(startDate.getFullYear(), 2027);
  });

  // ── moveBack ──────────────────────────────────────────────────────────────

  test("moveBack week: shifts startDate and endDate by -7 days", () => {
    const provider = makeProvider();
    const before: Date = new Date((provider as any).startDate);
    const beforeEnd: Date = new Date((provider as any).endDate);
    (provider as any).moveBack("week");
    const after: Date = (provider as any).startDate;
    const afterEnd: Date = (provider as any).endDate;
    assert.strictEqual(
      before.getTime() - after.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
    assert.strictEqual(
      beforeEnd.getTime() - afterEnd.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
  });

  test("moveBack month: goes to previous month", () => {
    const provider = makeProvider();
    (provider as any).startDate = new Date(2026, 1, 1); // Feb 1
    (provider as any).endDate = new Date(2026, 1, 28); // Feb 28
    (provider as any).moveBack("month");
    const startDate: Date = (provider as any).startDate;
    const endDate: Date = (provider as any).endDate;
    assert.strictEqual(startDate.getMonth(), 0); // January
    assert.strictEqual(endDate.getDate(), 31); // Jan has 31 days
  });

  test("moveBack month: Jan wraps to Dec of previous year", () => {
    const provider = makeProvider();
    (provider as any).startDate = new Date(2026, 0, 1); // Jan 1 2026
    (provider as any).endDate = new Date(2026, 0, 31); // Jan 31
    (provider as any).moveBack("month");
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getMonth(), 11); // December
    assert.strictEqual(startDate.getFullYear(), 2025);
  });

  // ── recomputeSummary ──────────────────────────────────────────────────────

  test("recomputeSummary: aggregates project time for included dates only", () => {
    const provider = makeProvider();
    const reports: TimeReport[] = [
      {
        date: "2026-02-10T00:00:00.000Z",
        entries: [
          {
            key: "09:00",
            branch: "main",
            directory: "/p",
            files: [],
            fileDetails: [],
            comment: "",
            project: "Alpha",
            assignedBranch: "main",
          },
          {
            key: "09:15",
            branch: "main",
            directory: "/p",
            files: [],
            fileDetails: [],
            comment: "",
            project: "Alpha",
            assignedBranch: "main",
          },
          {
            key: "09:30",
            branch: "main",
            directory: "/p",
            files: [],
            fileDetails: [],
            comment: "",
            project: "Beta",
            assignedBranch: "main",
          },
        ],
      },
      {
        date: "2026-02-11T00:00:00.000Z",
        entries: [
          {
            key: "10:00",
            branch: "main",
            directory: "/p",
            files: [],
            fileDetails: [],
            comment: "",
            project: "Alpha",
            assignedBranch: "main",
          },
        ],
      },
    ];
    (provider as any).reports = reports;
    (provider as any).summaryData = {
      summaryEntries: [],
      dateEntries: [
        { date: "2026-02-10", workTime: 45, include: true, dayOfWeek: "Tue" },
        { date: "2026-02-11", workTime: 15, include: false, dayOfWeek: "Wed" }, // excluded
      ],
    };

    (provider as any).recomputeSummary();

    const summary = (provider as any).summaryData.summaryEntries as {
      project: string;
      totalTime: number;
    }[];
    // Only Feb 10 is included: 2x Alpha, 1x Beta
    const alpha = summary.find((s) => s.project === "Alpha");
    const beta = summary.find((s) => s.project === "Beta");
    assert.ok(alpha, "Alpha should be in summary");
    assert.strictEqual(alpha!.totalTime, 2 * 15); // 2 slots × 15 min
    assert.ok(beta, "Beta should be in summary");
    assert.strictEqual(beta!.totalTime, 1 * 15);
    // Feb 11 (excluded) Alpha entry should NOT be counted
    assert.strictEqual(alpha!.totalTime, 30);
  });

  test("recomputeSummary: no-op when summaryData is null", () => {
    const provider = makeProvider();
    (provider as any).summaryData = null;
    // Should not throw
    (provider as any).recomputeSummary();
  });

  test("recomputeSummary: no-op when reports is empty", () => {
    const provider = makeProvider();
    (provider as any).reports = [];
    (provider as any).summaryData = {
      summaryEntries: [{ project: "Alpha", totalTime: 30 }],
      dateEntries: [],
    };
    // Should not throw and should leave summaryEntries unchanged call exits early
    (provider as any).recomputeSummary();
  });

  // ── handleMessage routing ─────────────────────────────────────────────────

  test("handleMessage 'back' week: moves startDate back 7 days", async () => {
    const provider = makeProvider();
    const before: Date = new Date((provider as any).startDate);
    await (provider as any).handleMessage({ command: "back", unit: "week" });
    const after: Date = (provider as any).startDate;
    assert.strictEqual(
      before.getTime() - after.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
  });

  test("handleMessage 'forward' week: moves startDate forward 7 days", async () => {
    const provider = makeProvider();
    const before: Date = new Date((provider as any).startDate);
    await (provider as any).handleMessage({ command: "forward", unit: "week" });
    const after: Date = (provider as any).startDate;
    assert.strictEqual(
      after.getTime() - before.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
  });

  test("handleMessage 'back' clears cached reports and summaryData", async () => {
    const provider = makeProvider();
    (provider as any).reports = [{ date: "2026-02-10", entries: [] }];
    (provider as any).summaryData = { summaryEntries: [], dateEntries: [] };
    await (provider as any).handleMessage({ command: "back", unit: "week" });
    assert.deepStrictEqual((provider as any).reports, []);
    assert.strictEqual((provider as any).summaryData, null);
  });

  test("handleMessage 'forward' clears cached reports and summaryData", async () => {
    const provider = makeProvider();
    (provider as any).reports = [{ date: "2026-02-10", entries: [] }];
    (provider as any).summaryData = { summaryEntries: [], dateEntries: [] };
    await (provider as any).handleMessage({ command: "forward", unit: "week" });
    assert.deepStrictEqual((provider as any).reports, []);
    assert.strictEqual((provider as any).summaryData, null);
  });

  test("handleMessage 'currentWeek' resets to current week", async () => {
    const provider = makeProvider();
    // Move far into the future first
    (provider as any).startDate = new Date(2099, 0, 1);
    (provider as any).endDate = new Date(2099, 0, 7);
    await (provider as any).handleMessage({ command: "currentWeek" });
    const startDate: Date = (provider as any).startDate;
    // Should now be in the current year
    assert.strictEqual(startDate.getFullYear(), new Date().getFullYear());
  });

  test("handleMessage 'currentMonth' resets to current month", async () => {
    const provider = makeProvider();
    (provider as any).startDate = new Date(2099, 0, 1);
    (provider as any).endDate = new Date(2099, 0, 31);
    await (provider as any).handleMessage({ command: "currentMonth" });
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getDate(), 1);
    assert.strictEqual(startDate.getMonth(), new Date().getMonth());
  });
});
