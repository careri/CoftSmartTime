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
    vm = new TimeSummaryViewModel(15);
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

  test("getDeltaAlgorithmType defaults to EvenDistribution", () => {
    assert.strictEqual(vm.getDeltaAlgorithmType(), "EvenDistribution");
  });

  test("getDeltaConfig returns defaults for EvenDistribution", () => {
    const config = vm.getDeltaConfig();
    assert.strictEqual(config.Factor, "15");
  });

  test("setDeltaAlgorithm switches to FillLastDays and resets config", () => {
    vm.updateDeltaConfig("Factor", "30"); // modify EvenDistribution config
    vm.setDeltaAlgorithm("FillLastDays");
    assert.strictEqual(vm.getDeltaAlgorithmType(), "FillLastDays");
    const config = vm.getDeltaConfig();
    assert.strictEqual(config.NumberOfDays, "1");
    assert.ok(!("Factor" in config));
  });

  test("setDeltaAlgorithm back to EvenDistribution resets config to timeslot default", () => {
    vm.setDeltaAlgorithm("FillLastDays");
    vm.setDeltaAlgorithm("EvenDistribution");
    assert.strictEqual(vm.getDeltaConfig().Factor, "15");
  });

  test("updateDeltaConfig overrides a config key", () => {
    vm.updateDeltaConfig("Factor", "30");
    assert.strictEqual(vm.getDeltaConfig().Factor, "30");
  });

  test("computeDistribution appends delta rows when project time exceeds distributed", () => {
    // 1 date workTime=600, normalHours=480 → FillByLargest target=480, takes 480 from project
    // project has 600 min total → distributed=480 → remaining=600-480=120 → delta rows
    const summary = makeSummaryData(
      [makeDate("2026-03-03", true, 600, 480)],
      [makeProject("ProjectA", 600)],
    );
    vm.setRange("2026-03-03", "2026-03-03");
    const rows = vm.computeDistribution(summary);

    const normalRows = rows.filter((r) => !r.delta);
    const deltaRows = rows.filter((r) => r.delta);

    assert.strictEqual(normalRows.length, 1);
    assert.strictEqual(normalRows[0].hours, 480);
    assert.ok(deltaRows.length > 0);
    assert.strictEqual(
      deltaRows.reduce((s, r) => s + r.hours, 0),
      120,
    );
    // Delta rows are assigned to the project with remaining time
    assert.ok(deltaRows.every((r) => r.project === "ProjectA"));
    // totalDateHours is recalculated to include delta (480 normal + 120 delta = 600)
    assert.ok(rows.every((r) => r.totalDateHours === 600));
  });

  test("no delta rows when project time equals distributed", () => {
    // project=480, normalHours=480, workTime=480 → distributed=480 → remaining=0
    const summary = makeSummaryData(
      [makeDate("2026-03-03", true, 480, 480)],
      [makeProject("ProjectA", 480)],
    );
    vm.setRange("2026-03-03", "2026-03-03");
    const rows = vm.computeDistribution(summary);
    assert.ok(rows.every((r) => !r.delta));
  });
});
