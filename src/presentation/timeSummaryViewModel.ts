import { SummaryData } from "./timeSummary";
import {
  DistributionAlgorithm,
  DistributionRow,
  FillByLargestDistributor,
  assignProjectsToDeltaRows,
} from "./timeSummaryDistribution";
import {
  DeltaAlgorithmType,
  DeltaDistributor,
  EvenDistributionDeltaDistributor,
} from "./timeSummaryDeltaDistribution";
import { FillLastDaysDeltaDistributor } from "./timeSummaryFillLastDaysDeltaDistribution";

export class TimeSummaryViewModel {
  private distributionStartDate: string = "";
  private distributionEndDate: string = "";
  private readonly algorithm: DistributionAlgorithm = "FillByLargest";
  private readonly distributor = new FillByLargestDistributor();

  private deltaAlgorithmType: DeltaAlgorithmType = "EvenDistribution";
  private deltaConfig: Map<string, string> = new Map();
  private deltaDistributor: DeltaDistributor;

  constructor(private readonly viewGroupByMinutes: number) {
    this.deltaDistributor = new EvenDistributionDeltaDistributor(
      viewGroupByMinutes,
    );
    this.resetDeltaConfig();
  }

  resetRange(summaryData: SummaryData): void {
    const included = summaryData.dateEntries.filter((d) => d.include);
    this.distributionStartDate = included.length > 0 ? included[0].date : "";
    this.distributionEndDate =
      included.length > 0 ? included[included.length - 1].date : "";
  }

  setRange(start: string, end: string): void {
    this.distributionStartDate = start;
    this.distributionEndDate = end;
  }

  getStartDate(): string {
    return this.distributionStartDate;
  }

  getEndDate(): string {
    return this.distributionEndDate;
  }

  getAlgorithm(): DistributionAlgorithm {
    return this.algorithm;
  }

  setDeltaAlgorithm(type: DeltaAlgorithmType): void {
    this.deltaAlgorithmType = type;
    if (type === "EvenDistribution") {
      this.deltaDistributor = new EvenDistributionDeltaDistributor(
        this.viewGroupByMinutes,
      );
    } else {
      this.deltaDistributor = new FillLastDaysDeltaDistributor();
    }
    this.resetDeltaConfig();
  }

  updateDeltaConfig(key: string, value: string): void {
    this.deltaConfig.set(key, value);
  }

  getDeltaAlgorithmType(): DeltaAlgorithmType {
    return this.deltaAlgorithmType;
  }

  getDeltaConfig(): Record<string, string> {
    const result: Record<string, string> = {
      ...this.deltaDistributor.defaultConfig,
    };
    for (const [k, v] of this.deltaConfig) {
      result[k] = v;
    }
    return result;
  }

  computeDistribution(summaryData: SummaryData): DistributionRow[] {
    const filtered = summaryData.dateEntries.filter(
      (d) =>
        d.include &&
        d.date >= this.distributionStartDate &&
        d.date <= this.distributionEndDate,
    );

    const { rows: normalRows, remainingBuckets } = this.distributor.compute(
      filtered,
      summaryData.summaryEntries,
    );

    const totalProjectMinutes = summaryData.summaryEntries.reduce(
      (sum, e) => sum + e.totalTime,
      0,
    );
    const totalDistributed = normalRows.reduce(
      (sum, row) => sum + row.hours,
      0,
    );
    const remaining = totalProjectMinutes - totalDistributed;

    const rawDeltaRows =
      remaining !== 0
        ? this.deltaDistributor.compute(filtered, remaining, this.deltaConfig)
        : [];

    const assignedDeltaRows = assignProjectsToDeltaRows(
      rawDeltaRows,
      remainingBuckets,
    );

    const allRows = [...normalRows, ...assignedDeltaRows].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    // Recalculate totalDateHours per date to include delta contributions
    const dateHoursMap = new Map<string, number>();
    for (const row of allRows) {
      dateHoursMap.set(row.date, (dateHoursMap.get(row.date) ?? 0) + row.hours);
    }
    for (const row of allRows) {
      row.totalDateHours = dateHoursMap.get(row.date) ?? row.totalDateHours;
    }

    return allRows;
  }

  private resetDeltaConfig(): void {
    this.deltaConfig = new Map(
      Object.entries(this.deltaDistributor.defaultConfig),
    );
  }
}
