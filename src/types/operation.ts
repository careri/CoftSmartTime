export interface ProcessBatchRequest {
  type: "processBatch";
}

export interface WriteTimeReportRequest {
  type: "timereport";
  file: string;
  body: import("../storage/timeReportRepository").SavedTimeReport;
}

export interface UpdateProjectsRequest {
  type: "projects";
  file: string;
  body: import("../storage/projectRepository").ProjectMap;
}

export interface HousekeepingRequest {
  type: "housekeeping";
}

export interface InvalidRequest {
  type: "invalid";
}

export type OperationRequest =
  | ProcessBatchRequest
  | WriteTimeReportRequest
  | UpdateProjectsRequest
  | HousekeepingRequest
  | InvalidRequest;
