const SELECTION_PARAM = "selection";
const MAX_SELECTION_URL_ID_LENGTH = 4_096;
const CHILD_WORLD_PARAM = "world";
const CHILD_TARGET_PARAM = "worldTarget";
const CHILD_SELECTION_PARAM = "worldSelection";
const MAX_CHILD_URL_ID_LENGTH = 4_096;
// Identifiers are opaque, but navigation must not preserve invisible directional,
// terminal-control, or separator-spoofing characters from hostile repositories.
const UNSAFE_URL_ID_CHAR = /[\u200b-\u200f\u202a-\u202e\u2060-\u206f\u2044\u2215\uff0f\uff3c]/u;
function safeId(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    ![...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return point <= 0x1f || (point >= 0x7f && point <= 0x9f);
    }) &&
    !UNSAFE_URL_ID_CHAR.test(value)
  );
}
function singleParam(params: URLSearchParams, key: string): boolean {
  return params.getAll(key).length <= 1;
}
const CHILD_HISTORY_STATE_KEY = "gitinspectChildNavigation";
const CHILD_HISTORY_STATE_VERSION = 1;

export type ChildNavigationUrlState =
  | {
      readonly depth: 1;
      readonly localSelectionId?: string;
    }
  | {
      readonly depth: 2;
      readonly fileElementId: string;
      readonly localSelectionId?: string;
    };

export type ChildNavigationUrlParse =
  | { readonly status: "none" }
  | { readonly status: "valid"; readonly state: ChildNavigationUrlState }
  | { readonly status: "invalid"; readonly message: string };

export interface ChildNavigationHistoryState {
  readonly gitinspectChildNavigation: {
    readonly version: 1;
    readonly depth: 1 | 2;
  };
}

export function childNavigationHistoryState(depth: 1 | 2): ChildNavigationHistoryState {
  return Object.freeze({
    [CHILD_HISTORY_STATE_KEY]: Object.freeze({
      version: CHILD_HISTORY_STATE_VERSION,
      depth,
    }),
  });
}

export function childNavigationHistoryDepth(state: unknown): 1 | 2 | undefined {
  if (typeof state !== "object" || state === null) return undefined;
  const marker = (state as Readonly<Record<string, unknown>>)[CHILD_HISTORY_STATE_KEY];
  if (typeof marker !== "object" || marker === null) return undefined;
  const record = marker as Readonly<Record<string, unknown>>;
  if (Object.keys(record).some((key) => key !== "version" && key !== "depth")) return undefined;
  if (record.version !== CHILD_HISTORY_STATE_VERSION) return undefined;
  return record.depth === 1 || record.depth === 2 ? record.depth : undefined;
}

