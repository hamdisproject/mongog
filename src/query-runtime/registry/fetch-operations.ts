import { appError, MongoGCancellationError } from '../../shared/errors/index.js';

interface FetchOperation {
  controller: AbortController;
  cancelResource?: () => void | Promise<void>;
  cancelled: boolean;
}

/** Tracks renderer-initiated page reads so a second runtime request can abort them. */
export class FetchOperationRegistry {
  private readonly operations = new Map<string, FetchOperation>();

  begin(operationId: string): AbortSignal {
    if (this.operations.has(operationId)) {
      throw appError('Validation', `Fetch operation ${operationId} is already active.`);
    }
    const controller = new AbortController();
    this.operations.set(operationId, { controller, cancelled: false });
    return controller.signal;
  }

  attachResource(operationId: string, cancelResource: () => void | Promise<void>): void {
    const operation = this.operations.get(operationId);
    if (!operation) return;
    operation.cancelResource = cancelResource;
    if (operation.cancelled) void Promise.resolve(cancelResource()).catch(() => undefined);
  }

  async cancel(operationId: string): Promise<boolean> {
    const operation = this.operations.get(operationId);
    if (!operation) return false;
    if (!operation.cancelled) {
      operation.cancelled = true;
      operation.controller.abort(new MongoGCancellationError('Fetch cancelled'));
      await operation.cancelResource?.();
    }
    return true;
  }

  finish(operationId: string): void {
    this.operations.delete(operationId);
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.operations.keys()].map((operationId) => this.cancel(operationId)));
    this.operations.clear();
  }
}
