import { DateEntry } from "./timeSummary";
import {
  DistributionRow,
  FillByLargestDistributor,
} from "./timeSummaryDistribution";

export type DeltaAlgorithmType = "EvenDistribution" | "FillLastDays";

export interface DeltaDistributor {
  readonly algorithmType: DeltaAlgorithmType;
  readonly defaultConfig: Record<string, string>;
  compute(
    dateEntries: DateEntry[],
    remainingDeltaMinutes: number,
    config: Map<string, string>,
  ): DistributionRow[];
}

export class EvenDistributionDeltaDistributor implements DeltaDistributor {
  readonly algorithmType: DeltaAlgorithmType = "EvenDistribution";
  readonly defaultConfig: Record<string, string>;

  constructor(timeslotMinutes: number) {
    this.defaultConfig = { Factor: String(timeslotMinutes) };
  }

  compute(
    dateEntries: DateEntry[],
    remainingDeltaMinutes: number,
    config: Map<string, string>,
  ): DistributionRow[] {
    if (dateEntries.length === 0 || remainingDeltaMinutes === 0) {
      return [];
    }

    const factorStr = config.get("Factor") ?? this.defaultConfig.Factor;
    const factor = Math.max(1, parseInt(factorStr, 10));
    const sign = remainingDeltaMinutes >= 0 ? 1 : -1;
    const abs = Math.abs(remainingDeltaMinutes);

    // Build a cycling list of synthetic date entries, one slot (Factor min) each.
    // FillByLargestDistributor then fills them from the delta "project" in order.
    const passes = Math.ceil(abs / factor);
    const syntheticDates: DateEntry[] = [];
    for (let i = 0; i < passes; i++) {
      const source = dateEntries[i % dateEntries.length];
      syntheticDates.push({ ...source, normalHours: factor, workTime: factor });
    }

    const { rows } = new FillByLargestDistributor(factor, false).compute(
      syntheticDates,
      [{ project: "Delta", totalTime: abs }],
    );

    // Aggregate minutes per date into one row each
    const byDate = new Map<string, number>();
    for (const row of rows) {
      byDate.set(row.date, (byDate.get(row.date) ?? 0) + row.hours);
    }

    return [...byDate.entries()].map(([date, minutes]) => ({
      date,
      project: "Delta",
      hours: minutes * sign,
      totalDateHours:
        dateEntries.find((e) => e.date === date)?.normalHours ?? 0,
      delta: true,
    }));
  }
}
