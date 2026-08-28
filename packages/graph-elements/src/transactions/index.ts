export type TransactionTargetMode = "copy" | "original";
export type TransactionState =
  | "draft"
  | "validating"
  | "previewed"
  | "confirmed"
  | "applying"
  | "applied"
  | "failed"
  | "cancelled";

export interface TransactionValidationContext<TOperation> {
  readonly transactionId: string;
  readonly baseRevision: string;
  readonly targetMode: TransactionTargetMode;
  readonly operations: readonly TOperation[];
  readonly liveRevision: string;
}

export interface TransactionPreviewContext<TOperation>
  extends TransactionValidationContext<TOperation> {}

export interface TransactionPreviewResult<TPreview> {
  readonly preview: TPreview;
  readonly previewRevision: string;
}

export interface TransactionConfirmationContext<TOperation, TPreview>
  extends TransactionValidationContext<TOperation> {
  readonly preview: TPreview;
  readonly previewRevision: string;
}

export interface TransactionConfirmation {
  readonly token: string;
}

export interface TransactionApplyContext<TOperation, TPreview>
  extends TransactionConfirmationContext<TOperation, TPreview> {
  readonly confirmationToken: string;
}

export interface TransactionCancelContext<TOperation> {
  readonly transactionId: string;
  readonly baseRevision: string;
  readonly targetMode: TransactionTargetMode;
  readonly operations: readonly TOperation[];
  readonly state: TransactionState;
}

export interface TransactionDomainAdapter<TOperation, TPreview, TApplyResult> {
  validate(context: TransactionValidationContext<TOperation>): Promise<void> | void;
  preview(
    context: TransactionPreviewContext<TOperation>,
  ): Promise<TransactionPreviewResult<TPreview>>;
  confirm(
    context: TransactionConfirmationContext<TOperation, TPreview>,
  ): Promise<TransactionConfirmation>;
  apply(context: TransactionApplyContext<TOperation, TPreview>): Promise<TApplyResult>;
  cancel?(context: TransactionCancelContext<TOperation>): Promise<void> | void;
}

export interface TransactionManagerOptions {
  readonly id?: string;
  readonly targetMode?: TransactionTargetMode;
}

export interface TransactionSnapshot<TOperation, TPreview, TApplyResult> {
  readonly id: string;
  readonly baseRevision: string;
  readonly targetMode: TransactionTargetMode;
  readonly state: TransactionState;
  readonly operations: readonly TOperation[];
  readonly preview?: TPreview;
  readonly previewRevision?: string;
  readonly confirmationToken?: string;
  readonly result?: TApplyResult;
  readonly failureReason?: string;
}

export class TransactionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionStateError";
  }
}

export class StaleTransactionError extends Error {
  readonly baseRevision: string;
  readonly liveRevision: string;

  constructor(baseRevision: string, liveRevision: string) {
    super(
      `Transaction base revision ${baseRevision} is stale relative to live revision ${liveRevision}.`,
    );
    this.name = "StaleTransactionError";
    this.baseRevision = baseRevision;
    this.liveRevision = liveRevision;
  }
}

