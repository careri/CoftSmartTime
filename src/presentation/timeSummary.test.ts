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
  workingHoursDefault = 480,
): CoftConfig {
  // Default: 8 h weekdays (480 min), 0 weekends
  const workingHoursByDay = [
    0,
    workingHoursDefault,
    workingHoursDefault,
    workingHoursDefault,
    workingHoursDefault,
    workingHoursDefault,
    0,
  ];
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
    workingHoursDefault,
    workingHoursByDay,
    workingHoursMissingConfig: false,
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
    (provider as any).setCurrentWeek();
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getDay(), 1, "startDate should be Monday");
  });

  test("setCurrentWeek with sunday: startDate is a Sunday", () => {
    const provider = makeProvider("sunday");
    (provider as any).setCurrentWeek();
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual(startDate.getDay(), 0, "startDate should be Sunday");
  });

  test("setCurrentWeek: endDate is 6 days after startDate", () => {
    const provider = makeProvider("monday");
    (provider as any).setCurrentWeek();
    const startDate: Date = (provider as any).startDate;
    const endDate: Date = (provider as any).endDate;
    const diff = Math.round(
      (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    assert.strictEqual(diff, 6, "week should span 6 days");
  });

  test("setCurrentWeek: startDate is on or before today", () => {
    const provider = makeProvider("monday");
    (provider as any).setCurrentWeek();
    const startDate: Date = new Date((provider as any).startDate);
    startDate.setHours(0, 0, 0, 0);
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
        date: "2026-02-10",
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
        date: "2026-02-11",
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
    (provider as any).currentPeriod = "week";
    const before: Date = new Date((provider as any).startDate);
    await (provider as any).handleMessage({ command: "back" });
    const after: Date = (provider as any).startDate;
    assert.strictEqual(
      before.getTime() - after.getTime(),
      7 * 24 * 60 * 60 * 1000,
    );
  });

  test("handleMessage 'forward' week: moves startDate forward 7 days", async () => {
    const provider = makeProvider();
    (provider as any).currentPeriod = "week";
    const before: Date = new Date((provider as any).startDate);
    await (provider as any).handleMessage({ command: "forward" });
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
    await (provider as any).handleMessage({ command: "back" });
    assert.deepStrictEqual((provider as any).reports, []);
    assert.strictEqual((provider as any).summaryData, null);
  });

  test("handleMessage 'forward' clears cached reports and summaryData", async () => {
    const provider = makeProvider();
    (provider as any).reports = [{ date: "2026-02-10", entries: [] }];
    (provider as any).summaryData = { summaryEntries: [], dateEntries: [] };
    await (provider as any).handleMessage({ command: "forward" });
    assert.deepStrictEqual((provider as any).reports, []);
    assert.strictEqual((provider as any).summaryData, null);
  });

  test("handleMessage 'setPeriod' week resets to current week", async () => {
    const provider = makeProvider();
    // Move far into the future first
    (provider as any).startDate = new Date(2099, 0, 1);
    (provider as any).endDate = new Date(2099, 0, 7);
    await (provider as any).handleMessage({
      command: "setPeriod",
      period: "week",
    });
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual((provider as any).currentPeriod, "week");
    // Should now be in the current year
    assert.strictEqual(startDate.getFullYear(), new Date().getFullYear());
  });

  test("handleMessage 'setPeriod' month resets to current month", async () => {
    const provider = makeProvider();
    (provider as any).startDate = new Date(2099, 0, 1);
    (provider as any).endDate = new Date(2099, 0, 31);
    await (provider as any).handleMessage({
      command: "setPeriod",
      period: "month",
    });
    const startDate: Date = (provider as any).startDate;
    assert.strictEqual((provider as any).currentPeriod, "month");
    assert.strictEqual(startDate.getDate(), 1);
    assert.strictEqual(startDate.getMonth(), new Date().getMonth());
  });

  // ── custom period ─────────────────────────────────────────────────────────

  test("handleMessage 'setPeriod' custom: sets currentPeriod without resetting dates", async () => {
    const provider = makeProvider();
    (provider as any).startDate = new Date(2026, 2, 1); // Mar 1
    (provider as any).endDate = new Date(2026, 2, 15); // Mar 15
    await (provider as any).handleMessage({
      command: "setPeriod",
      period: "custom",
    });
    assert.strictEqual((provider as any).currentPeriod, "custom");
    // Dates preserved
    const start: Date = (provider as any).startDate;
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 2);
    assert.strictEqual(start.getDate(), 1);
  });

  test("handleMessage 'setPeriod' custom: initialises customStartDate and customEndDate as ISO strings", async () => {
    const provider = makeProvider();
    (provider as any).startDate = new Date(2026, 2, 1);
    (provider as any).endDate = new Date(2026, 2, 15);
    await (provider as any).handleMessage({
      command: "setPeriod",
      period: "custom",
    });
    assert.strictEqual((provider as any).customStartDate, "2026-03-01");
    assert.strictEqual((provider as any).customEndDate, "2026-03-15");
  });

  test("handleMessage 'setPeriod' custom: does NOT clear cache", async () => {
    const provider = makeProvider();
    const cached = [{ date: "2026-03-01", entries: [] }];
    (provider as any).reports = cached;
    (provider as any).summaryData = { summaryEntries: [], dateEntries: [] };
    await (provider as any).handleMessage({
      command: "setPeriod",
      period: "custom",
    });
    assert.deepStrictEqual((provider as any).reports, cached);
    assert.notStrictEqual((provider as any).summaryData, null);
  });

  test("handleMessage 'setCustomRange': parses ISO dates into startDate/endDate", async () => {
    const provider = makeProvider();
    await (provider as any).handleMessage({
      command: "setCustomRange",
      start: "2026-01-05",
      end: "2026-01-20",
    });
    const start: Date = (provider as any).startDate;
    const end: Date = (provider as any).endDate;
    assert.strictEqual(start.getFullYear(), 2026);
    assert.strictEqual(start.getMonth(), 0);
    assert.strictEqual(start.getDate(), 5);
    assert.strictEqual(end.getFullYear(), 2026);
    assert.strictEqual(end.getMonth(), 0);
    assert.strictEqual(end.getDate(), 20);
  });

  test("handleMessage 'setCustomRange': updates customStartDate and customEndDate fields", async () => {
    const provider = makeProvider();
    await (provider as any).handleMessage({
      command: "setCustomRange",
      start: "2026-01-05",
      end: "2026-01-20",
    });
    assert.strictEqual((provider as any).customStartDate, "2026-01-05");
    assert.strictEqual((provider as any).customEndDate, "2026-01-20");
  });

  test("handleMessage 'setCustomRange': clears cached reports and summaryData", async () => {
    const provider = makeProvider();
    (provider as any).reports = [{ date: "2026-01-01", entries: [] }];
    (provider as any).summaryData = { summaryEntries: [], dateEntries: [] };
    await (provider as any).handleMessage({
      command: "setCustomRange",
      start: "2026-02-01",
      end: "2026-02-28",
    });
    assert.deepStrictEqual((provider as any).reports, []);
    assert.strictEqual((provider as any).summaryData, null);
  });

  test("handleMessage 'refresh': clears cached reports and summaryData", async () => {
    const provider = makeProvider();
    (provider as any).reports = [{ date: "2026-03-01", entries: [] }];
    (provider as any).summaryData = { summaryEntries: [], dateEntries: [] };
    await (provider as any).handleMessage({ command: "refresh" });
    assert.deepStrictEqual((provider as any).reports, []);
    assert.strictEqual((provider as any).summaryData, null);
  });

  test("handleMessage 'forward' in custom mode: does not change dates", async () => {
    const provider = makeProvider();
    (provider as any).currentPeriod = "custom";
    (provider as any).startDate = new Date(2026, 2, 1);
    (provider as any).endDate = new Date(2026, 2, 15);
    await (provider as any).handleMessage({ command: "forward" });
    const start: Date = (provider as any).startDate;
    const end: Date = (provider as any).endDate;
    assert.strictEqual(start.getDate(), 1);
    assert.strictEqual(end.getDate(), 15);
  });

  test("handleMessage 'back' in custom mode: does not change dates", async () => {
    const provider = makeProvider();
    (provider as any).currentPeriod = "custom";
    (provider as any).startDate = new Date(2026, 2, 1);
    (provider as any).endDate = new Date(2026, 2, 15);
    await (provider as any).handleMessage({ command: "back" });
    const start: Date = (provider as any).startDate;
    const end: Date = (provider as any).endDate;
    assert.strictEqual(start.getDate(), 1);
    assert.strictEqual(end.getDate(), 15);
  });

  // ── dateToISO ─────────────────────────────────────────────────────────────

  test("dateToISO: formats date as YYYY-MM-DD with zero-padded month and day", () => {
    const provider = makeProvider();
    const result = (provider as any).dateToISO(new Date(2026, 0, 5)); // Jan 5
    assert.strictEqual(result, "2026-01-05");
  });

  test("dateToISO: handles double-digit month and day", () => {
    const provider = makeProvider();
    const result = (provider as any).dateToISO(new Date(2026, 11, 31)); // Dec 31
    assert.strictEqual(result, "2026-12-31");
  });

  // ── dayOfWeek locale ──────────────────────────────────────────────────────

  test("computeSummary: dayOfWeek is in English ('Mon' not locale-specific)", () => {
    const provider = makeProvider();
    const reports: TimeReport[] = [
      {
        date: "2026-03-02", // Monday
        entries: [
          {
            key: "09:00",
            branch: "main",
            directory: "/p",
            files: [],
            fileDetails: [],
            comment: "",
            project: "P",
            assignedBranch: "",
          },
        ],
      },
    ];
    const summary = (provider as any).computeSummary(reports);
    const entry = summary.dateEntries.find((d: any) => d.date === "2026-03-02");
    assert.strictEqual(entry.dayOfWeek, "Mon");
  });
});

