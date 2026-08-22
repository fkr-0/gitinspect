import { useMemo, type CSSProperties } from "react";
import { Canvas } from "@react-three/fiber";
import {
  GraphWorld,
  type GraphDataset,
  type GraphNodeRecord,
} from "@gitinspect/graph-elements";

import { layoutGitDataset } from "../domain/gitLayout";
import { gitVisualMapper } from "../domain/gitVisualMapper";
import { gitEdgeStyleRegistry } from "../domain/gitVisualTheme";

interface GraphViewportProps {
  readonly dataset: GraphDataset | undefined;
  readonly selectedElementId: string | undefined;
  readonly search: string;
  readonly onSelect: (elementId: string) => void;
}

interface ViewportPoint {
  readonly node: GraphNodeRecord;
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

function hashUnit(value: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function toViewportPoint(node: GraphNodeRecord, index: number, total: number): ViewportPoint {
  const hinted = node.positionHint;
  if (hinted) {
    const rank = total <= 1 ? 0.5 : index / (total - 1);
    return {
      node,
      x: 48 + hinted[0] * 7 + (hashUnit(node.id, 3) - 0.5) * 13,
      y: 82 - rank * 64,
      depth: Math.max(-1, Math.min(1, hinted[2] / 4)),
    };
  }

  return {
    node,
    x: 14 + hashUnit(node.id, 11) * 72,
    y: 16 + hashUnit(node.id, 29) * 68,
    depth: hashUnit(node.id, 47) * 2 - 1,
  };
}

export function GraphViewport({
  dataset,
  selectedElementId,
  search,
  onSelect,
}: GraphViewportProps) {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const points = (dataset?.nodes ?? [])
    .slice(0, 72)
    .map((node, index, nodes) => toViewportPoint(node, index, nodes.length));
  const nodePositions = useMemo(() => {
    if (!dataset) return undefined;
    return new Map(Object.entries(layoutGitDataset(dataset).nodePositions));
  }, [dataset]);
  const canRenderCanvas = typeof window !== "undefined";

  return (
    <section className="viewport" aria-label="3D graph viewport" data-testid="graph-viewport">
      {dataset && nodePositions && canRenderCanvas && (
        <Canvas
          className="viewport__canvas"
          camera={{ position: [10, 6, 16], fov: 48, near: 0.1, far: 500 }}
          dpr={[1, 1.75]}
        >
          <GraphWorld
            dataset={dataset}
            mapper={gitVisualMapper}
            nodePositions={nodePositions}
            edgeStyleRegistry={gitEdgeStyleRegistry}
            background={{
              color: "#080b0f",
              fog: { color: "#080b0f", near: 22, far: 80 },
            }}
          />
        </Canvas>
      )}
      <div className="viewport__atmosphere" aria-hidden="true" />
      <div className="viewport__grid" aria-hidden="true" />
      <div className="viewport__axis viewport__axis--x" aria-hidden="true" />
      <div className="viewport__axis viewport__axis--z" aria-hidden="true" />

      <div className="viewport__legend">
        <span className="eyebrow">GraphWorld</span>
        <strong>{dataset ? `${dataset.nodes.length} logical elements` : "No world loaded"}</strong>
        <span>{dataset ? `${dataset.edges.length} relations · ${dataset.revision}` : "Open a repository to hydrate the scene"}</span>
      </div>

      {points.map(({ node, x, y, depth }) => {
        const matches =
          normalizedSearch.length === 0 ||
          node.label?.toLocaleLowerCase().includes(normalizedSearch) ||
          node.kind.toLocaleLowerCase().includes(normalizedSearch) ||
          node.id.toLocaleLowerCase().includes(normalizedSearch);
        const style = {
          "--point-x": `${Math.max(6, Math.min(94, x))}%`,
          "--point-y": `${Math.max(8, Math.min(90, y))}%`,
          "--point-scale": String(0.82 + (depth + 1) * 0.13),
        } as CSSProperties;

        return (
          <button
            key={node.id}
            type="button"
            className="viewport-node"
            data-selected={node.id === selectedElementId || undefined}
            data-muted={!matches || undefined}
            style={style}
            onClick={() => onSelect(node.id)}
            title={node.label ?? node.id}
          >
            <span className="viewport-node__core" />
            <span className="viewport-node__label">{node.label ?? node.kind}</span>
          </button>
        );
      })}

      {!dataset && (
        <div className="viewport__empty">
          <span className="viewport__reticle" aria-hidden="true" />
          <strong>Repository space is ready</strong>
          <span>Open a repository to build its semantic Git world.</span>
        </div>
      )}

      <div className="viewport__boundary-note">Public GraphWorld · semantic Git layout · procedural Git visual grammar</div>
    </section>
  );
}