let nextTransactionId = 1;

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class TransactionManager<TOperation, TPreview, TApplyResult = void> {
  readonly id: string;
  readonly baseRevision: string;
  readonly targetMode: TransactionTargetMode;
  private readonly adapter: TransactionDomainAdapter<TOperation, TPreview, TApplyResult>;
  private operationsValue: TOperation[] = [];
  private stateValue: TransactionState = "draft";
  private previewValue: TPreview | undefined;
  private previewRevisionValue: string | undefined;
  private confirmationTokenValue: string | undefined;
  private resultValue: TApplyResult | undefined;
  private failureReasonValue: string | undefined;

  constructor(
    baseRevision: string,
    adapter: TransactionDomainAdapter<TOperation, TPreview, TApplyResult>,
    options: TransactionManagerOptions = {},
  ) {
    this.id = options.id ?? `transaction-${nextTransactionId++}`;
    this.baseRevision = baseRevision;
    this.targetMode = options.targetMode ?? "copy";
    this.adapter = adapter;
  }

  get state(): TransactionState {
    return this.stateValue;
  }

  get operations(): readonly TOperation[] {
    return this.operationsValue;
  }

  snapshot(): TransactionSnapshot<TOperation, TPreview, TApplyResult> {
    const snapshot: TransactionSnapshot<TOperation, TPreview, TApplyResult> = {
      id: this.id,
      baseRevision: this.baseRevision,
      targetMode: this.targetMode,
      state: this.stateValue,
      operations: [...this.operationsValue],
      ...(this.previewValue === undefined ? {} : { preview: this.previewValue }),
      ...(this.previewRevisionValue === undefined
        ? {}
        : { previewRevision: this.previewRevisionValue }),
      ...(this.confirmationTokenValue === undefined
        ? {}
        : { confirmationToken: this.confirmationTokenValue }),
      ...(this.resultValue === undefined ? {} : { result: this.resultValue }),
      ...(this.failureReasonValue === undefined ? {} : { failureReason: this.failureReasonValue }),
    };
    return Object.freeze(snapshot);
  }

  addOperation(operation: TOperation): void {
    this.assertState("draft", "Operations can only be changed while the transaction is a draft.");
    this.operationsValue = [...this.operationsValue, operation];
  }

  replaceOperations(operations: readonly TOperation[]): void {
    this.assertState("draft", "Operations can only be changed while the transaction is a draft.");
    this.operationsValue = [...operations];
  }

  async preview(liveRevision: string): Promise<TPreview> {
    this.assertState("draft", "Only a draft transaction can be previewed.");
    this.stateValue = "validating";
    try {
      this.assertFresh(liveRevision);
      const context = this.validationContext(liveRevision);
      await this.adapter.validate(context);
      this.assertFresh(liveRevision);
      const result = await this.adapter.preview(context);
      if (result.previewRevision !== this.baseRevision) {
        throw new StaleTransactionError(this.baseRevision, result.previewRevision);
      }
      this.previewValue = result.preview;
      this.previewRevisionValue = result.previewRevision;
      this.stateValue = "previewed";
      return result.preview;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  async confirm(liveRevision: string): Promise<string> {
    this.assertState("previewed", "Only a previewed transaction can be confirmed.");
    try {
      this.assertFresh(liveRevision);
      const preview = this.requirePreview();
      const previewRevision = this.requirePreviewRevision();
      if (previewRevision !== liveRevision)
        throw new StaleTransactionError(previewRevision, liveRevision);
      const confirmation = await this.adapter.confirm({
        ...this.validationContext(liveRevision),
        preview,
        previewRevision,
      });
      if (confirmation.token.length === 0)
        throw new Error("Domain adapter returned an empty confirmation token.");
      this.confirmationTokenValue = confirmation.token;
      this.stateValue = "confirmed";
      return confirmation.token;
    } catch (error) {
      this.invalidatePreview();
      this.fail(error);
      throw error;
    }
  }

  async apply(liveRevision: string): Promise<TApplyResult> {
    this.assertState("confirmed", "Only a confirmed transaction can be applied.");
    try {
      this.assertFresh(liveRevision);
      const preview = this.requirePreview();
      const previewRevision = this.requirePreviewRevision();
      const confirmationToken = this.confirmationTokenValue;
      if (confirmationToken === undefined)
        throw new TransactionStateError("Confirmed transaction has no adapter token.");
      this.stateValue = "applying";
      const result = await this.adapter.apply({
        ...this.validationContext(liveRevision),
        preview,
        previewRevision,
        confirmationToken,
      });
      this.resultValue = result;
      this.confirmationTokenValue = undefined;
      this.stateValue = "applied";
      return result;
    } catch (error) {
      this.confirmationTokenValue = undefined;
      this.fail(error);
      throw error;
    }
  }

  async cancel(): Promise<void> {
    if (
      this.stateValue === "applied" ||
      this.stateValue === "failed" ||
      this.stateValue === "cancelled"
    ) {
      throw new TransactionStateError(
        `Cannot cancel terminal transaction in state ${this.stateValue}.`,
      );
    }
    const state = this.stateValue;
    try {
      await this.adapter.cancel?.({
        transactionId: this.id,
        baseRevision: this.baseRevision,
        targetMode: this.targetMode,
        operations: [...this.operationsValue],
        state,
      });
      this.confirmationTokenValue = undefined;
      this.stateValue = "cancelled";
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  private validationContext(liveRevision: string): TransactionValidationContext<TOperation> {
    return {
      transactionId: this.id,
      baseRevision: this.baseRevision,
      targetMode: this.targetMode,
      operations: [...this.operationsValue],
      liveRevision,
    };
  }

  private assertFresh(liveRevision: string): void {
    if (liveRevision !== this.baseRevision) {
      this.invalidatePreview();
      throw new StaleTransactionError(this.baseRevision, liveRevision);
    }
  }

  private invalidatePreview(): void {
    this.previewValue = undefined;
    this.previewRevisionValue = undefined;
    this.confirmationTokenValue = undefined;
  }

  private fail(error: unknown): void {
    this.failureReasonValue = failureMessage(error);
    this.stateValue = "failed";
  }

  private assertState(expected: TransactionState, message: string): void {
    if (this.stateValue !== expected) throw new TransactionStateError(message);
  }

  private requirePreview(): TPreview {
    if (this.previewValue === undefined)
      throw new TransactionStateError("Transaction preview is unavailable.");
    return this.previewValue;
  }

  private requirePreviewRevision(): string {
    if (this.previewRevisionValue === undefined)
      throw new TransactionStateError("Preview revision is unavailable.");
    return this.previewRevisionValue;
  }
}
