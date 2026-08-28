import {
  DEFAULT_EDGE_STYLES,
  EdgeStyleRegistry,
  type EdgeStyleDefinition,
} from "@gitinspect/graph-elements";

export interface GitVisualTheme {
  readonly commit: {
    readonly plate: string;
    readonly mergePlate: string;
    readonly stationCore: string;
    readonly historyPort: string;
    readonly mergePort: string;
    readonly textChange: string;
    readonly binaryChange: string;
    readonly tagShell: string;
    readonly localBranchIndicator: string;
    readonly remoteBranchIndicator: string;
    readonly signature: Readonly<Record<"valid" | "invalid" | "unknown" | "unsigned", string>>;
  };
  readonly ref: {
    readonly local: string;
    readonly remote: string;
    readonly tag: string;
    readonly stash: string;
    readonly tracking: string;
  };
  readonly remote: {
    readonly platform: string;
    readonly beacon: string;
  };
  readonly head: string;
  readonly unresolved: string;
  readonly focus: {
    readonly selected: string;
    readonly neighbor: string;
  };
  readonly edge: {
    readonly history: string;
    readonly activeHistory: string;
    readonly merge: string;
    readonly branch: string;
    readonly tag: string;
    readonly stash: string;
    readonly tracking: string;
    readonly remoteMembership: string;
    readonly head: string;
  };
}

export const DEFAULT_GIT_VISUAL_THEME: GitVisualTheme = Object.freeze({
  commit: {
    plate: "#62707f",
    mergePlate: "#7a8794",
    stationCore: "#c6d4dc",
    historyPort: "#91a7b8",
    mergePort: "#d5b0ff",
    textChange: "#e8c353",
    binaryChange: "#aa72de",
    tagShell: "#66d7d1",
    localBranchIndicator: "#6fcf97",
    remoteBranchIndicator: "#72a7ff",
    signature: {
      valid: "#5fd49d",
      invalid: "#ef6d75",
      unknown: "#e3b95e",
      unsigned: "#7d8794",
    },
  },
  ref: {
    local: "#6fcf97",
    remote: "#72a7ff",
    tag: "#5ed6ce",
    stash: "#c49cf5",
    tracking: "#85c8ff",
  },
  remote: {
    platform: "#334a62",
    beacon: "#76d6ff",
  },
  head: "#fff17a",
  unresolved: "#77818c",
  focus: {
    selected: "#fff3a0",
    neighbor: "#9cf2cb",
  },
  edge: {
    history: "#718599",
    activeHistory: "#9cf2cb",
    merge: "#a7b3c3",
    branch: "#64c990",
    tag: "#61d8d0",
    stash: "#bd95e8",
    tracking: "#78bfff",
    remoteMembership: "#546e87",
    head: "#fff17a",
  },
});

export const GIT_EDGE_STYLE_DEFINITIONS: Readonly<Record<string, EdgeStyleDefinition>> =
  Object.freeze({
    ...DEFAULT_EDGE_STYLES,
    "git-history": {
      pathForm: "polyline",
      pattern: "solid",
      head: "none",
    },
    "git-active-history": {
      pathForm: "polyline",
      pattern: "solid",
      widthScale: 1.08,
      head: "arrow",
      headScale: 0.86,
    },
    "git-merge": {
      pathForm: "polyline",
      pattern: "solid",
      widthScale: 1,
      head: "arrow",
      headScale: 0.78,
    },
    "git-branch-pointer": {
      pathForm: "polyline",
      pattern: "dashed",
      dashSize: 0.48,
      gapSize: 0.28,
      head: "arrow",
    },
    "git-tag-pointer": {
      pathForm: "polyline",
      pattern: "dotted",
      dashSize: 0.08,
      gapSize: 0.18,
      head: "diamond",
      headScale: 0.9,
    },
    "git-stash": {
      pattern: "dashed",
      pathForm: "wavy",
      waveAmplitude: 0.3,
      waveFrequency: 2.5,
      waveSegments: 16,
      head: "arrow",
    },
    "git-tracking": {
      pathForm: "polyline",
      pattern: "dashed",
      animated: true,
      animationSpeed: 1.25,
      dashSize: 0.36,
      gapSize: 0.28,
      head: "none",
    },
    "git-remote-membership": {
      pathForm: "polyline",
      pattern: "dashed",
      dashSize: 0.3,
      gapSize: 0.4,
      head: "arrow",
      headScale: 0.65,
    },
    "git-head": {
      pathForm: "polyline",
      pattern: "dashed",
      animated: true,
      animationSpeed: 1.6,
      dashSize: 0.24,
      gapSize: 0.2,
      head: "arrow",
      headScale: 1.05,
    },
  });

export function createGitEdgeStyleRegistry(): EdgeStyleRegistry {
  return new EdgeStyleRegistry(GIT_EDGE_STYLE_DEFINITIONS);
}

export const gitEdgeStyleRegistry = createGitEdgeStyleRegistry();
