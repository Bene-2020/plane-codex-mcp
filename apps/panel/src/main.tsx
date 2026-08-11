import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import "./styles.css";
import { createPanelApi, PANEL_BOOTSTRAP_META_KEY, parsePanelBootstrap, SessionExpiredError, type PanelBootstrap } from "./session";

type Item = { id: string; identifier: string; title: string; description?: string; kind?: string; status?: string; dueDate?: string | null; url?: string; isSystemCreated?: boolean; archived?: boolean; updatedAt?: string };
type Context = { id: string; canonicalCwd: string; planeProjectName?: string; planeProjectId: string; autoCaptureEnabled: boolean };
type Source = { eventId: string; eventType: string; summary: string; sourceExcerpt: string; sessionId: string; turnId: string; planeItemId?: string | null };
type Summary = { context: Context; items: Item[]; sources: Source[]; failures: Array<{ batch_id: string; status: string; attempts: number; last_error?: string }> };
type PanelApi = ReturnType<typeof createPanelApi>;

function App() {
  const [cwd, setCwd] = useState("");
  const [session, setSession] = useState<PanelBootstrap | null>(null);
  const [sessionMode, setSessionMode] = useState<"host" | "standalone">("host");
  const [sessionError, setSessionError] = useState("");
  const [apiClient, setApiClient] = useState<PanelApi | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  const expireSession = () => {
    setSession(null);
    setApiClient(null);
    setSummary(null);
    setSelectedId(null);
    setLoading(false);
    setSessionError("本地服务已重启，请从 Codex 重新初始化面板。");
  };
  const attachSession = (next: PanelBootstrap) => {
    setSession(next);
    setApiClient(createPanelApi(next, expireSession));
    setSessionError("");
    setMessage("");
    setLoading(true);
  };

  useEffect(() => {
    if (window.parent === window) {
      setSessionMode("standalone");
      setLoading(false);
      return;
    }
    const host = new McpApp({ name: "Ambient Project Panel", version: "0.1.0" });
    let active = true;
    host.ontoolresult = (result) => {
      if (!active) return;
      const next = parsePanelBootstrap(result._meta);
      if (!next) {
        setSessionError("没有收到安全的 MCP App 会话，请从 Codex 重新打开项目面板。");
        setLoading(false);
        return;
      }
      attachSession(next);
    };
    void host.connect().catch(() => {
      if (!active) return;
      setSessionError("无法连接 Codex 的 MCP App 宿主。");
      setLoading(false);
    });
    return () => {
      active = false;
      host.ontoolresult = undefined;
      void host.close().catch(() => undefined);
    };
  }, []);

  const request = <T,>(path: string, init?: RequestInit): Promise<T> => apiClient ? apiClient<T>(path, init) : Promise.reject(new Error("Panel session is not initialized"));
  const load = async () => {
    if (!apiClient || !session) return;
    setLoading(true);
    try {
      let next: Summary;
      if (sessionMode === "standalone") {
        const context = await request<Context | null>(`/api/context?cwd=${encodeURIComponent(cwd || window.localStorage.getItem("ambient.cwd") || ".")}`);
        if (!context) { setSummary(null); return; }
        next = await request<Summary>(`/api/projects/${context.id}/summary`);
      } else {
        next = await request<Summary>(`/api/projects/${session.projectContextId}/summary`);
      }
      setSummary(next);
      setCwd(next.context.canonicalCwd);
      window.localStorage.setItem("ambient.cwd", next.context.canonicalCwd);
      setSelectedId((current) => current ?? next.items[0]?.id ?? null);
    } catch (error) {
      if (!(error instanceof SessionExpiredError)) setMessage(error instanceof Error ? error.message : String(error));
    }
    finally { setLoading(false); }
  };
  useEffect(() => { if (apiClient) void load(); }, [apiClient, session, sessionMode]);

  const selected = summary?.items.find((item) => item.id === selectedId) ?? null;
  const filteredItems = useMemo(() => (summary?.items ?? []).filter((item) => filter === "all" || item.kind === filter || item.status === filter || (filter === "ideaRisk" && (item.kind === "idea" || item.kind === "risk"))), [summary, filter]);
  const counts = { captured: summary?.items.filter((item) => item.status === "captured").length ?? 0, in_progress: summary?.items.filter((item) => item.status === "in_progress").length ?? 0, bug: summary?.items.filter((item) => item.kind === "bug").length ?? 0, decision: summary?.items.filter((item) => item.kind === "decision").length ?? 0, ideaRisk: summary?.items.filter((item) => item.kind === "idea" || item.kind === "risk").length ?? 0 };

  if (!session) {
    if (sessionMode === "standalone") return <StandaloneConnect cwd={cwd} tokenError={sessionError} onCwdChange={setCwd} onConnect={(token) => { const next = parsePanelBootstrap({ [PANEL_BOOTSTRAP_META_KEY]: { serviceBaseUrl: window.location.origin, sessionToken: token, projectContextId: "project_0" } }); if (!next) { setSessionError("请输入 43 位 base64url 临时会话令牌。"); return; } attachSession(next); }} />;
    return <main className="shell loading"><div className="session-card"><span className="eyebrow">AMBIENT PROJECT LAYER</span><h1>Waiting for Codex</h1><p>{sessionError || "从 Codex 初始化项目面板后，这里会建立一次性的本地会话。"}</p></div></main>;
  }
  if (loading && !summary) return <main className="shell loading">Loading project panel…</main>;
  if (!summary) return <main className="shell empty"><div className="empty-card"><span className="eyebrow">AMBIENT PROJECT LAYER</span><h1>No project context yet</h1><p>Bind this working directory from Codex with the ambient project skill, then reopen the panel.</p><label>Working directory<input value={cwd} onChange={(e) => setCwd(e.target.value)} placeholder="/Users/…/project" /></label><button onClick={() => void load()}>Load project</button>{message && <p className="error">{message}</p>}</div></main>;

  const updateContext = async (enabled: boolean) => { await request(`/api/projects/${summary.context.id}/auto-capture`, { method: "PATCH", body: JSON.stringify({ enabled }) }); setSummary({ ...summary, context: { ...summary.context, autoCaptureEnabled: enabled } }); };
  const edit = async (patch: Partial<Item>) => { if (!selected) return; const updated = await request<Item>(`/api/items/${selected.id}`, { method: "PATCH", body: JSON.stringify(patch) }); setSummary({ ...summary, items: summary.items.map((item) => item.id === updated.id ? { ...item, ...updated } : item) }); setMessage("已保存"); };
  const archive = async () => { if (!selected || !window.confirm("归档这条系统生成的记录？")) return; await request(`/api/items/${selected.id}/archive`, { method: "POST" }); await load(); setMessage("已归档"); };
  const remove = async () => { if (!selected || !window.confirm("删除这条系统生成的记录？此操作会同步到 Plane。")) return; await request(`/api/items/${selected.id}`, { method: "DELETE" }); await load(); setMessage("已删除"); };
  const merge = async (targetId: string) => { if (!selected || !window.confirm("把当前记录合并到选中的目标记录？")) return; await request(`/api/items/${selected.id}/merge/${targetId}`, { method: "POST" }); await load(); setMessage("已合并"); };

  return <main className="shell">
    <header className="topbar"><div><span className="eyebrow">AMBIENT PROJECT LAYER</span><h1>{summary.context.planeProjectName ?? summary.context.planeProjectId}</h1><p className="path">{summary.context.canonicalCwd}</p></div><div className="top-actions"><span className={`sync ${summary.failures.length ? "warning" : "ok"}`}>{summary.failures.length ? `${summary.failures.length} 个待同步` : "同步正常"}</span><label className="toggle"><input type="checkbox" checked={summary.context.autoCaptureEnabled} onChange={(e) => void updateContext(e.target.checked)} /><span />自动捕获</label><button className="ghost" onClick={() => void load()}>刷新</button></div></header>
    <section className="layout">
      <aside className="sidebar"><p className="section-label">项目视图</p><button className={filter === "all" ? "nav active" : "nav"} onClick={() => setFilter("all")}>全部 <b>{summary.items.length}</b></button><button className={filter === "captured" ? "nav active" : "nav"} onClick={() => setFilter("captured")}>Captured <b>{counts.captured}</b></button><button className={filter === "in_progress" ? "nav active" : "nav"} onClick={() => setFilter("in_progress")}>进行中 <b>{counts.in_progress}</b></button><button className={filter === "bug" ? "nav active" : "nav"} onClick={() => setFilter("bug")}>Bug <b>{counts.bug}</b></button><button className={filter === "decision" ? "nav active" : "nav"} onClick={() => setFilter("decision")}>决定 <b>{counts.decision}</b></button><button className={filter === "ideaRisk" ? "nav active" : "nav"} onClick={() => setFilter("ideaRisk")}>想法 / 风险 <b>{counts.ideaRisk}</b></button><p className="section-label lower">同步</p><button className={filter === "failures" ? "nav active" : "nav"} onClick={() => setFilter("failures")}>失败记录 <b>{summary.failures.length}</b></button><div className="sidebar-note">系统安静地记录有意义的工作。面板只在你主动打开时出现。</div></aside>
      <section className="list-pane"><div className="list-head"><div><p className="section-label">项目记录</p><h2>{filter === "all" ? "全部记录" : filter}</h2></div><span className="muted">{filteredItems.length} 条</span></div>{filter === "failures" ? <FailureList failures={summary.failures} contextId={summary.context.id} request={request} onDone={() => void load()} /> : <><div className="items">{filteredItems.map((item) => <button key={item.id} className={`item ${item.id === selectedId ? "selected" : ""}`} onClick={() => setSelectedId(item.id)}><div className="item-top"><span className={`kind ${item.kind ?? "task"}`}>{item.kind ?? "task"}</span><span className="muted">{item.identifier}</span></div><strong>{item.title}</strong><div className="item-bottom"><span>{labelStatus(item.status)}</span><span>{item.isSystemCreated ? "自动捕获" : "用户创建"}</span></div></button>)}{!filteredItems.length && <div className="blank">这里还没有记录。</div>}</div><div className="recent"><p className="section-label">最近进展</p>{summary.sources.slice(0, 4).map((source) => <div className="recent-row" key={source.eventId}><span>{source.eventType}</span><p>{source.summary}</p></div>)}</div></>}</section>
      <aside className="detail-pane">{selected ? <Detail item={selected} items={summary.items} sources={summary.sources.filter((source) => source.planeItemId === selected.id)} onEdit={edit} onMerge={merge} onArchive={archive} onDelete={remove} /> : <div className="blank">选择一条记录查看详情。</div>}{message && <div className="toast">{message}</div>}</aside>
    </section>
  </main>;
}

