export interface AppleCommandResult {
  code: number;
  output: string;
}

export function isTransientAppleTicketFailure(output: string): boolean;
export function retryAppleTicketOperation(
  operation: () => Promise<AppleCommandResult>,
  options?: {
    wait?: (ms: number) => Promise<unknown>;
    warn?: (message: string) => void;
  },
): Promise<AppleCommandResult>;
