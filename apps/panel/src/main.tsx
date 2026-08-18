import { StrictMode, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import "./styles.css";
import { createPanelApi, createPanelToolApi, PANEL_BOOTSTRAP_META_KEY, parsePanelBootstrap, SessionExpiredError, type PanelBootstrap, type PanelServerToolCall } from "./session";

export type InlineStatus = "captured" | "planned" | "in_progress" | "done";
export type InlineFilter = "all" | InlineStatus;
export const INLINE_ITEM_LIMIT = 5;
export const PANEL_ERROR_TITLE = "项目面板暂时不可用";
export const PANEL_ERROR_MESSAGE = "暂时无法加载项目面板，请稍后再试。";

export const STATUS_OPTIONS = [
  { value: "captured", label: "Backlog", cardLabel: "Captured", tone: "captured" },
  { value: "planned", label: "Todo", cardLabel: "Todo", tone: "planned" },
  { value: "in_progress", label: "In Progress", cardLabel: "In Progress", tone: "in-progress" },
  { value: "done", label: "Done", cardLabel: "Done", tone: "done" },
] as const satisfies ReadonlyArray<{ value: InlineStatus; label: string; cardLabel: string; tone: string }>;

export type Item = { id: string; identifier: string; title: string; description?: string; kind?: string; status?: string; dueDate?: string | null; url?: string; isSystemCreated?: boolean; archived?: boolean; updatedAt?: string };
export type Context = { id: string; canonicalCwd: string; planeProjectName?: string; planeProjectId: string; planeBaseUrl?: string; workspaceSlug?: string; autoCaptureEnabled: boolean };
export type Source = { eventId: string; eventType: string; summary: string; sourceExcerpt: string; sessionId: string; turnId: string; planeItemId?: string | null; createdAt: string; projectedAt?: string | null };
export type ProjectCounts = { total: number; byStatus: Record<InlineStatus, number> };
export type Summary = { context: Context; items: Item[]; projectCounts: ProjectCounts | null; sources: Source[]; failures: Array<{ batch_id: string; status: string; attempts: number; last_error?: string }> };
export type PanelApi = ReturnType<typeof createPanelApi>;

export type StatusOperation = {
  phase: "saving" | "synced" | "error";
  previousStatus: InlineStatus;
  nextStatus: InlineStatus;
  error?: string;
};

export function isInlineStatus(value: string | undefined): value is InlineStatus {
  return STATUS_OPTIONS.some((option) => option.value === value);
}

export function selectRelevantItems(items: Item[], sources: Source[] = [], filter: InlineFilter = "all"): Item[] {
  const latestProjectionByItem = new Map<string, number>();
  for (const source of sources) {
    if (!source.planeItemId || !source.projectedAt) continue;
    const projectedAt = Date.parse(source.projectedAt);
    latestProjectionByItem.set(source.planeItemId, Math.max(latestProjectionByItem.get(source.planeItemId) ?? 0, projectedAt));
  }
  const lastModifiedAt = (item: Item) => Math.max(Date.parse(item.updatedAt ?? "") || 0, latestProjectionByItem.get(item.id) ?? 0);
  const byRecent = (left: Item, right: Item) => lastModifiedAt(right) - lastModifiedAt(left);
  const eligibleItems = items.filter((item) => !item.archived && isInlineStatus(item.status));

  if (filter !== "all") return eligibleItems.filter((item) => item.status === filter).sort(byRecent).slice(0, INLINE_ITEM_LIMIT);

  const unfinishedGroups = (["in_progress", "planned", "captured"] as const).map((status) => eligibleItems.filter((item) => item.status === status).sort(byRecent));
  const unfinishedCount = unfinishedGroups.reduce((count, group) => count + group.length, 0);
  const done = eligibleItems.filter((item) => item.status === "done").sort(byRecent);
  const unfinishedLimit = unfinishedCount < 4 ? unfinishedCount : done.length ? 4 : INLINE_ITEM_LIMIT;
  const firstFromEachState = unfinishedGroups.flatMap((group) => group.slice(0, 1));
  const remainingUnfinished = unfinishedGroups.flatMap((group) => group.slice(1));
  const selectedUnfinished = [...firstFromEachState, ...remainingUnfinished.slice(0, unfinishedLimit - firstFromEachState.length)];
  const selectedDone = unfinishedCount >= 4 ? done.slice(0, 1) : done;
  return [...selectedUnfinished, ...selectedDone].slice(0, INLINE_ITEM_LIMIT);
}

export function filterVisibleItems(items: Item[], filter: InlineFilter): Item[] {
  return filter === "all" ? items : items.filter((item) => item.status === filter);
}

export function getStatusCounts(items: Item[]): Record<InlineStatus, number> {
  return STATUS_OPTIONS.reduce((counts, option) => {
    counts[option.value] = items.filter((item) => item.status === option.value).length;
    return counts;
  }, {} as Record<InlineStatus, number>);
}

export function moveProjectCount(counts: ProjectCounts, previousStatus: InlineStatus, nextStatus: InlineStatus): ProjectCounts {
  return { total: counts.total, byStatus: { ...counts.byStatus, [previousStatus]: counts.byStatus[previousStatus] - 1, [nextStatus]: counts.byStatus[nextStatus] + 1 } };
}

export function listSummary(filter: InlineFilter, visibleCount: number, counts: ProjectCounts | null): { title: string; detail: string } {
  const title = filter === "all" ? "相关工作项" : `${STATUS_OPTIONS.find((option) => option.value === filter)?.label} 相关工作项`;
  if (!counts) return { title, detail: `显示 ${visibleCount} / 项目计数暂不可用` };
  return { title, detail: `显示 ${visibleCount} / ${filter === "all" ? `项目共 ${counts.total}` : `该状态共 ${counts.byStatus[filter]}`}` };
}

export function updateItemStatus(items: Item[], itemId: string, status: InlineStatus): Item[] {
  return items.map((item) => item.id === itemId ? { ...item, status } : item);
}

export function projectPlaneUrl(context: Context): string {
  if (!context.planeBaseUrl || !context.workspaceSlug) return "#";
  const url = new URL(context.planeBaseUrl);
  if (url.hostname === "api.plane.so") url.hostname = "app.plane.so";
  url.pathname = `/${encodeURIComponent(context.workspaceSlug)}/projects/${encodeURIComponent(context.planeProjectId)}/issues`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

interface PanelSessionSetters {
  setSession: Dispatch<SetStateAction<PanelBootstrap | null>>;
  setApiClient: Dispatch<SetStateAction<PanelApi | null>>;
  setSessionError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
}

export function attachPanelSession(next: PanelBootstrap, expireSession: () => void, setters: PanelSessionSetters, apiFactory: (session: PanelBootstrap, onUnauthorized: () => void) => PanelApi = createPanelApi): void {
  setters.setSession(next);
  setters.setApiClient(() => apiFactory(next, expireSession));
  setters.setSessionError("");
  setters.setMessage("");
  setters.setLoading(true);
}

export function handlePanelToolResult(result: { isError?: boolean; _meta?: unknown }, attachSession: (next: PanelBootstrap) => void, setPanelUnavailable: (value: boolean) => void, setLoading: (value: boolean) => void): void {
  const next = result.isError ? null : parsePanelBootstrap(result._meta);
  if (!next) {
    setPanelUnavailable(true);
    setLoading(false);
    return;
  }
  setPanelUnavailable(false);
  attachSession(next);
}

export function panelRequestError(_error: unknown): string { return PANEL_ERROR_MESSAGE; }

export async function loadPanelSummary(apiClient: PanelApi, session: PanelBootstrap, sessionMode: "host" | "standalone", cwd: string, storedCwd: string | null): Promise<Summary> {
  if (sessionMode === "host") return await apiClient<Summary>(`/api/projects/${session.projectContextId}/summary`);
  const requestedCwd = cwd || storedCwd;
  if (!requestedCwd) throw new Error("Working directory is required; enter an explicit absolute path");
  const context = await apiClient<Context | null>(`/api/context?cwd=${encodeURIComponent(requestedCwd)}`);
  if (!context) throw new Error(`No project is bound to ${requestedCwd}`);
  return await apiClient<Summary>(`/api/projects/${context.id}/summary`);
}

function App() {
  const [cwd, setCwd] = useState("");
  const [session, setSession] = useState<PanelBootstrap | null>(null);
  const [sessionMode, setSessionMode] = useState<"host" | "standalone">("host");
  const [sessionError, setSessionError] = useState("");
  const [apiClient, setApiClient] = useState<PanelApi | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<InlineFilter>("all");
  const [message, setMessage] = useState("");
  const [panelUnavailable, setPanelUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<InlineStatus | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [statusOperations, setStatusOperations] = useState<Record<string, StatusOperation>>({});

  const expireSession = () => {
    setSession(null);
    setApiClient(null);
    setSummary(null);
    setLoading(false);
    setPanelUnavailable(true);
    setSessionError("");
  };
  const attachSession = (next: PanelBootstrap) => {
    setPanelUnavailable(false);
    attachPanelSession(next, expireSession, { setSession, setApiClient, setSessionError, setMessage, setLoading });
  };

  useEffect(() => {
    if (window.parent === window) {
      setSessionMode("standalone");
      setLoading(false);
      return;
    }
    const host = new McpApp({ name: "Ambient Project Panel", version: "0.1.1" });
    const hostApiFactory = (_next: PanelBootstrap, onUnauthorized: () => void): PanelApi => createPanelToolApi(host.callServerTool.bind(host) as PanelServerToolCall, onUnauthorized);
    let active = true;
    host.ontoolresult = (result) => {
      if (!active) return;
      handlePanelToolResult(result, (next) => {
        setPanelUnavailable(false);
        attachPanelSession(next, expireSession, { setSession, setApiClient, setSessionError, setMessage, setLoading }, hostApiFactory);
      }, setPanelUnavailable, setLoading);
    };
    void host.connect().catch(() => {
      if (!active) return;
      setPanelUnavailable(true);
      setLoading(false);
    });
    return () => {
      active = false;
      host.ontoolresult = undefined;
      void host.close().catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest(`[data-status-menu-card="${openMenuId}"]`)) setOpenMenuId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [openMenuId]);

  const request = <T,>(path: string, init?: RequestInit): Promise<T> => apiClient ? apiClient<T>(path, init) : Promise.reject(new Error("Panel session is not initialized"));
  const load = async () => {
    if (!apiClient || !session) {
      setPanelUnavailable(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setMessage("");
    setPanelUnavailable(false);
    try {
      const next = await loadPanelSummary(apiClient, session, sessionMode, cwd, window.localStorage.getItem("ambient.cwd"));
      setSummary(next);
      setCwd(next.context.canonicalCwd);
      window.localStorage.setItem("ambient.cwd", next.context.canonicalCwd);
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) {
        setMessage(panelRequestError(error));
        setPanelUnavailable(true);
      }
    } finally { setLoading(false); }
  };
  useEffect(() => { if (apiClient) void load(); }, [apiClient, session, sessionMode]);

  const visibleItems = useMemo(() => selectRelevantItems(summary?.items ?? [], summary?.sources ?? [], filter), [summary, filter]);
  const projectCounts = summary?.projectCounts ?? null;
  const listSummaryContent = listSummary(filter, visibleItems.length, projectCounts);
  const finishDragging = () => { setDraggedItemId(null); setDropTarget(null); };

  const moveItem = async (itemId: string, nextStatus: InlineStatus) => {
    if (!summary) return;
    const item = summary.items.find((candidate) => candidate.id === itemId);
    if (!item) return;
    const previousStatus = isInlineStatus(item.status) ? item.status : "captured";
    if (previousStatus === nextStatus || statusOperations[itemId]?.phase === "saving") {
      setOpenMenuId(null);
      finishDragging();
      return;
    }
    setOpenMenuId(null);
    finishDragging();
    setSummary((current) => current ? { ...current, items: updateItemStatus(current.items, itemId, nextStatus), projectCounts: current.projectCounts ? moveProjectCount(current.projectCounts, previousStatus, nextStatus) : null } : current);
    setStatusOperations((current) => ({ ...current, [itemId]: { phase: "saving", previousStatus, nextStatus } }));
    try {
      const updated = await request<Item>(`/api/items/${encodeURIComponent(itemId)}/status`, { method: "PATCH", body: JSON.stringify({ status: nextStatus }) });
      setSummary((current) => current ? { ...current, items: current.items.map((candidate) => candidate.id === itemId ? { ...candidate, ...updated, status: updated.status ?? nextStatus } : candidate) } : current);
      setStatusOperations((current) => ({ ...current, [itemId]: { phase: "synced", previousStatus, nextStatus } }));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSummary((current) => current ? { ...current, items: updateItemStatus(current.items, itemId, previousStatus), projectCounts: current.projectCounts ? moveProjectCount(current.projectCounts, nextStatus, previousStatus) : null } : current);
      setStatusOperations((current) => ({ ...current, [itemId]: { phase: "error", previousStatus, nextStatus, error: detail } }));
    } finally {
      finishDragging();
    }
  };

  if (panelUnavailable) return <PanelErrorShell />;
  if (!session) {
    if (sessionMode === "standalone") return <StandaloneConnect cwd={cwd} tokenError={sessionError} onCwdChange={setCwd} onConnect={(token) => { const next = parsePanelBootstrap({ [PANEL_BOOTSTRAP_META_KEY]: { serviceBaseUrl: window.location.origin, sessionToken: token, projectContextId: "project_0" } }); if (!next) { setSessionError("请输入 43 位 base64url 临时会话令牌。"); return; } attachSession(next); }} />;
    if (loading) return <LoadingShell />;
    return <PanelErrorShell />;
  }
  if (loading && !summary) return <LoadingShell />;
  if (!summary) return <PanelErrorShell />;

  const projectName = summary.context.planeProjectName ?? summary.context.planeProjectId;
  const planeUrl = projectPlaneUrl(summary.context);
  const syncHealthy = summary.failures.length === 0;

  return <main className="shell">
    <section className="inline-card" aria-label="Ambient project inline card">
      <header className="card-header">
        <div className="project-heading">
          <h1>{projectName}</h1>
          <span className={`sync-health ${syncHealthy ? "healthy" : "unhealthy"}`}><span className="sync-dot" aria-hidden="true" />{syncHealthy ? "同步正常" : `${summary.failures.length} 个待同步`}</span>
        </div>
      </header>

      <div className="card-content">
        <div className="filter-group" role="tablist" aria-label="项目状态筛选">
          <button type="button" role="tab" aria-selected={filter === "all"} className="filter-all" onClick={() => setFilter("all")}>
            <span>全部</span><span className="filter-count">{projectCounts?.total ?? "—"}</span>
          </button>
          <div className="status-rail" aria-label="状态筛选和拖放目标">
            {STATUS_OPTIONS.map((option) => <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              aria-label={`${option.label}，${projectCounts?.byStatus[option.value] ?? "计数暂不可用"}`}
              className={`status-target tone-${option.tone}`}
              data-active-drop={dropTarget === option.value ? "true" : undefined}
              onClick={() => setFilter(option.value)}
              onDragEnter={(event) => { if (draggedItemId) { event.preventDefault(); setDropTarget(option.value); } }}
              onDragOver={(event) => { if (draggedItemId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget(option.value); } }}
              onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget((current) => current === option.value ? null : current); }}
              onDrop={(event) => { event.preventDefault(); event.stopPropagation(); const itemId = draggedItemId ?? event.dataTransfer.getData("text/plain"); finishDragging(); if (itemId) void moveItem(itemId, option.value); }}
            >
              <span className="status-target-label">{option.label}</span>
              <span className="status-target-count">{projectCounts?.byStatus[option.value] ?? "—"}</span>
            </button>)}
          </div>
        </div>

        <div className="list-summary">
          <span className="list-summary-title">{listSummaryContent.title}</span>
          <span className="list-summary-count">{listSummaryContent.detail}</span>
        </div>

        <div className="work-list" aria-live="polite">
          {visibleItems.map((item) => {
            const status = isInlineStatus(item.status) ? item.status : "captured";
            const option = STATUS_OPTIONS.find((candidate) => candidate.value === status) ?? STATUS_OPTIONS[0];
            const operation = statusOperations[item.id];
            return <article
              key={item.id}
              className={`work-item ${draggedItemId === item.id ? "is-dragging" : ""}`}
              draggable={operation?.phase !== "saving"}
              aria-label={`${item.identifier} ${item.title}`}
              onDragStart={(event) => { if (operation?.phase === "saving") { event.preventDefault(); return; } setDraggedItemId(item.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", item.id); setOpenMenuId(null); }}
              onDragEnd={finishDragging}
            >
              <div className="work-item-main">
                <div className="work-item-meta">
                  <span className="work-item-identifier">{item.identifier}</span>
                  <span className="status-menu-wrap" data-status-menu-card={item.id}>
                    <button type="button" className={`status-chip tone-${option.tone}`} aria-haspopup="menu" aria-expanded={openMenuId === item.id} aria-label={`更改 ${item.identifier} 状态`} onClick={(event) => { event.stopPropagation(); setOpenMenuId((current) => current === item.id ? null : item.id); }}>
                      <span className="status-chip-dot" aria-hidden="true" />{option.cardLabel}<span className="status-chip-chevron" aria-hidden="true" />
                    </button>
                    {openMenuId === item.id && <div className="status-menu" role="menu" aria-label={`${item.identifier} 状态选项`}>
                      {STATUS_OPTIONS.map((nextOption) => <button key={nextOption.value} type="button" role="menuitem" className={nextOption.value === status ? "is-current" : ""} onClick={() => void moveItem(item.id, nextOption.value)}>
                        <span className={`menu-dot tone-${nextOption.tone}`} aria-hidden="true" />{nextOption.label}{nextOption.value === status && <span className="menu-check" aria-hidden="true">✓</span>}
                      </button>)}
                    </div>}
                  </span>
                </div>
                <h2>{item.title}</h2>
                {operation && <div className={`sync-status ${operation.phase}`} role={operation.phase === "error" ? "alert" : "status"}>
                  {operation.phase === "saving" && "保存中"}
                  {operation.phase === "synced" && "已同步"}
                  {operation.phase === "error" && `同步失败：${operation.error}`}
                </div>}
              </div>
              <span className="drag-hint" aria-hidden="true">⠿</span>
            </article>;
          })}
          {!visibleItems.length && <div className="empty-list">当前状态下没有工作项</div>}
        </div>
      </div>

      <footer className="card-footer">
        <a className="plane-cta" href={planeUrl} target="_blank" rel="noreferrer">在 Plane 中打开 ↗</a>
      </footer>
    </section>
  </main>;
}

export function PanelErrorShell() {
  return <main className="shell error-shell">
    <section className="inline-card panel-error-card" role="alert" aria-labelledby="panel-error-title" aria-describedby="panel-error-message">
      <header className="card-header panel-error-header">
        <div className="panel-error-heading">项目面板</div>
      </header>
      <div className="panel-error-content">
        <svg className="panel-error-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M12 8.25v4.5M12 15.75h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <h1 id="panel-error-title">{PANEL_ERROR_TITLE}</h1>
        <p id="panel-error-message">{PANEL_ERROR_MESSAGE}</p>
      </div>
    </section>
  </main>;
}

export function LoadingShell() {
  return <main className="shell loading-shell">
    <section className="inline-card loading-card" aria-busy="true" aria-label="正在加载项目面板">
      <header className="card-header loading-header" aria-hidden="true">
        <div className="loading-heading">
          <span className="skeleton skeleton-project-name" />
          <span className="loading-sync"><span className="skeleton skeleton-sync-dot" /><span className="skeleton skeleton-sync-label" /></span>
        </div>
      </header>

      <div className="card-content">
        <div className="filter-group loading-filters" aria-hidden="true">
          <span className="skeleton skeleton-filter-all" />
          <div className="status-rail">
            {STATUS_OPTIONS.map((option) => <span key={option.value} className="skeleton skeleton-status-target" />)}
          </div>
        </div>

        <div className="list-summary loading-summary" role="status">
          <span className="list-summary-title">正在读取相关工作项</span>
          <span className="skeleton skeleton-summary-count" aria-hidden="true" />
        </div>

        <div className="work-list loading-work-list" aria-hidden="true">
          {Array.from({ length: INLINE_ITEM_LIMIT }, (_, index) => <article key={index} className="work-item loading-work-item">
            <div className="work-item-main">
              <div className="work-item-meta">
                <span className="skeleton skeleton-identifier" />
                <span className="skeleton skeleton-status-chip" />
              </div>
              <span className={`skeleton skeleton-item-title skeleton-item-title-${index + 1}`} />
            </div>
            <span className="skeleton skeleton-drag-hint" />
          </article>)}
        </div>
      </div>

      <footer className="card-footer loading-footer" aria-hidden="true">
        <span className="skeleton skeleton-cta" />
      </footer>
    </section>
  </main>;
}

function StandaloneConnect({ cwd, tokenError, onCwdChange, onConnect }: { cwd: string; tokenError: string; onCwdChange: (value: string) => void; onConnect: (token: string) => void }) {
  const [token, setToken] = useState("");
  return <main className="shell state-shell"><section className="state-card connect-card"><span className="eyebrow">LOCAL DEVELOPMENT MODE</span><h1>Connect project panel</h1><p>独立 4318 页面只用于开发降级；正式 Codex App 会话从组件私有 metadata 初始化。</p><label>Working directory<input value={cwd} onChange={(event) => onCwdChange(event.target.value)} placeholder="/Users/…/project" /></label><label>Temporary session token<input value={token} onChange={(event) => setToken(event.target.value)} placeholder="43 位 base64url 令牌" spellCheck={false} /></label><button type="button" className="plane-cta" onClick={() => onConnect(token)}>Connect</button>{tokenError && <p className="error">{tokenError}</p>}</section></main>;
}

if (typeof document !== "undefined") createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
