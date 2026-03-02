import * as assert from "assert";
import { TimeSummaryViewModel } from "./timeSummaryViewModel";
import { SummaryData, DateEntry, SummaryEntry } from "./timeSummary";

function makeDate(
  date: string,
  include = true,
  workTime = 480,
  normalHours = 480,
): DateEntry {
  return { date, workTime, normalHours, include, dayOfWeek: "Mon" };
}

function makeProject(project: string, totalTime: number): SummaryEntry {
  return { project, totalTime };
}

function makeSummaryData(
  dates: DateEntry[],
  projects: SummaryEntry[],
): SummaryData {
  return {
    summaryEntries: projects,
    dateEntries: dates,
    grandTotalReportedMinutes: 0,
    grandTotalNormalMinutes: 0,
    grandDeltaMinutes: 0,
    configWarning: false,
  };
}

suite("TimeSummaryViewModel", () => {
  let vm: TimeSummaryViewModel;

  setup(() => {
    vm = new TimeSummaryViewModel();
  });

  test("initial state has empty dates", () => {
    assert.strictEqual(vm.getStartDate(), "");
    assert.strictEqual(vm.getEndDate(), "");
  });

  test("resetRange sets start/end to first/last included date", () => {
    const summary = makeSummaryData(
      [makeDate("2026-03-03"), makeDate("2026-03-04"), makeDate("2026-03-05")],
      [],
    );
    vm.resetRange(summary);
    assert.strictEqual(vm.getStartDate(), "2026-03-03");
    assert.strictEqual(vm.getEndDate(), "2026-03-05");
  });

  test("resetRange ignores excluded dates", () => {
    const summary = makeSummaryData(
      [
        makeDate("2026-03-01", false),
        makeDate("2026-03-03", true),
        makeDate("2026-03-05", true),
        makeDate("2026-03-07", false),
      ],
      [],
    );
    vm.resetRange(summary);
    assert.strictEqual(vm.getStartDate(), "2026-03-03");
    assert.strictEqual(vm.getEndDate(), "2026-03-05");
  });

  test("resetRange with no included dates sets empty strings", () => {
    const summary = makeSummaryData(
      [makeDate("2026-03-01", false), makeDate("2026-03-02", false)],
      [],
    );
    vm.resetRange(summary);
    assert.strictEqual(vm.getStartDate(), "");
    assert.strictEqual(vm.getEndDate(), "");
  });

  test("setRange updates start and end dates", () => {
    vm.setRange("2026-03-03", "2026-03-07");
    assert.strictEqual(vm.getStartDate(), "2026-03-03");
    assert.strictEqual(vm.getEndDate(), "2026-03-07");
  });

  test("getAlgorithm returns FillByLargest", () => {
    assert.strictEqual(vm.getAlgorithm(), "FillByLargest");
  });

  test("computeDistribution filters to included dates in range", () => {
    const summary = makeSummaryData(
      [
        makeDate("2026-03-03"),
        makeDate("2026-03-04"),
        makeDate("2026-03-05"),
        makeDate("2026-03-06"),
      ],
      [makeProject("ProjectA", 9999)],
    );
    vm.setRange("2026-03-04", "2026-03-05");
    const rows = vm.computeDistribution(summary);
    const dates = [...new Set(rows.map((r) => r.date))];
    assert.deepStrictEqual(dates.sort(), ["2026-03-04", "2026-03-05"]);
  });

  test("computeDistribution excludes non-included dates even if in range", () => {
    const summary = makeSummaryData(
      [
        makeDate("2026-03-03", true),
        makeDate("2026-03-04", false),
        makeDate("2026-03-05", true),
      ],
      [makeProject("ProjectA", 9999)],
    );
    vm.setRange("2026-03-03", "2026-03-05");
    const rows = vm.computeDistribution(summary);
    const dates = [...new Set(rows.map((r) => r.date))];
    assert.ok(!dates.includes("2026-03-04"));
  });

  test("computeDistribution with empty range returns empty rows", () => {
    const summary = makeSummaryData(
      [makeDate("2026-03-03")],
      [makeProject("ProjectA", 480)],
    );
    // start > end → no dates match
    vm.setRange("2026-03-05", "2026-03-03");
    const rows = vm.computeDistribution(summary);
    assert.strictEqual(rows.length, 0);
  });
});
