import { DateEntry } from "./timeSummary";
import { DistributionRow } from "./timeSummaryDistribution";
import {
  DeltaAlgorithmType,
  DeltaDistributor,
} from "./timeSummaryDeltaDistribution";

export class FillLastDaysDeltaDistributor implements DeltaDistributor {
  readonly algorithmType: DeltaAlgorithmType = "FillLastDays";
  readonly defaultConfig: Record<string, string> = { NumberOfDays: "1" };

  compute(
    dateEntries: DateEntry[],
    remainingDeltaMinutes: number,
    config: Map<string, string>,
  ): DistributionRow[] {
    if (dateEntries.length === 0 || remainingDeltaMinutes === 0) {
      return [];
    }

    const nStr = config.get("NumberOfDays") ?? this.defaultConfig.NumberOfDays;
    const n = Math.max(1, parseInt(nStr, 10));
    const lastDates = dateEntries.slice(-n);
    const sign = remainingDeltaMinutes >= 0 ? 1 : -1;
    const abs = Math.abs(remainingDeltaMinutes);
    const perDay = Math.floor(abs / lastDates.length);
    const remainder = abs - perDay * lastDates.length;
    const rows: DistributionRow[] = [];

    for (let i = 0; i < lastDates.length; i++) {
      const take = i === lastDates.length - 1 ? perDay + remainder : perDay;
      if (take === 0) {
        continue;
      }
      rows.push({
        date: lastDates[i].date,
        project: "Delta",
        hours: take * sign,
        totalDateHours: lastDates[i].normalHours,
        delta: true,
      });
    }

    return rows;
  }
}
