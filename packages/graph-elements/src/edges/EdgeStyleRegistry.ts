import type { EdgeVisualDescriptor } from "@gitinspect/contracts";
import type {
  EdgeHead,
  EdgeLinePattern,
  EdgePathForm,
  ResolvedEdgeStyle,
} from "../rendering/types";

export interface EdgeStyleDefinition {
  readonly pattern?: EdgeLinePattern;
  readonly animated?: boolean;
  readonly animationSpeed?: number;
  readonly widthScale?: number;
  readonly opacityScale?: number;
  readonly dashSize?: number;
  readonly gapSize?: number;
  readonly pathForm?: EdgePathForm;
  readonly waveAmplitude?: number;
  readonly waveFrequency?: number;
  readonly waveSegments?: number;
  readonly head?: EdgeHead;
  readonly headScale?: number;
}

const BASE_STYLE: Required<EdgeStyleDefinition> = {
  pattern: "solid",
  animated: false,
  animationSpeed: 0.8,
  widthScale: 1,
  opacityScale: 1,
  dashSize: 0.8,
  gapSize: 0.5,
  pathForm: "straight",
  waveAmplitude: 0.22,
  waveFrequency: 2,
  waveSegments: 12,
  head: "none",
  headScale: 1,
};

export const DEFAULT_EDGE_STYLES: Readonly<Record<string, EdgeStyleDefinition>> = {
  solid: {},
  dashed: { pattern: "dashed" },
  dotted: { pattern: "dotted", dashSize: 0.08, gapSize: 0.2 },
  flow: { pattern: "dashed", animated: true, animationSpeed: 1.1 },
  wavy: { pathForm: "wavy" },
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function normalizeDefinition(
  definition: EdgeStyleDefinition | undefined,
): Required<EdgeStyleDefinition> {
  return { ...BASE_STYLE, ...definition };
}

export class EdgeStyleRegistry {
  readonly #styles: ReadonlyMap<string, EdgeStyleDefinition>;
  readonly #fallbackStyleId: string;

  constructor(
    styles: Readonly<Record<string, EdgeStyleDefinition>> = DEFAULT_EDGE_STYLES,
    fallbackStyleId = "solid",
  ) {
    this.#styles = new Map(Object.entries(styles));
    this.#fallbackStyleId = fallbackStyleId;
  }

  has(styleId: string): boolean {
    return this.#styles.has(styleId);
  }

  get(styleId: string): EdgeStyleDefinition | undefined {
    return this.#styles.get(styleId);
  }

  withStyle(styleId: string, definition: EdgeStyleDefinition): EdgeStyleRegistry {
    return new EdgeStyleRegistry(
      Object.fromEntries([...this.#styles.entries(), [styleId, definition]]),
      this.#fallbackStyleId,
    );
  }

  resolve(descriptor: EdgeVisualDescriptor): ResolvedEdgeStyle {
    const registryStyleId = this.#styles.has(descriptor.style)
      ? descriptor.style
      : this.#fallbackStyleId;
    const definition = normalizeDefinition(this.#styles.get(registryStyleId));
    const pattern =
      descriptor.dashed === undefined ? definition.pattern : descriptor.dashed ? "dashed" : "solid";
    const animated = descriptor.animated ?? definition.animated;
    const head = descriptor.head ?? definition.head;

    return {
      registryStyleId,
      color: descriptor.color,
      width: Math.max(0.01, descriptor.width * Math.max(0.01, definition.widthScale)),
      opacity: clamp((descriptor.opacity ?? 1) * definition.opacityScale, 0, 1),
      pattern,
      animated,
      animationSpeed: Math.max(0, definition.animationSpeed),
      dashSize: Math.max(0.001, definition.dashSize),
      gapSize: Math.max(0.001, definition.gapSize),
      pathForm: definition.pathForm,
      waveAmplitude: Math.max(0, definition.waveAmplitude),
      waveFrequency: Math.max(0, definition.waveFrequency),
      waveSegments: Math.max(2, Math.round(definition.waveSegments)),
      head,
      headScale: Math.max(0.01, definition.headScale),
    };
  }
}

export const defaultEdgeStyleRegistry = new EdgeStyleRegistry();
