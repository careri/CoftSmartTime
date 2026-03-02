import { DateEntry, SummaryEntry } from "./timeSummary";

export interface DistributionRow {
  date: string;
  project: string;
  hours: number; // minutes
  totalDateHours: number; // minutes – same for all rows on that date
  delta: boolean; // true = added by delta logic
}

export type DistributionAlgorithm = "FillByLargest";

export interface ProjectBucket {
  project: string;
  remaining: number; // minutes
}

export interface FillByLargestResult {
  rows: DistributionRow[];
  remainingBuckets: ProjectBucket[];
}

export function computeTargetMinutesForDate(entry: DateEntry): number {
  const delta = entry.workTime - entry.normalHours;
  if (delta >= 0) {
    return entry.normalHours;
  }
  const distributedDelta = Math.round(delta / 30) * 30;
  return entry.normalHours + distributedDelta;
}

export class FillByLargestDistributor {
  compute(
    dateEntries: DateEntry[],
    summaryEntries: SummaryEntry[],
  ): FillByLargestResult {
    const rows: DistributionRow[] = [];

    const buckets: ProjectBucket[] = [...summaryEntries]
      .sort((a, b) => b.totalTime - a.totalTime)
      .map((e) => ({ project: e.project, remaining: e.totalTime }));

    let projectIndex = 0;

    for (const entry of dateEntries) {
      const targetMinutes = this.computeTargetMinutes(entry);

      if (targetMinutes <= 0) {
        continue;
      }

      let needed = targetMinutes;

      while (needed > 0 && projectIndex < buckets.length) {
        const bucket = buckets[projectIndex];
        const take = Math.min(bucket.remaining, needed);

        if (take > 0) {
          rows.push({
            date: entry.date,
            project: bucket.project,
            hours: take,
            totalDateHours: entry.normalHours,
            delta: false,
          });
          bucket.remaining -= take;
          needed -= take;
        }

        if (bucket.remaining <= 0) {
          projectIndex++;
        }
      }
    }

    const remainingBuckets = buckets.filter((b) => b.remaining > 0);
    return { rows, remainingBuckets };
  }

  private computeTargetMinutes(entry: DateEntry): number {
    return computeTargetMinutesForDate(entry);
  }
}

/**
 * Re-assigns delta rows (produced with a placeholder project) to the actual
 * projects that still have remaining time, splitting rows as needed.
 */
export function assignProjectsToDeltaRows(
  deltaRows: DistributionRow[],
  remainingBuckets: ProjectBucket[],
): DistributionRow[] {
  const buckets = remainingBuckets.map((b) => ({ ...b }));
  let bucketIdx = 0;
  const result: DistributionRow[] = [];

  for (const row of deltaRows) {
    let needed = row.hours;

    while (needed > 0 && bucketIdx < buckets.length) {
      const b = buckets[bucketIdx];
      const take = Math.min(b.remaining, needed);

      if (take > 0) {
        result.push({ ...row, project: b.project, hours: take });
        b.remaining -= take;
        needed -= take;
      }

      if (b.remaining <= 0) {
        bucketIdx++;
      }
    }

    if (needed > 0) {
      // No buckets left – keep the row with its original project label
      result.push({ ...row, hours: needed });
    }
  }

  return result;
}