suite("TimeSummaryProvider Working Hours Test Suite", () => {
  function makeProviderWithConfig(config: CoftConfig): TimeSummaryProvider {
    const outputChannel = vscode.window.createOutputChannel("TimeSummary Test");
    const logger = new Logger(outputChannel, false);
    return new TimeSummaryProvider(config, logger);
  }

  function makeReport(
    date: string,
    slots: number,
    project = "Proj",
  ): TimeReport {
    const entries = Array.from({ length: slots }, (_, i) => ({
      key: `${String(i).padStart(2, "0")}:00`,
      branch: "main",
      directory: "/tmp",
      files: [],
      fileDetails: [],
      comment: "",
      project,
      assignedBranch: "",
    }));
    return { date, entries };
  }

  test("computeSummary: grandTotalReportedMinutes sums included weekday work time", () => {
    const testRoot = path.join(os.tmpdir(), `coft-wh-test-${Date.now()}`);
    const config = createTestConfig(testRoot);
    const provider = makeProviderWithConfig(config);
    // 2026-03-02 is a Monday; 4 slots * 15 min = 60 min reported
    const reports: TimeReport[] = [makeReport("2026-03-02", 4)];
    const summary = (provider as any).computeSummary(reports);
    assert.strictEqual(summary.grandTotalReportedMinutes, 60);
  });

  test("computeSummary: grandTotalNormalMinutes uses resolved working hours for included dates", () => {
    const testRoot = path.join(os.tmpdir(), `coft-wh-test-${Date.now()}`);
    const config = createTestConfig(testRoot, "monday", 480); // 8 h = 480 min
    const provider = makeProviderWithConfig(config);
    const reports: TimeReport[] = [makeReport("2026-03-02", 4)]; // Monday
    const summary = (provider as any).computeSummary(reports);
    assert.strictEqual(summary.grandTotalNormalMinutes, 480);
  });

  test("computeSummary: grandDeltaMinutes = reported - normal", () => {
    const testRoot = path.join(os.tmpdir(), `coft-wh-test-${Date.now()}`);
    const config = createTestConfig(testRoot, "monday", 480);
    const provider = makeProviderWithConfig(config);
    // 4 slots * 15 min = 60 min reported; normal = 480 min → delta = -420
    const reports: TimeReport[] = [makeReport("2026-03-02", 4)];
    const summary = (provider as any).computeSummary(reports);
    assert.strictEqual(summary.grandDeltaMinutes, 60 - 480);
  });

  test("computeSummary: weekend dates excluded by default; excluded dates skipped in totals", () => {
    const testRoot = path.join(os.tmpdir(), `coft-wh-test-${Date.now()}`);
    const config = createTestConfig(testRoot);
    const provider = makeProviderWithConfig(config);
    // 2026-03-07 is a Saturday
    const reports: TimeReport[] = [makeReport("2026-03-07", 4)];
    const summary = (provider as any).computeSummary(reports);
    assert.strictEqual(summary.grandTotalReportedMinutes, 0);
    assert.strictEqual(summary.grandTotalNormalMinutes, 0);
  });

  test("computeSummary: configWarning reflects workingHoursMissingConfig", () => {
    const testRoot = path.join(os.tmpdir(), `coft-wh-test-${Date.now()}`);
    const config = createTestConfig(testRoot);
    config.workingHoursMissingConfig = true;
    const provider = makeProviderWithConfig(config);
    const summary = (provider as any).computeSummary([]);
    assert.strictEqual(summary.configWarning, true);
  });

  test("handleMessage 'updateNormalHours' updates normalHours and recomputes", async () => {
    const testRoot = path.join(os.tmpdir(), `coft-wh-test-${Date.now()}`);
    const config = createTestConfig(testRoot);
    const provider = makeProviderWithConfig(config);
    const reports: TimeReport[] = [makeReport("2026-03-02", 4)];
    (provider as any).reports = reports;
    (provider as any).summaryData = (provider as any).computeSummary(reports);
    // Override normal hours for 2026-03-02 to 7 h
    await (provider as any).handleMessage({
      command: "updateNormalHours",
      date: "2026-03-02",
      hours: "7",
    });
    const summaryData = (provider as any).summaryData;
    const entry = summaryData.dateEntries.find(
      (d: any) => d.date === "2026-03-02",
    );
    assert.strictEqual(entry.normalHours, 420); // 7 * 60
    assert.strictEqual(summaryData.grandTotalNormalMinutes, 420);
  });
});

