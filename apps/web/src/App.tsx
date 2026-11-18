import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from './api';
import { TracePanel } from './components/TracePanel';
import { ReportView } from './components/ReportView';
import { compactNumber, formatDate, isActive, shortId } from './format';
import type { RunDetail, RunSummary, Settings, Target } from './types';

type Page = 'explore' | 'history' | 'guide';
const PRESETS: Record<string, Settings> = {
  'rate-limiter': { accessDepth: 3, suffixDepth: 3, verifyDepth: 8, queryLimit: 2500, findingLimit: 1 },
  authentication: { accessDepth: 3, suffixDepth: 2, verifyDepth: 4, queryLimit: 3000, findingLimit: 1 },
  external: { accessDepth: 3, suffixDepth: 2, verifyDepth: 4, queryLimit: 3000, findingLimit: 1 },
};

function Status({ value }: { value: RunSummary['status'] }) {
  return <span className={`status-chip ${value === 'COMPLETED' ? 'complete' : value === 'FAILED' ? 'warning' : value === 'RUNNING' ? 'running' : ''}`}>{value.toLowerCase()}</span>;
}

export default function App() {
  const [page, setPage] = useState<Page>('explore');
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('rate-limiter');
  const [settings, setSettings] = useState<Settings>({ ...PRESETS['rate-limiter']! });
  const [advanced, setAdvanced] = useState(false);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const target = useMemo(() => targets.find((item) => item.id === selectedTarget), [targets, selectedTarget]);
  const loadRuns = useCallback(async () => { const next = await api.runs(); setRuns(next); return next; }, []);
  const loadRun = useCallback(async (id: string) => { const next = await api.run(id); setRun(next); return next; }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([api.targets(), api.runs()]).then(([allTargets, allRuns]) => {
      if (!mounted) return;
      setTargets(allTargets); setRuns(allRuns);
      const first = allRuns[0];
      if (first) setRunId(first.id);
      if (allTargets[0]) { setSelectedTarget(allTargets[0].id); setSettings({ ...PRESETS[allTargets[0].id]! }); }
    }).catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : 'Could not load ECHO'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!runId) { setRun(null); return; }
    let mounted = true;
    api.run(runId).then((next) => { if (mounted) setRun(next); })
      .catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : 'Could not load report'); });
    return () => { mounted = false; };
  }, [runId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadRuns().then((next) => {
        if (runId && next.some((entry) => entry.id === runId && isActive(entry.status))) {
          return loadRun(runId).then(() => undefined);
        }
        if (runId && run && isActive(run.status)) return loadRun(runId).then(() => undefined);
        return undefined;
      }).catch(() => { /* Keep the last good view during transient network failures. */ });
    }, 1800);
    return () => window.clearInterval(timer);
  }, [loadRun, loadRuns, run, runId]);

  useEffect(() => { if (!toast) return; const handle = window.setTimeout(() => setToast(''), 5000); return () => window.clearTimeout(handle); }, [toast]);

  const chooseTarget = (id: string) => {
    setSelectedTarget(id);
    setSettings({ ...PRESETS[id]! });
  };
  const start = async () => {
    setBusy(true); setError('');
    try {
      const created = await api.start(selectedTarget, settings);
      setRunId(created.id); setRun(null); setPage('explore');
      setToast('Exploration queued. This page will update as it runs.');
      await loadRuns();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to start run'); }
    finally { setBusy(false); }
  };
  const cancel = async () => {
    if (!runId) return;
    try { await api.cancel(runId); setToast('Cancellation requested'); await loadRun(runId); await loadRuns(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Cancellation failed'); }
  };
  const remove = async (id: string) => {
    if (!window.confirm('Delete this run and its report? This cannot be undone.')) return;
    try {
      await api.delete(id);
      const next = await loadRuns();
      if (runId === id) { setRunId(next[0]?.id ?? null); setRun(null); }
      setToast('Run deleted');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Deletion failed'); }
  };
  const completed = runs.filter((item) => item.status === 'COMPLETED');
  const findings = completed.reduce((total, item) => total + item.findingCount, 0);
  const probes = completed.reduce((total, item) => total + item.queries, 0);

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-symbol">E<span>•</span></div><div><strong>ECHO</strong><small>BEHAVIOR LAB</small></div></div>
      <div className="nav-title">WORKSPACE</div>
      <nav className="nav-links" aria-label="Primary navigation">
        <button className={page === 'explore' ? 'active' : ''} onClick={() => setPage('explore')}><span>◇</span> Explorer</button>
        <button className={page === 'history' ? 'active' : ''} onClick={() => setPage('history')}><span>▤</span> Run history</button>
        <button className={page === 'guide' ? 'active' : ''} onClick={() => setPage('guide')}><span>◎</span> How it works</button>
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-info"><span className="live-dot"/> Sandboxed · Local-first</div><p>Models are hypotheses, not proofs. Every finding includes the observed trace.</p><div className="sidebar-version">ECHO / VERSION 1.0</div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><span>/</span><strong>{page === 'explore' ? 'Explorer' : page === 'history' ? 'Run history' : 'How it works'}</strong></div><div className="top-right"><span className="connection"><span className="live-dot"/> Local environment</span><span className="avatar">E</span></div></header>
      <div className="content">
        {error && <div role="alert" className="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>✕</button></div>}
        {toast && <div role="status" className="toast"><span>✓</span> {toast}</div>}
        {loading ? <div className="panel empty-panel"><div className="loading-ring"/><p>Connecting to the behavior lab…</p></div> : <>
          {page === 'explore' && <>
            <section className="hero"><div><div className="eyebrow">BLACK-BOX SOFTWARE INTELLIGENCE</div><h1>Understand what software <em>actually</em> does.</h1><p>Probe an API, infer its behavioral states, and uncover deviations—without inspecting the implementation.</p></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-a"/><div className="orbit orbit-b"/><div className="orbit-center">E</div><span className="orbit-node one"/><span className="orbit-node two"/><span className="orbit-node three"/></div></section>
            <div className="metrics"><div className="metric"><span>Saved runs</span><strong>{runs.length}</strong><small>Persisted in PostgreSQL</small></div><div className="metric"><span>Completed models</span><strong>{completed.length}</strong><small>Generated from observations</small></div><div className="metric"><span>Discrepancies</span><strong>{findings}</strong><small>Counterexamples found</small></div><div className="metric"><span>Oracle probes</span><strong>{compactNumber(probes)}</strong><small>Across completed runs</small></div></div>
            <div className="section-header"><div><div className="eyebrow">01 / CONFIGURE</div><h2>New exploration</h2><p>Choose a black-box target. ECHO will infer and verify its state machine.</p></div></div>
            <section className="panel setup-panel"><div className="panel-heading-row"><div><h3>Target system</h3><p>Each target exposes only actions and observable output strings.</p></div><span className="tag">BLACK-BOX</span></div>
              <div className="target-grid">{targets.map((item) => <button key={item.id} type="button" onClick={() => chooseTarget(item.id)} className={`target-card ${selectedTarget === item.id ? 'chosen' : ''}`} aria-pressed={selectedTarget === item.id}><span className="target-icon">{item.id === 'rate-limiter' ? '◈' : item.id === 'authentication' ? '⌁' : '↗'}</span><strong>{item.name}</strong><small>{item.summary}</small><span className="target-actions">{item.actions.join(' · ')}</span></button>)}</div>
              {target && <div className="contract"><span>DOCUMENTED CONTRACT</span><p>{target.contract}</p></div>}
              <div className="settings-heading"><button className="text-button" type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? '▾' : '▸'} Advanced exploration limits</button><span className="muted">Defaults tuned for this target</span></div>
              {advanced && <div className="settings-grid">{([['accessDepth', 'Access depth', 2, 6], ['suffixDepth', 'Suffix depth', 1, 4], ['verifyDepth', 'Verification depth', 1, 9], ['queryLimit', 'Maximum probes', 100, 20000], ['findingLimit', 'Finding limit', 1, 5]] as const).map(([key, label, min, max]) => <label key={key}><span>{label}</span><input type="number" min={min} max={max} value={settings[key]} onChange={(event) => setSettings((old) => ({ ...old, [key]: Number(event.target.value) }))} /></label>)}<p>Higher depths can grow exponentially, particularly for targets with four or five actions. The query budget stops unbounded exploration.</p></div>}
              <div className="setup-footer"><div><strong>Ready to explore</strong><span>Findings are reproducible; each trace starts from fresh state.</span></div><button className="btn btn-primary" disabled={busy || !target} onClick={() => { void start(); }}>{busy ? 'Creating run…' : 'Start exploration →'}</button></div>
            </section>
            {target && <section className="panel"><TracePanel target={target} /></section>}
            <div className="section-header" id="reports"><div><div className="eyebrow">02 / INVESTIGATE</div><h2>Latest report</h2><p>Inspect the model and replay the shortest observed mismatch.</p></div>{run && isActive(run.status) && <button className="btn btn-outline small" onClick={() => { void cancel(); }}>Cancel run</button>}</div>
            {runs.length > 0 && <div className="report-select"><label htmlFor="report-selector">Viewing run</label><select id="report-selector" value={runId ?? ''} onChange={(event) => setRunId(event.target.value)}>{runs.map((item) => <option key={item.id} value={item.id}>{item.targetId} · {shortId(item.id)} · {item.status.toLowerCase()}</option>)}</select></div>}
            {run ? <ReportView run={run} /> : <div className="panel empty-panel"><p>No report yet. Start an exploration to generate one.</p></div>}
          </>}
          {page === 'history' && <><div className="page-heading"><div className="eyebrow">PAST EXPERIMENTS</div><h1>Run history</h1><p>Every run is saved with its model, settings, and observations.</p></div><section className="panel history-panel"><div className="panel-heading-row"><h3>All runs</h3><button className="btn btn-outline small" onClick={() => { void loadRuns().catch(() => setError('Unable to refresh runs')); }}>Refresh</button></div>
            <div className="table-scroll"><table className="data-table"><thead><tr><th>Run</th><th>Target</th><th>Created</th><th>Status</th><th>States</th><th>Findings</th><th>Actions</th></tr></thead><tbody>{runs.map((item) => <tr key={item.id}><td><code>{shortId(item.id)}</code></td><td>{item.targetId}</td><td>{formatDate(item.createdAt)}</td><td><Status value={item.status}/></td><td>{item.stateCount}</td><td>{item.findingCount}</td><td className="table-actions"><button className="text-button" onClick={() => { setRunId(item.id); setPage('explore'); }}>Inspect</button>{!item.id.startsWith('demo-') && !isActive(item.status) && <button className="text-button danger" onClick={() => { void remove(item.id); }}>Delete</button>}{isActive(item.status) && <button className="text-button danger" onClick={() => { setRunId(item.id); void api.cancel(item.id).then(loadRuns).catch(() => setError('Unable to cancel run')); }}>Cancel</button>}</td></tr>)}</tbody></table>{runs.length === 0 && <p className="muted padded">No saved runs. Start your first exploration.</p>}</div></section></>}
          {page === 'guide' && <div className="guide"><div className="page-heading"><div className="eyebrow">ENGINEERING NOTES</div><h1>How ECHO works</h1><p>A transparent, bounded method for behavior inference—not an LLM guessing at implementation details.</p></div>
            <section className="panel"><h3>01 · Isolate the target</h3><p>An HTTP trace endpoint accepts an ordered action sequence and returns one output for each action. Each trace runs from clean state, so histories are comparable and reproducible.</p></section>
            <section className="panel"><h3>02 · Infer the machine</h3><p>ECHO probes distinguishing suffixes after candidate histories. Histories with identical observed future outputs are grouped into states. It discovers transitions by issuing one action from each state's representative history.</p></section>
            <section className="panel"><h3>03 · Falsify the hypothesis</h3><p>A breadth-first search replays action sequences and compares real outputs with model predictions. A disagreement yields a minimal failing prefix within the search order. The model may be incomplete if limits are too low.</p></section>
            <section className="panel"><h3>04 · Audit the result</h3><p>All settings, models, traces, and counters live in PostgreSQL. A discrepancy is not necessarily a bug: compare it against the contract. ECHO never claims exhaustive correctness.</p></section>
            <section className="panel"><h3>Operational boundaries</h3><p>One worker processes bounded jobs, preventing simultaneous probe floods. Only built-in sandbox targets or an operator-configured external URL can run. This application is a local portfolio lab; authentication, tenant separation, and isolation of hostile external processes must be added before exposing it to the internet.</p></section>
          </div>}
        </>}
      </div>
    </main>
  </div>;
}
