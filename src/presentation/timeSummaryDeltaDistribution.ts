import { DateEntry } from "./timeSummary";
import { DistributionRow } from "./timeSummaryDistribution";

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
    let abs = Math.abs(remainingDeltaMinutes);
    const rows: DistributionRow[] = [];

    while (abs > 0) {
      for (const entry of dateEntries) {
        if (abs <= 0) {
          break;
        }
        const take = Math.min(abs, factor);
        rows.push({
          date: entry.date,
          project: "Delta",
          hours: take * sign,
          totalDateHours: entry.normalHours,
          delta: true,
        });
        abs -= take;
      }
    }

    return rows;
  }
}
