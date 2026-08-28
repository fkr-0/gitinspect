import type { ElementId, SelectionGranularity, SelectionState } from "@gitinspect/contracts";

import type { PickReference, SemanticPickRecord } from "./PickRegistry";
import type { PickRegistry } from "./PickRegistry";

export interface ModifierState {
  readonly shift?: boolean;
  readonly ctrl?: boolean;
  readonly meta?: boolean;
  readonly alt?: boolean;
}

export type RelatedSelectionResolver = (
  record: SemanticPickRecord,
  granularity: SelectionGranularity,
) => readonly ElementId[];

export interface InteractionManagerOptions {
  readonly tooltipDelayMs?: number;
  readonly resolveRelatedIds?: RelatedSelectionResolver;
}

export interface HoverState {
  readonly record: SemanticPickRecord;
  readonly tooltipVisible: boolean;
}

export type InteractionEvent =
  | { readonly type: "hover-change"; readonly hover?: HoverState }
  | { readonly type: "tooltip-request"; readonly hover: HoverState }
  | { readonly type: "selection-change"; readonly selection?: SelectionState }
  | { readonly type: "context-request"; readonly selection: SelectionState }
  | {
      readonly type: "shortcut";
      readonly shortcut: string;
      readonly selection: SelectionState | undefined;
      readonly requestedGranularity: SelectionGranularity;
    };

const DEFAULT_TOOLTIP_DELAY_MS = 350;

export class InteractionManager {
  private readonly listeners = new Set<(event: InteractionEvent) => void>();
  private readonly tooltipDelayMs: number;
  private readonly resolveRelatedIds: RelatedSelectionResolver;
  private hoverState: HoverState | undefined;
  private selectionState: SelectionState | undefined;
  private hoverTimer: ReturnType<typeof setTimeout> | undefined;
  private hoverToken = 0;

  public constructor(
    private readonly picks: PickRegistry,
    options: InteractionManagerOptions = {},
  ) {
    this.tooltipDelayMs = Math.max(0, options.tooltipDelayMs ?? DEFAULT_TOOLTIP_DELAY_MS);
    this.resolveRelatedIds = options.resolveRelatedIds ?? ((record) => [record.elementId]);
  }

  public subscribe(listener: (event: InteractionEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public getHover(): HoverState | undefined {
    return this.hoverState;
  }

  public getSelection(): SelectionState | undefined {
    return this.selectionState;
  }

  public hover(reference: PickReference | undefined): HoverState | undefined {
    const record = reference === undefined ? undefined : this.picks.resolve(reference);
    if (
      record === this.hoverState?.record ||
      (record === undefined && this.hoverState === undefined)
    ) {
      return this.hoverState;
    }

    this.cancelHoverTimer();
    const token = ++this.hoverToken;
    this.hoverState = record === undefined ? undefined : { record, tooltipVisible: false };
    this.emit(
      this.hoverState === undefined
        ? { type: "hover-change" }
        : { type: "hover-change", hover: this.hoverState },
    );

    if (record !== undefined) {
      if (this.tooltipDelayMs === 0) {
        this.showTooltip(token, record);
      } else {
        this.hoverTimer = setTimeout(() => this.showTooltip(token, record), this.tooltipDelayMs);
      }
    }
    return this.hoverState;
  }

  public clearHover(): void {
    this.hover(undefined);
  }

  public click(
    reference: PickReference,
    modifiers: ModifierState = {},
  ): SelectionState | undefined {
    const record = this.picks.resolve(reference);
    if (record === undefined) return undefined;
    const selection = this.selectionFor(record, modifiers);
    this.selectionState = selection;
    this.emit({ type: "selection-change", selection });
    return selection;
  }

  public clearSelection(): void {
    if (this.selectionState === undefined) return;
    this.selectionState = undefined;
    this.emit({ type: "selection-change" });
  }

  public requestContext(
    reference: PickReference,
    modifiers: ModifierState = {},
  ): SelectionState | undefined {
    const record = this.picks.resolve(reference);
    if (record === undefined) return undefined;
    const selection = this.selectionFor(record, modifiers);
    this.emit({ type: "context-request", selection });
    return selection;
  }

  public keyboardShortcut(shortcut: string, modifiers: ModifierState = {}): void {
    this.emit({
      type: "shortcut",
      shortcut,
      selection: this.selectionState,
      requestedGranularity: granularityFromModifiers(modifiers),
    });
  }

  public dispose(): void {
    this.cancelHoverTimer();
    this.listeners.clear();
  }

  private selectionFor(record: SemanticPickRecord, modifiers: ModifierState): SelectionState {
    const requested = granularityFromModifiers(modifiers);
    const granularity = resolveAvailableGranularity(requested, record.availableGranularities);
    return Object.freeze({
      elementId: record.elementId,
      interactionKey: record.interactionKey,
      granularity,
      relatedIds: Object.freeze([...this.resolveRelatedIds(record, granularity)]),
    });
  }

  private showTooltip(token: number, record: SemanticPickRecord): void {
    if (token !== this.hoverToken || this.hoverState?.record !== record) return;
    this.hoverTimer = undefined;
    this.hoverState = { record, tooltipVisible: true };
    this.emit({ type: "tooltip-request", hover: this.hoverState });
  }

  private cancelHoverTimer(): void {
    if (this.hoverTimer !== undefined) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = undefined;
    }
  }

  private emit(event: InteractionEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export function granularityFromModifiers(modifiers: ModifierState): SelectionGranularity {
  if (modifiers.shift === true && modifiers.alt === true) return "cluster";
  if (modifiers.alt === true) return "chain";
  if (modifiers.ctrl === true || modifiers.meta === true) return "edge-group";
  if (modifiers.shift === true) return "node";
  return "sub-element";
}

export function resolveAvailableGranularity(
  requested: SelectionGranularity,
  available: readonly SelectionGranularity[],
): SelectionGranularity {
  if (available.includes(requested)) return requested;
  if (available.includes("sub-element")) return "sub-element";
  return available[0] ?? requested;
}
