import * as assert from "assert";
import { EvenDistributionDeltaDistributor } from "./timeSummaryDeltaDistribution";
import { FillLastDaysDeltaDistributor } from "./timeSummaryFillLastDaysDeltaDistribution";
import { DateEntry } from "./timeSummary";

function makeDate(date: string, normalHours = 480): DateEntry {
  return { date, workTime: 480, normalHours, include: true, dayOfWeek: "Mon" };
}

function makeConfig(entries: Record<string, string> = {}): Map<string, string> {
  return new Map(Object.entries(entries));
}

suite("EvenDistributionDeltaDistributor", () => {
  test("distributes remaining evenly in factor-sized chunks cycling through dates", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const dates = [makeDate("2026-03-03"), makeDate("2026-03-04")];
    const rows = dist.compute(dates, 30, makeConfig());

    // One aggregated row per date
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows.find((r) => r.date === "2026-03-03")?.hours, 15);
    assert.strictEqual(rows.find((r) => r.date === "2026-03-04")?.hours, 15);
  });

  test("cycles back to first date when one pass is not enough – totals are correct", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const dates = [makeDate("2026-03-03"), makeDate("2026-03-04")];
    // 45 / 15 = 3 chunks: d1 d2 d1 → d1 total 30, d2 total 15, one row per date
    const rows = dist.compute(dates, 45, makeConfig());

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows.find((r) => r.date === "2026-03-03")?.hours, 30);
    assert.strictEqual(rows.find((r) => r.date === "2026-03-04")?.hours, 15);
  });

  test("last chunk smaller than factor is aggregated into one row per date", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const dates = [makeDate("2026-03-03")];
    // 20 min, factor 15 → one full chunk + 5 min remainder, aggregated: 20 min
    const rows = dist.compute(dates, 20, makeConfig());

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hours, 20);
  });

  test("respects custom Factor from config", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const dates = [makeDate("2026-03-03")];
    // 60 min, factor 30 → 2 chunks, both on same date → aggregated to 1 row of 60
    const rows = dist.compute(dates, 60, makeConfig({ Factor: "30" }));

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hours, 60);
  });

  test("negative remaining produces negative hours", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const dates = [makeDate("2026-03-03")];
    // -30 min, factor 15 → 2 chunks aggregated: 1 row of -30
    const rows = dist.compute(dates, -30, makeConfig());

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].hours, -30);
  });

  test("all rows have delta: true and project Delta", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const dates = [makeDate("2026-03-03")];
    const rows = dist.compute(dates, 15, makeConfig());

    assert.strictEqual(rows[0].delta, true);
    assert.strictEqual(rows[0].project, "Delta");
  });

  test("returns empty when remaining is 0", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const rows = dist.compute([makeDate("2026-03-03")], 0, makeConfig());
    assert.strictEqual(rows.length, 0);
  });

  test("returns empty when no dates", () => {
    const dist = new EvenDistributionDeltaDistributor(15);
    const rows = dist.compute([], 60, makeConfig());
    assert.strictEqual(rows.length, 0);
  });

  test("defaultConfig Factor matches timeslot passed to constructor", () => {
    const dist = new EvenDistributionDeltaDistributor(30);
    assert.strictEqual(dist.defaultConfig.Factor, "30");
  });
});

suite("FillLastDaysDeltaDistributor", () => {
  const dist = new FillLastDaysDeltaDistributor();

  test("default: fills last 1 day with all remaining", () => {
    const dates = [
      makeDate("2026-03-03"),
      makeDate("2026-03-04"),
      makeDate("2026-03-05"),
    ];
    const rows = dist.compute(dates, 120, makeConfig());

    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].date, "2026-03-05");
    assert.strictEqual(rows[0].hours, 120);
  });

  test("NumberOfDays=2 distributes evenly across last 2 dates", () => {
    const dates = [
      makeDate("2026-03-03"),
      makeDate("2026-03-04"),
      makeDate("2026-03-05"),
    ];
    const rows = dist.compute(dates, 60, makeConfig({ NumberOfDays: "2" }));

    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].date, "2026-03-04");
    assert.strictEqual(rows[0].hours, 30);
    assert.strictEqual(rows[1].date, "2026-03-05");
    assert.strictEqual(rows[1].hours, 30);
  });

  test("remainder goes to last date", () => {
    const dates = [makeDate("2026-03-04"), makeDate("2026-03-05")];
    // 90 / 2 = 45 each → exact; use 91 to test remainder
    const rows = dist.compute(dates, 91, makeConfig({ NumberOfDays: "2" }));

    assert.strictEqual(rows[0].hours, 45);
    assert.strictEqual(rows[1].hours, 46); // gets the +1 remainder
  });

  test("NumberOfDays larger than available dates is capped", () => {
    const dates = [makeDate("2026-03-04"), makeDate("2026-03-05")];
    const rows = dist.compute(dates, 60, makeConfig({ NumberOfDays: "10" }));

    assert.strictEqual(rows.length, 2); // only 2 dates available
  });

  test("all rows have delta: true and project Delta", () => {
    const dates = [makeDate("2026-03-05")];
    const rows = dist.compute(dates, 30, makeConfig());

    assert.strictEqual(rows[0].delta, true);
    assert.strictEqual(rows[0].project, "Delta");
  });

  test("negative remaining produces negative hours", () => {
    const dates = [makeDate("2026-03-05")];
    const rows = dist.compute(dates, -60, makeConfig());

    assert.strictEqual(rows[0].hours, -60);
  });

  test("returns empty when remaining is 0", () => {
    const rows = dist.compute([makeDate("2026-03-05")], 0, makeConfig());
    assert.strictEqual(rows.length, 0);
  });

  test("returns empty when no dates", () => {
    const rows = dist.compute([], 60, makeConfig());
    assert.strictEqual(rows.length, 0);
  });

  test("defaultConfig has NumberOfDays of 1", () => {
    assert.strictEqual(dist.defaultConfig.NumberOfDays, "1");
  });
});
