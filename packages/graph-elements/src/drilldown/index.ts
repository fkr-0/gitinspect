import type { CameraState, ElementId, GraphDataset } from "@gitinspect/contracts";

export interface WorldNavigationFrame<TDataset extends GraphDataset = GraphDataset> {
  readonly datasetIdentity: string;
  readonly dataset: TDataset;
  readonly mapperKey: string;
  readonly layoutKey: string;
  readonly camera: CameraState;
}

export interface ChildWorldRequest<TDataset extends GraphDataset = GraphDataset> {
  readonly parent: WorldNavigationFrame<TDataset>;
  readonly elementId: ElementId;
}

export type ChildWorldResolver<TDataset extends GraphDataset = GraphDataset> = (
  request: ChildWorldRequest<TDataset>,
) => Promise<WorldNavigationFrame<TDataset> | undefined>;

export interface WorldNavigationSnapshot<TDataset extends GraphDataset = GraphDataset> {
  readonly current: WorldNavigationFrame<TDataset>;
  readonly history: readonly WorldNavigationFrame<TDataset>[];
}

function cloneCamera(camera: CameraState): CameraState {
  return {
    mode: camera.mode,
    position: [...camera.position],
    target: [...camera.target],
    ...(camera.attachedNodeId === undefined ? {} : { attachedNodeId: camera.attachedNodeId }),
    zoom: camera.zoom,
  };
}

function snapshotFrame<TDataset extends GraphDataset>(frame: WorldNavigationFrame<TDataset>): WorldNavigationFrame<TDataset> {
  return Object.freeze({ ...frame, camera: Object.freeze(cloneCamera(frame.camera)) });
}

export class WorldNavigationStack<TDataset extends GraphDataset = GraphDataset> {
  private currentValue: WorldNavigationFrame<TDataset>;
  private historyValue: WorldNavigationFrame<TDataset>[] = [];
  private resolveGeneration = 0;

  constructor(
    initial: WorldNavigationFrame<TDataset>,
    private readonly resolver: ChildWorldResolver<TDataset>,
  ) {
    this.currentValue = snapshotFrame(initial);
  }

  get current(): WorldNavigationFrame<TDataset> {
    return this.currentValue;
  }

  get depth(): number {
    return this.historyValue.length;
  }

  snapshot(): WorldNavigationSnapshot<TDataset> {
    return Object.freeze({ current: this.currentValue, history: Object.freeze([...this.historyValue]) });
  }

  async enter(elementId: ElementId): Promise<boolean> {
    const parent = this.currentValue;
    const generation = ++this.resolveGeneration;
    const child = await this.resolver({ parent, elementId });
    if (generation !== this.resolveGeneration || this.currentValue !== parent || child === undefined) return false;
    this.historyValue = [...this.historyValue, parent];
    this.currentValue = snapshotFrame(child);
    return true;
  }

  back(): boolean {
    this.resolveGeneration += 1;
    const previous = this.historyValue.at(-1);
    if (previous === undefined) return false;
    this.historyValue = this.historyValue.slice(0, -1);
    this.currentValue = previous;
    return true;
  }

  replace(frame: WorldNavigationFrame<TDataset>): void {
    this.resolveGeneration += 1;
    this.currentValue = snapshotFrame(frame);
  }
}
