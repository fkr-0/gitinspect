import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { GraphNodeRecord } from "@gitinspect/graph-elements";

import { GraphViewport } from "./components/GraphViewport";
import { repositorySnapshotToGraphDataset } from "./domain/graphAdapter";
import {
  createDemoRepositoryService,
  type RepositoryService,
} from "./services/repository";
import { initialStudioState, studioReducer } from "./state/studio";

interface AppProps {
  readonly repositoryService?: RepositoryService;
  readonly autoOpenDemo?: boolean;
}

function shortLabel(node: GraphNodeRecord): string {
  if (node.kind === "commit") {
    const oid = node.properties.oid;
    return typeof oid === "string" ? oid.slice(0, 9) : node.id.slice(0, 9);
  }
  return node.label ?? node.id;
}

function formatProperty(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined) return "—";
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

export function App({ repositoryService, autoOpenDemo = true }: AppProps) {
  const fallbackService = useMemo(() => createDemoRepositoryService(), []);
  const service = repositoryService ?? fallbackService;
  const [state, dispatch] = useReducer(studioReducer, initialStudioState);

  const openRepository = useCallback(
    async (path: string) => {
      dispatch({ type: "repositoryLoading", path });
      try {
        const session = await service.openRepository(path);
        dispatch({
          type: "repositoryLoaded",
          session,
          dataset: repositorySnapshotToGraphDataset(session.snapshot),
        });
      } catch (error) {
        dispatch({
          type: "repositoryFailed",
          message: error instanceof Error ? error.message : "Repository open failed.",
        });
      }
    },
    [service],
  );

  useEffect(() => {
    if (autoOpenDemo && service.mode === "demo") {
      void openRepository(initialStudioState.repositoryPath);
    }
  }, [autoOpenDemo, openRepository, service.mode]);

  const selectedNode = state.dataset?.nodes.find(
    (node) => node.id === state.selectedElementId,
  );
  const searchNeedle = state.search.trim().toLocaleLowerCase();
  const visibleNodes = (state.dataset?.nodes ?? []).filter((node) => {
    if (!searchNeedle) return true;
    return [node.label, node.kind, node.id]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(searchNeedle));
  });

  const chooseRepository = async (mode: "folder" | "file") => {
    const path = await service.chooseRepositoryPath({
      mode,
      expectedKind: mode === "folder" ? "worktree" : "git-dir",
    });
    if (path) {
      dispatch({ type: "pathChanged", path });
      await openRepository(path);
    }
  };

  return (
    <main className="studio-shell" data-testid="studio-shell">
      <header className="topbar">
        <div className="brand" aria-label="gitinspect">
          <span className="brand__mark">gi</span>
          <div>
            <strong>gitinspect</strong>
            <span>repository spatial studio</span>
          </div>
        </div>

        <form
          className="repository-open"
          onSubmit={(event) => {
            event.preventDefault();
            void openRepository(state.repositoryPath);
          }}
        >
          <label className="sr-only" htmlFor="repository-path">
            Repository path
          </label>
          <span className="repository-open__prefix">repo</span>
          <input
            id="repository-path"
            value={state.repositoryPath}
            onChange={(event) =>
              dispatch({ type: "pathChanged", path: event.currentTarget.value })
            }
            spellCheck={false}
            autoComplete="off"
          />
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void chooseRepository("folder")}
          >
            Folder…
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void chooseRepository("file")}
          >
            File…
          </button>
          <button type="submit" className="button button--primary" disabled={state.status === "loading"}>
            {state.status === "loading" ? "Opening…" : "Open"}
          </button>
        </form>

        <div className="runtime-badge" data-mode={service.mode}>
          <span className="runtime-badge__dot" />
          {service.mode === "demo" ? "synthetic adapter" : "native adapter"}
        </div>
      </header>

      <div className="modebar">
        <div className="segmented" aria-label="Pointer mode">
          {(["camera", "cursor"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.pointerMode === mode}
              onClick={() => dispatch({ type: "pointerModeChanged", mode })}
            >
              {mode === "camera" ? "Camera" : "Cursor"}
            </button>
          ))}
        </div>
        <div className="modebar__divider" />
        <div className="segmented" aria-label="Camera controller mode">
          {(["attached", "free-flight"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={state.cameraMode === mode}
              onClick={() => dispatch({ type: "cameraModeChanged", mode })}
            >
              {mode === "attached" ? "Attached" : "Free flight"}
            </button>
          ))}
        </div>
        <span className="modebar__hint">{state.pointerMode === "cursor" ? "semantic picking active" : "viewport navigation active"}</span>
        <button
          type="button"
          className="tray-toggle"
          aria-expanded={state.transactionTrayOpen}
          onClick={() => dispatch({ type: "transactionTrayToggled" })}
        >
          Transaction tray <span>0</span>
        </button>
      </div>

      <div className="workspace">
        <aside className="sidebar sidebar--left">
          <div className="panel-heading">
            <span className="eyebrow">Repository</span>
            <strong>{state.session ? state.session.snapshot.repositoryPath.split("/").filter(Boolean).at(-1) : "not loaded"}</strong>
            <span className="panel-heading__meta">
              {state.session ? state.session.snapshot.revision : "no revision"}
            </span>
          </div>

          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={state.search}
              onChange={(event) => dispatch({ type: "searchChanged", search: event.currentTarget.value })}
              placeholder="Search graph…"
            />
            {state.search && (
              <button type="button" onClick={() => dispatch({ type: "searchChanged", search: "" })} aria-label="Clear search">
                ×
              </button>
            )}
          </label>

          <div className="object-list" aria-label="Repository elements">
            {visibleNodes.slice(0, 48).map((node) => (
              <button
                type="button"
                key={node.id}
                className="object-list__row"
                aria-pressed={node.id === state.selectedElementId}
                onClick={() => dispatch({ type: "elementSelected", elementId: node.id })}
              >
                <span className="object-list__glyph">{node.kind.slice(0, 1).toUpperCase()}</span>
                <span className="object-list__copy">
                  <strong>{node.label ?? node.kind}</strong>
                  <small>{shortLabel(node)}</small>
                </span>
              </button>
            ))}
            {state.dataset && visibleNodes.length === 0 && (
              <p className="empty-copy">No graph elements match “{state.search}”.</p>
            )}
          </div>

          <div className="sidebar__stats">
            <span><strong>{state.session?.snapshot.commits.length ?? 0}</strong> commits</span>
            <span><strong>{state.session?.snapshot.refs.length ?? 0}</strong> refs</span>
            <span><strong>{state.session?.snapshot.remotes.length ?? 0}</strong> remotes</span>
          </div>
        </aside>

        <GraphViewport
          dataset={state.dataset}
          selectedElementId={state.selectedElementId}
          search={state.search}
          onSelect={(elementId) => dispatch({ type: "elementSelected", elementId })}
        />

        <aside className="sidebar sidebar--right">
          <div className="panel-heading panel-heading--inspection">
            <span className="eyebrow">Inspector</span>
            <strong>{selectedNode?.label ?? "Select an element"}</strong>
            <span className="kind-chip">{selectedNode?.kind ?? "—"}</span>
          </div>

          {selectedNode ? (
            <div className="inspection">
              <section>
                <h2>Identity</h2>
                <dl>
                  <div><dt>Element</dt><dd>{selectedNode.id}</dd></div>
                  <div><dt>Group</dt><dd>{selectedNode.group ?? "—"}</dd></div>
                  <div><dt>Weight</dt><dd>{selectedNode.weight ?? "—"}</dd></div>
                </dl>
              </section>
              <section>
                <h2>Properties</h2>
                <dl>
                  {Object.entries(selectedNode.properties).map(([key, value]) => (
                    <div key={key}><dt>{key}</dt><dd>{formatProperty(value)}</dd></div>
                  ))}
                </dl>
              </section>
              <section className="inspection__future">
                <span className="eyebrow">Phase 4 seam</span>
                <p>Lazy diffs, domain actions, and full Git object details attach here without changing the viewport contract.</p>
              </section>
            </div>
          ) : (
            <div className="inspector-empty">
              <span>＋</span>
              <strong>Nothing inspected</strong>
              <p>Use cursor mode to select a semantic element in the world.</p>
            </div>
          )}
        </aside>
      </div>

      {state.error && (
        <div className="error-banner" role="alert">
          <strong>Repository open failed</strong>
          <span>{state.error}</span>
        </div>
      )}

      <section className="transaction-tray" data-open={state.transactionTrayOpen || undefined} aria-label="Transaction tray">
        <div>
          <span className="eyebrow">Mutation staging</span>
          <strong>No operations staged</strong>
          <p>Phase 3 keeps mutation UI inert. Preview and apply wiring remain deliberately unavailable.</p>
        </div>
        <div className="transaction-tray__pipeline" aria-label="Transaction lifecycle preview">
          {[
            "draft",
            "validate",
            "preview",
            "confirm",
            "apply",
          ].map((stage, index) => (
            <span key={stage} data-active={index === 0 || undefined}>{stage}</span>
          ))}
        </div>
        <div className="transaction-tray__actions">
          <button type="button" className="button button--ghost" disabled>Preview draft</button>
          <button type="button" className="button button--danger" disabled>Apply to repository</button>
        </div>
      </section>

      <footer className="statusbar">
        <span><i data-state={state.status} /> {state.status}</span>
        <span>{state.session?.snapshot.head ?? "HEAD unavailable"}</span>
        <span className="statusbar__spacer" />
        <span>{state.cameraMode}</span>
        <span>{state.pointerMode}</span>
        <span>schema v{state.session?.snapshot.schemaVersion ?? 1}</span>
      </footer>
    </main>
  );
}
