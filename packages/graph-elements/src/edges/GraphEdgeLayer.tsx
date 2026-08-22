import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Color, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import type {
  EdgeRenderPlan,
  PlannedEdgeBatch,
  PlannedEdgeHeadBatch,
} from "../rendering/types";

export interface GraphEdgeLayerProps {
  readonly plan: EdgeRenderPlan;
}

function EdgeBatch({ batch }: { readonly batch: PlannedEdgeBatch }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(batch.segments.length * 6);
    batch.segments.forEach((segment, index) => {
      positions.set(segment.start, index * 6);
      positions.set(segment.end, index * 6 + 3);
    });
    return new LineSegmentsGeometry().setPositions(positions);
  }, [batch]);

  const material = useMemo(() => {
    const dashed = batch.style.pattern !== "solid";
    return new LineMaterial({
      color: batch.style.color,
      linewidth: batch.style.width,
      transparent: batch.style.opacity < 1,
      opacity: batch.style.opacity,
      dashed,
      dashSize: batch.style.pattern === "dotted" ? Math.min(batch.style.dashSize, 0.1) : batch.style.dashSize,
      gapSize: batch.style.gapSize,
      worldUnits: false,
    });
  }, [batch]);

  const object = useMemo(() => {
    const line = new LineSegments2(geometry, material);
    if (batch.style.pattern !== "solid") line.computeLineDistances();
    line.userData = {
      renderBatchKey: batch.key,
      segmentSemantics: batch.segments.map(({ ownerId, elementId, interactionKey, edgeId, segmentIndex }) => ({
        ownerId,
        elementId,
        interactionKey,
        edgeId,
        segmentIndex,
      })),
    };
    return line;
  }, [batch, geometry, material]);

  useFrame((_, delta) => {
    if (batch.style.animated && batch.style.pattern !== "solid") {
      material.dashOffset -= delta * batch.style.animationSpeed;
    }
  });

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return <primitive object={object} />;
}

function HeadBatch({ batch }: { readonly batch: PlannedEdgeHeadBatch }) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const direction = new Vector3();
    const quaternion = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const color = new Color(batch.color);

    batch.heads.forEach((head, index) => {
      position.set(...head.position);
      direction.set(...head.direction).normalize();
      quaternion.setFromUnitVectors(up, direction);
      const radialScale = head.scale;
      scale.set(radialScale, radialScale * 2.2, radialScale);
      matrix.compose(position, quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color);
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [batch]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, batch.heads.length]}
      userData={{
        renderBatchKey: batch.key,
        instanceSemantics: batch.heads.map(({ ownerId, elementId, interactionKey, edgeId }) => ({
          ownerId,
          elementId,
          interactionKey,
          edgeId,
        })),
      }}
    >
      {batch.kind === "arrow"
        ? <coneGeometry args={[0.5, 1, 12]} />
        : <octahedronGeometry args={[0.5, 0]} />}
      <meshStandardMaterial
        transparent={batch.opacity < 1}
        opacity={batch.opacity}
        roughness={0.62}
        metalness={0.1}
      />
    </instancedMesh>
  );
}

export function GraphEdgeLayer({ plan }: GraphEdgeLayerProps) {
  return (
    <group name="graph-edge-layer">
      {plan.batches.map((batch) => <EdgeBatch key={batch.key} batch={batch} />)}
      {plan.headBatches.map((batch) => <HeadBatch key={batch.key} batch={batch} />)}
    </group>
  );
}
