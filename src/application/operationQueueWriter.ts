import { OperationRepository } from "../storage/operationRepository";
import { OperationRequest } from "../types/operation";
import { Logger } from "../utils/logger";

export class OperationQueueWriter {
  static async write(
    operationRepository: OperationRepository,
    request: OperationRequest,
    logger: Logger,
  ): Promise<void> {
    await operationRepository.addOperation(request);
    const fileInfo =
      request.type === "timereport" || request.type === "projects"
        ? ` - ${request.file}`
        : "";
    logger.info(`Operation request created: (${request.type}${fileInfo})`);
  }
}
