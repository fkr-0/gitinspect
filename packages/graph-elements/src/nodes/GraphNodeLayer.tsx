import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Color, InstancedMesh, Matrix4, Vector3 } from "three";
import type { NodeRenderPlan, PlannedNodeBatch, PlannedNodeLabel } from "../rendering/types";

export interface GraphNodeLayerProps {
  readonly plan: NodeRenderPlan;
  readonly renderLabel?: (label: PlannedNodeLabel) => ReactNode;
}

function PrimitiveGeometry({ primitive }: Pick<PlannedNodeBatch, "primitive">) {
  switch (primitive) {
    case "box":
      return <boxGeometry args={[1, 1, 1]} />;
    case "sphere":
      return <sphereGeometry args={[0.5, 20, 12]} />;
    case "plane":
      return <planeGeometry args={[1, 1]} />;
    case "cylinder":
      return <cylinderGeometry args={[0.5, 0.5, 1, 16]} />;
    case "octahedron":
      return <octahedronGeometry args={[0.5, 0]} />;
    case "torus":
      return <torusGeometry args={[0.35, 0.15, 10, 24]} />;
  }
}

function NodeBatch({ batch }: { readonly batch: PlannedNodeBatch }) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;

    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const color = new Color();

    batch.instances.forEach((instance, index) => {
      position.set(...instance.position);
      scale.set(...instance.scale);
      matrix.identity().compose(position, mesh.quaternion, scale);
      mesh.setMatrixAt(index, matrix);
      mesh.setColorAt(index, color.set(instance.color));
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [batch]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, batch.instances.length]}
      frustumCulled
      userData={{
        renderBatchKey: batch.key,
        instanceSemantics: batch.instances.map(({ ownerId, elementId, interactionKey }) => ({
          ownerId,
          elementId,
          interactionKey,
        })),
      }}
    >
      <PrimitiveGeometry primitive={batch.primitive} />
      <meshStandardMaterial
        transparent={batch.opacity < 1}
        opacity={batch.opacity}
        emissive={batch.emissive}
        roughness={0.68}
        metalness={0.08}
      />
    </instancedMesh>
  );
}

export function GraphNodeLayer({ plan, renderLabel }: GraphNodeLayerProps) {
  return (
    <group name="graph-node-layer">
      {plan.batches.map((batch) => <NodeBatch key={batch.key} batch={batch} />)}
      {plan.labels.map((label) => renderLabel
        ? <group key={`${label.ownerId}:${label.elementId}`}>{renderLabel(label)}</group>
        : (
          <group
            key={`${label.ownerId}:${label.elementId}`}
            name="graph-label-placeholder"
            position={label.position}
            userData={{
              ownerId: label.ownerId,
              elementId: label.elementId,
              interactionKey: label.interactionKey,
              text: label.text,
              metadata: label.metadata,
            }}
          />
        ))}
    </group>
  );
}
