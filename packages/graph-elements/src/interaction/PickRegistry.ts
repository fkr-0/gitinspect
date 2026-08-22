import type { ElementId, SelectionGranularity } from "@gitinspect/contracts";

export type RenderObjectId = string | number;

export interface PickReference {
  readonly objectId: RenderObjectId;
  readonly instanceId?: number;
}

export interface SemanticPickRecord {
  readonly elementId: ElementId;
  readonly interactionKey: string;
  readonly semanticKind?: string;
  readonly availableGranularities: readonly SelectionGranularity[];
}

export class PickRegistry {
  private readonly records = new Map<string, SemanticPickRecord>();

  public register(reference: PickReference, record: SemanticPickRecord): () => void {
    const key = pickKey(reference);
    if (this.records.has(key)) {
      throw new Error(`Pick reference already registered: ${key}`);
    }
    const frozen = freezeRecord(record);
    this.records.set(key, frozen);
    return () => {
      if (this.records.get(key) === frozen) this.records.delete(key);
    };
  }

  public unregister(reference: PickReference): boolean {
    return this.records.delete(pickKey(reference));
  }

  public resolve(reference: PickReference): SemanticPickRecord | undefined {
    const exact = this.records.get(pickKey(reference));
    if (exact !== undefined || reference.instanceId === undefined) return exact;
    return this.records.get(pickKey({ objectId: reference.objectId }));
  }

  public clear(): void {
    this.records.clear();
  }

  public get size(): number {
    return this.records.size;
  }
}

function pickKey(reference: PickReference): string {
  const object = `${typeof reference.objectId}:${String(reference.objectId)}`;
  return reference.instanceId === undefined ? object : `${object}:instance:${reference.instanceId}`;
}

function freezeRecord(record: SemanticPickRecord): SemanticPickRecord {
  const base = {
    elementId: record.elementId,
    interactionKey: record.interactionKey,
    availableGranularities: Object.freeze([...record.availableGranularities]),
  };
  return Object.freeze(
    record.semanticKind === undefined ? base : { ...base, semanticKind: record.semanticKind },
  );
}
