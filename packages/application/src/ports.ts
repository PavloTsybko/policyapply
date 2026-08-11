import type {
  ApplyAttempt,
  ApplyCommand,
  ApplyOutcome,
  ApplyReceipt,
  AuditReceipt,
  ChangePlan,
} from "@policyapply/contracts";

export interface ClaimApplyInput {
  readonly command: ApplyCommand;
  readonly fingerprint: string;
  readonly operationId: string;
  readonly claimedAt: string;
}

export type ClaimApplyResult =
  | { readonly kind: "claimed"; readonly attempt: ApplyAttempt }
  | { readonly kind: "existing"; readonly attempt: ApplyAttempt };

export interface ApplyRepository {
  claim(input: ClaimApplyInput): Promise<ClaimApplyResult>;
  markExecuting(operationId: string): Promise<ApplyAttempt>;
  recordOutcome(operationId: string, outcome: ApplyOutcome): Promise<ApplyAttempt>;
  completeWithAudit(input: {
    readonly operationId: string;
    readonly outcome: Extract<ApplyOutcome, { outcome: "completed" }>;
    readonly plan: ChangePlan;
    readonly audit: AuditReceipt;
  }): Promise<ApplyReceipt>;
  getCompletedReceipt(operationId: string): Promise<ApplyReceipt | null>;
  listAudit(): Promise<readonly AuditReceipt[]>;
}

export interface ApplyExecutor {
  execute(input: {
    readonly operationId: string;
    readonly plan: ChangePlan;
  }): Promise<ApplyOutcome>;
}

export interface ApplyClock {
  now(): string;
}

export interface ApplyIdFactory {
  operationId(): string;
  auditId(): string;
}
