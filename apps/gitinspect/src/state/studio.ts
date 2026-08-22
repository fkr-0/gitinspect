import type { GraphDataset } from "@gitinspect/graph-elements";

import type { RepositorySession } from "../services/repository";

export type PointerMode = "camera" | "cursor";
export type StudioCameraMode = "attached" | "free-flight";

export interface StudioState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly repositoryPath: string;
  readonly session: RepositorySession | undefined;
  readonly dataset: GraphDataset | undefined;
  readonly selectedElementId: string | undefined;
  readonly cameraMode: StudioCameraMode;
  readonly pointerMode: PointerMode;
  readonly search: string;
  readonly transactionTrayOpen: boolean;
  readonly error: string | undefined;
}

export type StudioAction =
  | { readonly type: "pathChanged"; readonly path: string }
  | { readonly type: "repositoryLoading"; readonly path: string }
  | {
      readonly type: "repositoryLoaded";
      readonly session: RepositorySession;
      readonly dataset: GraphDataset;
    }
  | { readonly type: "repositoryFailed"; readonly message: string }
  | { readonly type: "elementSelected"; readonly elementId?: string }
  | { readonly type: "cameraModeChanged"; readonly mode: StudioCameraMode }
  | { readonly type: "pointerModeChanged"; readonly mode: PointerMode }
  | { readonly type: "searchChanged"; readonly search: string }
  | { readonly type: "transactionTrayToggled" };

export const initialStudioState: StudioState = {
  status: "idle",
  repositoryPath: "/demo/gitinspect",
  cameraMode: "attached",
  pointerMode: "cursor",
  search: "",
  transactionTrayOpen: false,
  session: undefined,
  dataset: undefined,
  selectedElementId: undefined,
  error: undefined,
};

export function studioReducer(state: StudioState, action: StudioAction): StudioState {
  switch (action.type) {
    case "pathChanged":
      return { ...state, repositoryPath: action.path };
    case "repositoryLoading":
      return {
        ...state,
        status: "loading",
        repositoryPath: action.path,
        error: undefined,
      };
    case "repositoryLoaded": {
      const selectionStillExists = action.dataset.nodes.some(
        (node) => node.id === state.selectedElementId,
      );
      return {
        ...state,
        status: "ready",
        repositoryPath: action.session.snapshot.repositoryPath,
        session: action.session,
        dataset: action.dataset,
        selectedElementId: selectionStillExists
          ? state.selectedElementId
          : action.dataset.nodes[0]?.id,
        error: undefined,
      };
    }
    case "repositoryFailed":
      return {
        ...state,
        status: "error",
        error: action.message,
      };
    case "elementSelected":
      return { ...state, selectedElementId: action.elementId };
    case "cameraModeChanged":
      return { ...state, cameraMode: action.mode };
    case "pointerModeChanged":
      return { ...state, pointerMode: action.mode };
    case "searchChanged":
      return { ...state, search: action.search };
    case "transactionTrayToggled":
      return { ...state, transactionTrayOpen: !state.transactionTrayOpen };
  }
}