function StandaloneConnect({ cwd, tokenError, onCwdChange, onConnect }: { cwd: string; tokenError: string; onCwdChange: (value: string) => void; onConnect: (token: string) => void }) {
  const [token, setToken] = useState("");
  return <main className="shell empty"><div className="empty-card"><span className="eyebrow">LOCAL DEVELOPMENT MODE</span><h1>Connect project panel</h1><p>独立 4318 页面只用于开发降级；正式 Codex App 会话从组件私有 metadata 初始化。</p><label>Working directory<input value={cwd} onChange={(e) => onCwdChange(e.target.value)} placeholder="/Users/…/project" /></label><label>Temporary session token<input value={token} onChange={(e) => setToken(e.target.value)} placeholder="43 位 base64url 令牌" spellCheck={false} /></label><button onClick={() => onConnect(token)}>Connect</button>{tokenError && <p className="error">{tokenError}</p>}</div></main>;
}

function Detail({ item, items, sources, onEdit, onMerge, onArchive, onDelete }: { item: Item; items: Item[]; sources: Source[]; onEdit: (patch: Partial<Item>) => Promise<void>; onMerge: (targetId: string) => Promise<void>; onArchive: () => Promise<void>; onDelete: () => Promise<void> }) {
  const [title, setTitle] = useState(item.title); const [description, setDescription] = useState(item.description ?? ""); const [status, setStatus] = useState(item.status ?? "captured"); const [kind, setKind] = useState(item.kind ?? "task"); const [dueDate, setDueDate] = useState(item.dueDate ?? "");
  const [mergeTarget, setMergeTarget] = useState("");
  useEffect(() => { setTitle(item.title); setDescription(item.description ?? ""); setStatus(item.status ?? "captured"); setKind(item.kind ?? "task"); setDueDate(item.dueDate ?? ""); }, [item.id, item.title, item.description, item.status, item.kind, item.dueDate]);
  const save = () => onEdit({ title, description, status, kind, dueDate: dueDate || null });
  return <div className="detail"><div className="detail-head"><div><span className={`kind ${kind}`}>{kind}</span><span className="muted id">{item.identifier}</span></div>{item.url && <a href={item.url} target="_blank" rel="noreferrer">打开 Plane ↗</a>}</div><label>标题<input value={title} onChange={(e) => setTitle(e.target.value)} /></label><label>描述<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} /></label><div className="field-grid"><label>种类<select value={kind} onChange={(e) => setKind(e.target.value)}>{["task", "bug", "decision", "idea", "risk", "milestone"].map((v) => <option key={v}>{v}</option>)}</select></label><label>状态<select value={status} onChange={(e) => setStatus(e.target.value)}>{["captured", "planned", "in_progress", "done", "dropped"].map((v) => <option key={v}>{v}</option>)}</select></label></div><label>截止日期<input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></label><button className="primary full" onClick={() => void save()}>保存修改</button><div className="detail-divider" /><p className="section-label">来源引用</p>{sources.length ? sources.map((source) => <div className="source" key={source.eventId}><span>{source.eventType} · {source.sessionId} / {source.turnId}</span><p>{source.sourceExcerpt}</p></div>) : <p className="muted">暂无来源引用。</p>}<div className="detail-divider" /><p className="section-label">合并重复记录</p><div className="merge-row"><select value={mergeTarget} onChange={(e) => setMergeTarget(e.target.value)}><option value="">选择目标记录</option>{items.filter((candidate) => candidate.id !== item.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.identifier} · {candidate.title}</option>)}</select><button className="ghost" disabled={!mergeTarget} onClick={() => void onMerge(mergeTarget)}>合并</button></div><div className="detail-divider" /><div className="danger-actions"><button className="ghost" onClick={() => void onArchive()}>归档</button><button className="danger" onClick={() => void onDelete()}>删除</button></div></div>;
}

function FailureList({ failures, contextId, request, onDone }: { failures: Summary["failures"]; contextId: string; request: PanelApi; onDone: () => void }) { return <div className="failures">{failures.length ? failures.map((failure) => <div className="failure" key={failure.batch_id}><strong>{failure.batch_id}</strong><p>{failure.last_error ?? failure.status}</p><button className="ghost" onClick={async () => { await request(`/api/projects/${contextId}/retry/${failure.batch_id}`, { method: "POST" }); onDone(); }}>重试</button></div>) : <div className="blank">没有同步失败。</div>}</div>; }
function labelStatus(status?: string): string { return ({ captured: "Captured", planned: "已规划", in_progress: "进行中", done: "已完成", dropped: "已放弃" } as Record<string, string>)[status ?? ""] ?? status ?? "未知"; }

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
