export interface OverviewEntry {
  branch: string;
  directory: string;
  project: string;
  timeSlots: number;
}

export interface ProjectGroup {
  project: string;
  totalTimeSlots: number;
  entries: OverviewEntry[];
}

export interface OverviewData {
  startOfDay: string;
  endOfDay: string;
  entries: OverviewEntry[];
  groups: ProjectGroup[];
}

export interface QueuedOperation {
  type: "saveReport" | "saveProjects";
}
