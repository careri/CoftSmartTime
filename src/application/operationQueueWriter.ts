import * as crypto from "crypto";
import * as vscode from "vscode";
import { OperationRepository } from "../storage/operationRepository";
import {
  ProcessBatchRequest,
  WriteTimeReportRequest,
  UpdateProjectsRequest,
  ProjectChangeRequest,
  HousekeepingRequest,
  InvalidRequest,
  OperationRequest,
} from "../types/operation";

export class OperationQueueWriter {
  static async write(
    operationRepository: OperationRepository,
    request: OperationRequest,
    outputChannel: vscode.OutputChannel,
  ): Promise<void> {
    await operationRepository.addOperation(request);
    const fileInfo =
      request.type === "timereport" || request.type === "projects"
        ? ` - ${request.file}`
        : "";
    outputChannel.appendLine(
      `Operation request created: (${request.type}${fileInfo})`,
    );
  }
}
