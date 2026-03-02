import { SummaryData } from "./timeSummary";
import {
  DistributionAlgorithm,
  DistributionRow,
  FillByLargestDistributor,
} from "./timeSummaryDistribution";

export class TimeSummaryViewModel {
  private distributionStartDate: string = "";
  private distributionEndDate: string = "";
  private readonly algorithm: DistributionAlgorithm = "FillByLargest";
  private readonly distributor = new FillByLargestDistributor();

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

  computeDistribution(summaryData: SummaryData): DistributionRow[] {
    const filtered = summaryData.dateEntries.filter(
      (d) =>
        d.include &&
        d.date >= this.distributionStartDate &&
        d.date <= this.distributionEndDate,
    );
    return this.distributor.compute(filtered, summaryData.summaryEntries);
  }
}
