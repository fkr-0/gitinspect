import { useMemo, type ReactNode } from "react";
import type {
  ElementId,
  GraphEdgeRecord,
  GraphNodeRecord,
  Vec3,
} from "@gitinspect/contracts";
import { GraphEdgeLayer } from "../edges/GraphEdgeLayer";
import {
  defaultEdgeStyleRegistry,
  type EdgeStyleRegistry,
} from "../edges/EdgeStyleRegistry";
import { GraphNodeLayer } from "../nodes/GraphNodeLayer";
import { planEdgeRendering } from "../rendering/edge-planner";
import { planNodeRendering } from "../rendering/node-planner";
import type { EdgeRouteMap, PlannedNodeLabel } from "../rendering/types";
import {
  resolveNodePositions,
  type DataMapper,
  type GraphDatasetView,
  type MappingContext,
} from "./mapping";

export interface GraphLightingConfig {
  readonly ambientIntensity: number;
  readonly hemisphereIntensity: number;
  readonly hemisphereSkyColor: string;
  readonly hemisphereGroundColor: string;
  readonly keyIntensity: number;
  readonly keyColor: string;
  readonly keyPosition: Vec3;
  readonly fillIntensity: number;
  readonly fillColor: string;
  readonly fillPosition: Vec3;
}

export interface GraphFogConfig {
  readonly color?: string;
  readonly near: number;
  readonly far: number;
}

export interface GraphBackgroundConfig {
  readonly color: string;
  readonly fog?: GraphFogConfig;
}

export const DEFAULT_GRAPH_LIGHTING: GraphLightingConfig = {
  ambientIntensity: 0.5,
  hemisphereIntensity: 0.75,
  hemisphereSkyColor: "#d9e6ff",
  hemisphereGroundColor: "#202735",
  keyIntensity: 1.2,
  keyColor: "#ffffff",
  keyPosition: [8, 12, 10],
  fillIntensity: 0.45,
  fillColor: "#9ebcff",
  fillPosition: [-8, 5, -6],
};

export const DEFAULT_GRAPH_BACKGROUND: GraphBackgroundConfig = {
  color: "#0d1118",
  fog: { color: "#0d1118", near: 80, far: 260 },
};

export interface GraphWorldProps<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
> {
  readonly dataset: GraphDatasetView<TNode, TEdge>;
  readonly mapper: DataMapper<TNode, TEdge>;
  readonly nodePositions?: ReadonlyMap<ElementId, Vec3>;
  readonly edgeRoutes?: EdgeRouteMap;
  readonly edgeStyleRegistry?: EdgeStyleRegistry;
  readonly lighting?: Partial<GraphLightingConfig>;
  readonly background?: GraphBackgroundConfig | null;
  readonly renderLabel?: (label: PlannedNodeLabel) => ReactNode;
}

function resolveLighting(overrides: Partial<GraphLightingConfig> | undefined): GraphLightingConfig {
  return { ...DEFAULT_GRAPH_LIGHTING, ...overrides };
}

export function GraphWorld<
  TNode extends GraphNodeRecord = GraphNodeRecord,
  TEdge extends GraphEdgeRecord = GraphEdgeRecord,
>({
  dataset,
  mapper,
  nodePositions,
  edgeRoutes,
  edgeStyleRegistry = defaultEdgeStyleRegistry,
  lighting: lightingOverrides,
  background = DEFAULT_GRAPH_BACKGROUND,
  renderLabel,
}: GraphWorldProps<TNode, TEdge>) {
  const positions = useMemo(
    () => resolveNodePositions(dataset.nodes, nodePositions),
    [dataset.nodes, nodePositions],
  );
  const mappingContext = useMemo<MappingContext<TNode, TEdge>>(() => ({
    dataset,
    revision: dataset.revision,
    nodePositions: positions,
  }), [dataset, positions]);
  const nodeDescriptors = useMemo(
    () => dataset.nodes.map((node) => mapper.mapNode(node, mappingContext)),
    [dataset.nodes, mapper, mappingContext],
  );
  const edgeDescriptors = useMemo(
    () => dataset.edges.map((edge) => mapper.mapEdge(edge, mappingContext)),
    [dataset.edges, mapper, mappingContext],
  );
  const nodePlan = useMemo(
    () => planNodeRendering(nodeDescriptors, positions),
    [nodeDescriptors, positions],
  );
  const edgePlan = useMemo(
    () => planEdgeRendering(dataset.edges, edgeDescriptors, positions, edgeStyleRegistry, edgeRoutes),
    [dataset.edges, edgeDescriptors, positions, edgeStyleRegistry, edgeRoutes],
  );
  const lighting = useMemo(() => resolveLighting(lightingOverrides), [lightingOverrides]);

  return (
    <>
      {background && <color attach="background" args={[background.color]} />}
      {background?.fog && (
        <fog
          attach="fog"
          args={[background.fog.color ?? background.color, background.fog.near, background.fog.far]}
        />
      )}
      <ambientLight intensity={lighting.ambientIntensity} />
      <hemisphereLight
        intensity={lighting.hemisphereIntensity}
        color={lighting.hemisphereSkyColor}
        groundColor={lighting.hemisphereGroundColor}
      />
      <directionalLight
        intensity={lighting.keyIntensity}
        color={lighting.keyColor}
        position={lighting.keyPosition}
      />
      <directionalLight
        intensity={lighting.fillIntensity}
        color={lighting.fillColor}
        position={lighting.fillPosition}
      />
      <group name="graph-world" userData={{ revision: dataset.revision }}>
        <GraphEdgeLayer plan={edgePlan} />
        {renderLabel
          ? <GraphNodeLayer plan={nodePlan} renderLabel={renderLabel} />
          : <GraphNodeLayer plan={nodePlan} />}
      </group>
    </>
  );
}