suite("TimeSummaryProvider loadReports Test Suite", () => {
  function makeProviderWithConfig(config: CoftConfig): TimeSummaryProvider {
    const outputChannel = vscode.window.createOutputChannel("TimeSummary Test");
    const logger = new Logger(outputChannel, false);
    return new TimeSummaryProvider(config, logger);
  }

  test("loadReports: includes dates with no saved report", async () => {
    const testRoot = path.join(
      os.tmpdir(),
      `coft-loadreports-test-${Date.now()}`,
    );
    const config = createTestConfig(testRoot);
    const provider = makeProviderWithConfig(config);
    // 2026-03-02 is a Monday; range covers Mon-Wed with only Monday saved
    (provider as any).startDate = new Date(2026, 2, 2);
    (provider as any).endDate = new Date(2026, 2, 4);
    (provider as any).timeReportRepository.readReport = async (d: Date) => {
      if (d.getDate() === 2) {
        return { entries: [{ key: "09:00", branch: "main", directory: "/p" }] };
      }
      return null;
    };
    const reports: TimeReport[] = await (provider as any).loadReports();
    assert.strictEqual(reports.length, 3);
    const dates = reports.map((r) => r.date);
    assert.deepStrictEqual(dates, ["2026-03-02", "2026-03-03", "2026-03-04"]);
    const noReportDay = reports.find((r) => r.date === "2026-03-03");
    assert.strictEqual(noReportDay!.entries.length, 0);
    assert.strictEqual((noReportDay as any).hasSavedReport, false);
    const savedDay = reports.find((r) => r.date === "2026-03-02");
    assert.strictEqual((savedDay as any).hasSavedReport, true);
    assert.strictEqual(savedDay!.entries.length, 1);
  });

  test("loadReports: dates without saved reports are included and marked in computeSummary", async () => {
    const testRoot = path.join(
      os.tmpdir(),
      `coft-loadreports-test2-${Date.now()}`,
    );
    const config = createTestConfig(testRoot);
    const provider = makeProviderWithConfig(config);
    (provider as any).startDate = new Date(2026, 2, 2);
    (provider as any).endDate = new Date(2026, 2, 3);
    (provider as any).timeReportRepository.readReport = async () => null;
    const reports: TimeReport[] = await (provider as any).loadReports();
    const summary = (provider as any).computeSummary(reports);
    assert.strictEqual(summary.dateEntries.length, 2);
    assert.strictEqual(
      summary.dateEntries.every((d: any) => d.include),
      true,
    );
  });
});
