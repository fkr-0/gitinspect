import type { GraphDataset } from "@gitinspect/graph-elements";

import type { GitSearchFilters } from "../search/gitSearch";
import type { RepositorySession } from "../services/repository";

export type PointerMode = "camera" | "cursor";
export type StudioCameraMode = "attached" | "free-flight";

export interface StudioState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly repositoryPath: string;
  readonly session: RepositorySession | undefined;
  readonly dataset: GraphDataset | undefined;
  readonly selectedElementId: string | undefined;
  readonly selectionNotice: string | undefined;
  readonly cameraMode: StudioCameraMode;
  readonly pointerMode: PointerMode;
  readonly search: string;
  readonly searchFilters: GitSearchFilters;
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
      readonly preferredSelectionId?: string;
    }
  | { readonly type: "repositoryFailed"; readonly message: string }
  | { readonly type: "elementSelected"; readonly elementId?: string }
  | { readonly type: "selectionRejected"; readonly elementId: string; readonly message: string }
  | { readonly type: "cameraModeChanged"; readonly mode: StudioCameraMode }
  | { readonly type: "pointerModeChanged"; readonly mode: PointerMode }
  | { readonly type: "searchChanged"; readonly search: string }
  | { readonly type: "searchFiltersChanged"; readonly filters: GitSearchFilters }
  | { readonly type: "transactionTrayToggled" };

export const initialStudioState: StudioState = {
  status: "idle",
  repositoryPath: "/demo/gitinspect",
  cameraMode: "attached",
  pointerMode: "cursor",
  search: "",
  searchFilters: {},
  transactionTrayOpen: false,
  session: undefined,
  dataset: undefined,
  selectedElementId: undefined,
  selectionNotice: undefined,
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
      const previousSelection = state.selectedElementId;
      const selectionStillExists =
        previousSelection === undefined
          ? false
          : action.dataset.nodes.some((node) => node.id === previousSelection);
      const refreshingSameRepository = state.session?.key === action.session.key;
      const selectionDisappeared =
        refreshingSameRepository && previousSelection !== undefined && !selectionStillExists;
      const preferredSelectionExists =
        action.preferredSelectionId === undefined
          ? false
          : action.dataset.nodes.some((node) => node.id === action.preferredSelectionId);
      const preferredSelectionRejected =
        !refreshingSameRepository &&
        action.preferredSelectionId !== undefined &&
        !preferredSelectionExists;
      return {
        ...state,
        status: "ready",
        repositoryPath: action.session.snapshot.repositoryPath,
        session: action.session,
        dataset: action.dataset,
        selectedElementId: refreshingSameRepository
          ? selectionStillExists
            ? previousSelection
            : undefined
          : preferredSelectionExists
            ? action.preferredSelectionId
            : undefined,
        selectionNotice: selectionDisappeared
          ? `Selected element ${previousSelection} is no longer present after repository refresh.`
          : preferredSelectionRejected
            ? `URL selection is not present in the opened repository (${action.preferredSelectionId}).`
            : undefined,
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
      return { ...state, selectedElementId: action.elementId, selectionNotice: undefined };
    case "selectionRejected":
      return {
        ...state,
        selectedElementId: undefined,
        selectionNotice: `${action.message} (${action.elementId})`,
      };
    case "cameraModeChanged":
      return { ...state, cameraMode: action.mode };
    case "pointerModeChanged":
      return { ...state, pointerMode: action.mode };
    case "searchChanged":
      return { ...state, search: action.search };
    case "searchFiltersChanged":
      return { ...state, searchFilters: action.filters };
    case "transactionTrayToggled":
      return { ...state, transactionTrayOpen: !state.transactionTrayOpen };
  }
}
