import type { ElementId, GraphDataset, Vec3 } from "@gitinspect/graph-elements";

import {
  GitSearchIndex,
  createSearchHighlightOverlay,
  type GitFilterOutcome,
  type GitSearchFilters,
  type GitSearchHighlightOverlay,
  type GitSearchOutcome,
  type GitSearchQuery,
} from "../search/gitSearch";
import { GitScalePlanner, type GitScaleModel, type GitScalePlannerOptions } from "./gitScale";

export interface GitWorldScaleSearchInput {
  readonly dataset: GraphDataset;
  readonly camera: { readonly position: Vec3 };
  readonly search?: Omit<GitSearchQuery, "filters">;
  readonly filters?: GitSearchFilters;
  readonly selectedIds?: ReadonlySet<ElementId>;
  readonly hoveredIds?: ReadonlySet<ElementId>;
}

export interface GitWorldScaleSearchModel {
  readonly scale: GitScaleModel;
  readonly search: GitSearchOutcome | undefined;
  readonly filter: GitFilterOutcome | undefined;
  readonly highlights: GitSearchHighlightOverlay;
}

function hasSearchText(
  query: GitWorldScaleSearchInput["search"],
): query is Omit<GitSearchQuery, "filters"> & { readonly text: string } {
  return typeof query?.text === "string" && query.text.trim().length > 0;
}

const EMPTY_HIGHLIGHTS: GitSearchHighlightOverlay = Object.freeze({
  hitIds: new Set<ElementId>(),
  byId: new Map(),
});

/**
 * App-local orchestration seam for Phase-5 UI integration.
 *
 * The logical dataset stays authoritative for inspection/search. Filters produce
 * a full logical-ID set, search results remain independently bounded, and only
 * the derived scale projection is intended for GraphWorld rendering.
 */
export class GitWorldScaleSearchAdapter {
  private readonly searchIndex = new GitSearchIndex();
  private readonly scalePlanner: GitScalePlanner;

  constructor(options: GitScalePlannerOptions = {}) {
    this.scalePlanner = new GitScalePlanner(options);
  }

  project(input: GitWorldScaleSearchInput): GitWorldScaleSearchModel {
    const filter = input.filters
      ? this.searchIndex.filter(input.dataset, input.filters)
      : undefined;
    const search = hasSearchText(input.search)
      ? this.searchIndex.search(input.dataset, {
          ...input.search,
          ...(input.filters ? { filters: input.filters } : {}),
        })
      : undefined;
    const highlights = search ? createSearchHighlightOverlay(search) : EMPTY_HIGHLIGHTS;
    const scale = this.scalePlanner.plan({
      dataset: input.dataset,
      camera: input.camera,
      ...(input.selectedIds ? { selectedIds: input.selectedIds } : {}),
      ...(input.hoveredIds ? { hoveredIds: input.hoveredIds } : {}),
      ...(search ? { searchHitIds: search.hitIds } : {}),
      ...(filter ? { includedIds: filter.ids } : {}),
    });
    return Object.freeze({ scale, search, filter, highlights });
  }
}
