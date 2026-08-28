import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Color, type InstancedMesh, Matrix4, Vector3 } from "three";
import type { ModifierState, PickReference } from "../interaction";
import type {
  NodeRenderPlan,
  PlannedNodeBatch,
  PlannedNodeLabel,
  SemanticRenderIdentity,
} from "../rendering/types";

export interface GraphNodeInteractionEvent {
  readonly reference: PickReference;
  readonly identity: SemanticRenderIdentity;
  readonly modifiers: ModifierState;
}

export interface GraphNodeInteractionHandlers {
  readonly onClick?: (event: GraphNodeInteractionEvent) => void;
  readonly onContextMenu?: (event: GraphNodeInteractionEvent) => void;
  readonly onHoverChange?: (event: GraphNodeInteractionEvent | undefined) => void;
}

export interface GraphNodeLayerProps {
  readonly plan: NodeRenderPlan;
  readonly renderLabel?: (label: PlannedNodeLabel) => ReactNode;
  readonly interaction?: GraphNodeInteractionHandlers;
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

export function nodeInteractionForInstance(
  batch: PlannedNodeBatch,
  instanceId: number,
  modifiers: ModifierState = {},
): GraphNodeInteractionEvent | undefined {
  const identity = batch.instances[instanceId];
  if (!identity) return undefined;
  return {
    reference: { objectId: batch.key, instanceId },
    identity,
    modifiers,
  };
}

function semanticInteractionEvent(
  batch: PlannedNodeBatch,
  event: ThreeEvent<MouseEvent | PointerEvent>,
): GraphNodeInteractionEvent | undefined {
  const instanceId = event.instanceId;
  if (instanceId === undefined) return undefined;
  return nodeInteractionForInstance(batch, instanceId, {
    shift: event.nativeEvent.shiftKey,
    ctrl: event.nativeEvent.ctrlKey,
    meta: event.nativeEvent.metaKey,
    alt: event.nativeEvent.altKey,
  });
}

function NodeBatch({
  batch,
  interaction,
}: {
  readonly batch: PlannedNodeBatch;
  readonly interaction?: GraphNodeInteractionHandlers;
}) {
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
      {...(interaction?.onClick
        ? {
            onClick: (event: ThreeEvent<MouseEvent>) => {
              const semantic = semanticInteractionEvent(batch, event);
              if (!semantic) return;
              event.stopPropagation();
              interaction.onClick?.(semantic);
            },
          }
        : {})}
      {...(interaction?.onContextMenu
        ? {
            onContextMenu: (event: ThreeEvent<MouseEvent>) => {
              const semantic = semanticInteractionEvent(batch, event);
              if (!semantic) return;
              event.nativeEvent.preventDefault();
              event.stopPropagation();
              interaction.onContextMenu?.(semantic);
            },
          }
        : {})}
      {...(interaction?.onHoverChange
        ? {
            onPointerOver: (event: ThreeEvent<PointerEvent>) => {
              const semantic = semanticInteractionEvent(batch, event);
              if (!semantic) return;
              event.stopPropagation();
              interaction.onHoverChange?.(semantic);
            },
            onPointerOut: (event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation();
              interaction.onHoverChange?.(undefined);
            },
          }
        : {})}
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

export function GraphNodeLayer({ plan, renderLabel, interaction }: GraphNodeLayerProps) {
  return (
    <group name="graph-node-layer">
      {plan.batches.map((batch) => (
        <NodeBatch
          key={batch.key}
          batch={batch}
          {...(interaction === undefined ? {} : { interaction })}
        />
      ))}
      {plan.labels.map((label) =>
        renderLabel ? (
          <group key={`${label.ownerId}:${label.elementId}`}>{renderLabel(label)}</group>
        ) : (
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
        ),
      )}
    </group>
  );
}