export function selectionFromHref(href: string): string | undefined {
  try {
    const value = new URL(href).searchParams.get(SELECTION_PARAM)?.trim();
    return singleParam(new URL(href).searchParams, SELECTION_PARAM) &&
      safeId(value, MAX_SELECTION_URL_ID_LENGTH)
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function hrefWithSelection(href: string, elementId: string | undefined): string {
  const url = new URL(href);
  const normalizedElementId = elementId?.trim();
  if (safeId(normalizedElementId, MAX_SELECTION_URL_ID_LENGTH)) {
    url.searchParams.set(SELECTION_PARAM, normalizedElementId);
  } else {
    url.searchParams.delete(SELECTION_PARAM);
  }
  return url.toString();
}

function boundedChildId(
  params: URLSearchParams,
  key: string,
):
  | { readonly status: "missing" }
  | { readonly status: "valid"; readonly value: string }
  | {
      readonly status: "invalid";
      readonly message: string;
    } {
  if (!params.has(key)) return { status: "missing" };
  if (!singleParam(params, key)) return { status: "invalid", message: `${key} must occur once.` };
  const value = params.get(key)?.trim() ?? "";
  if (value.length === 0) {
    return { status: "invalid", message: `${key} must not be empty.` };
  }
  if (value.length > MAX_CHILD_URL_ID_LENGTH) {
    return {
      status: "invalid",
      message: `${key} exceeds the ${MAX_CHILD_URL_ID_LENGTH}-character child-navigation limit.`,
    };
  }
  if (!safeId(value, MAX_CHILD_URL_ID_LENGTH)) {
    return { status: "invalid", message: `${key} contains unsafe characters.` };
  }
  return { status: "valid", value };
}

export function childNavigationFromHref(href: string): ChildNavigationUrlParse {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return { status: "invalid", message: "Child-navigation URL could not be parsed." };
  }

  const params = url.searchParams;
  if (
    [CHILD_WORLD_PARAM, CHILD_TARGET_PARAM, CHILD_SELECTION_PARAM].some(
      (key) => !singleParam(params, key),
    ) ||
    [...params.keys()].some(
      (key) =>
        key.startsWith("world") &&
        ![CHILD_WORLD_PARAM, CHILD_TARGET_PARAM, CHILD_SELECTION_PARAM].includes(key),
    )
  ) {
    return { status: "invalid", message: "Duplicate or unknown child-navigation parameter." };
  }
  const hasWorld = params.has(CHILD_WORLD_PARAM);
  const world = params.get(CHILD_WORLD_PARAM)?.trim();
  const hasTarget = params.has(CHILD_TARGET_PARAM);
  const hasSelection = params.has(CHILD_SELECTION_PARAM);
  if (!world) {
    return hasWorld || hasTarget || hasSelection
      ? {
          status: "invalid",
          message: "Child-navigation target/selection requires an explicit world.",
        }
      : { status: "none" };
  }

  const localSelection = boundedChildId(params, CHILD_SELECTION_PARAM);
  if (localSelection.status === "invalid") return localSelection;

  if (world === "commit") {
    if (hasTarget) {
      return {
        status: "invalid",
        message: "Commit-world URLs must not contain a file-world target.",
      };
    }
    return {
      status: "valid",
      state: {
        depth: 1,
        ...(localSelection.status === "valid" ? { localSelectionId: localSelection.value } : {}),
      },
    };
  }

  if (world === "file") {
    const target = boundedChildId(params, CHILD_TARGET_PARAM);
    if (target.status === "missing") {
      return { status: "invalid", message: "File-world URL is missing worldTarget." };
    }
    if (target.status === "invalid") return target;
    return {
      status: "valid",
      state: {
        depth: 2,
        fileElementId: target.value,
        ...(localSelection.status === "valid" ? { localSelectionId: localSelection.value } : {}),
      },
    };
  }

  return {
    status: "invalid",
    message: "Unsupported child-navigation world.",
  };
}

export function hrefWithChildNavigation(
  href: string,
  state: ChildNavigationUrlState | undefined,
): string {
  const url = new URL(href);
  url.searchParams.delete(CHILD_WORLD_PARAM);
  url.searchParams.delete(CHILD_TARGET_PARAM);
  url.searchParams.delete(CHILD_SELECTION_PARAM);

  if (!state) return url.toString();
  const serializableIds =
    (state.localSelectionId === undefined ||
      safeId(state.localSelectionId, MAX_CHILD_URL_ID_LENGTH)) &&
    (state.depth === 1 ||
      (state.depth === 2 && safeId(state.fileElementId, MAX_CHILD_URL_ID_LENGTH)));
  if (!serializableIds) return url.toString();
  if (state.depth === 1) {
    url.searchParams.set(CHILD_WORLD_PARAM, "commit");
  } else {
    url.searchParams.set(CHILD_WORLD_PARAM, "file");
    url.searchParams.set(CHILD_TARGET_PARAM, state.fileElementId);
  }
  if (state.localSelectionId) {
    url.searchParams.set(CHILD_SELECTION_PARAM, state.localSelectionId);
  }
  return url.toString();
}
