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
  // Always aim to fill every day up to its normal hours; any real shortfall
  // is naturally absorbed by bucket exhaustion / the delta distributor
  // rather than zeroing out low-activity days.
  return entry.normalHours;
}

export class FillByLargestDistributor {
  // balanceShortfall=false keeps the original sequential fill, used internally
  // by delta distributors that rely on exact slot-by-slot consumption order.
  constructor(
    private readonly timeslotMinutes: number = 15,
    private readonly balanceShortfall: boolean = true,
  ) {}

  compute(
    dateEntries: DateEntry[],
    summaryEntries: SummaryEntry[],
  ): FillByLargestResult {
    const rows: DistributionRow[] = [];

    const buckets: ProjectBucket[] = [...summaryEntries]
      .sort((a, b) => b.totalTime - a.totalTime)
      .map((e) => ({ project: e.project, remaining: e.totalTime }));

    const totalAvailable = buckets.reduce((sum, b) => sum + b.remaining, 0);
    const targets = this.balanceShortfall
      ? this.computeBalancedTargets(dateEntries, totalAvailable)
      : dateEntries.map((entry) =>
          Math.max(0, computeTargetMinutesForDate(entry)),
        );

    let projectIndex = 0;

    for (let i = 0; i < dateEntries.length; i++) {
      const entry = dateEntries[i];
      let needed = targets[i];

      if (needed <= 0) {
        continue;
      }

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

  /**
   * Spreads any overall shortfall (total target > total available) evenly
   * across all active days instead of letting the last days run dry, so
   * every day ends up as close to its normal hours as possible.
   */
  private computeBalancedTargets(
    dateEntries: DateEntry[],
    totalAvailable: number,
  ): number[] {
    const rawTargets = dateEntries.map((entry) =>
      Math.max(0, computeTargetMinutesForDate(entry)),
    );
    const totalTarget = rawTargets.reduce((sum, t) => sum + t, 0);

    if (totalAvailable >= totalTarget) {
      return rawTargets;
    }

    const activeIndexes = rawTargets
      .map((_, i) => i)
      .filter((i) => rawTargets[i] > 0);
    const n = activeIndexes.length;
    const shortfall = totalTarget - totalAvailable;

    // Reduce targets in whole timeslot units so results honour the view's grouping.
    const slot = Math.max(1, this.timeslotMinutes);
    const shortfallSlots = Math.ceil(shortfall / slot);
    const perDaySlots = Math.floor(shortfallSlots / n);
    const remainderSlots = shortfallSlots - perDaySlots * n;

    const result = [...rawTargets];
    activeIndexes.forEach((idx, pos) => {
      const extraSlot = pos >= n - remainderSlots ? 1 : 0;
      const reduction = (perDaySlots + extraSlot) * slot;
      result[idx] = Math.max(0, result[idx] - reduction);
    });

    return result;
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

export interface ProjectDistributionSummary {
  project: string;
  normalMinutes: number;
  deltaMinutes: number;
}

export function computeProjectDistributionSummary(
  rows: DistributionRow[],
): Map<string, ProjectDistributionSummary> {
  const map = new Map<string, ProjectDistributionSummary>();

  for (const row of rows) {
    let entry = map.get(row.project);
    if (!entry) {
      entry = { project: row.project, normalMinutes: 0, deltaMinutes: 0 };
      map.set(row.project, entry);
    }
    if (row.delta) {
      entry.deltaMinutes += row.hours;
    } else {
      entry.normalMinutes += row.hours;
    }
  }

  return map;
}
