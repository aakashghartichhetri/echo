import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, setCsrfToken, type AccountUser } from './api';
import { Account } from './components/Account';
import { Overview } from './components/Overview';
import { Explorer } from './components/Explorer';
import { ReleaseCheck } from './components/ReleaseCheck';
import { History } from './components/History';
import { isActive, nextRefreshDelay } from './format';
import type { RunDetail, RunSummary, Settings, Target } from './types';

type Page = 'overview' | 'explore' | 'release' | 'history' | 'guide' | 'account';
type Theme = 'light' | 'dark';

const PRESETS: Record<string, Settings> = {
  'rate-limiter': { accessDepth: 3, suffixDepth: 3, verifyDepth: 8, queryLimit: 2500, findingLimit: 1 },
  authentication: { accessDepth: 3, suffixDepth: 2, verifyDepth: 4, queryLimit: 3000, findingLimit: 1 },
  external: { accessDepth: 3, suffixDepth: 2, verifyDepth: 4, queryLimit: 3000, findingLimit: 1 },
};

const PAGES: { id: Page; label: string; description: string }[] = [
  { id: 'overview', label: 'Overview', description: 'Your workspace' },
  { id: 'explore', label: 'Explore APIs', description: 'Learn & verify' },
  { id: 'release', label: 'Release check', description: 'Compare changes' },
  { id: 'history', label: 'Run history', description: 'Saved evidence' },
  { id: 'guide', label: 'How it works', description: 'Method & limits' },
  { id: 'account', label: 'Account', description: 'Privacy & usage' },
];

// Small inline icons avoid an entire icon-library dependency.
function NavIcon({ page }: { page: Page }) {
  const paths: Record<Page, ReactNode> = {
    overview: <><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></>,
    explore: <><path d="m12 3 8.5 5v8L12 21l-8.5-5V8L12 3Z"/><path d="m3.5 8 8.5 5 8.5-5M12 13v8"/></>,
    release: <><path d="M7 7h13m0 0-4-4m4 4-4 4M17 17H4m0 0 4-4m-4 4 4 4"/></>,
    history: <><path d="M3 5h18M5 5v16h14V5M9 10h6M9 14h6M9 18h4"/></>,
    guide: <><circle cx="12" cy="12" r="9"/><path d="M9.6 9a2.7 2.7 0 0 1 5.3.9c0 2-2.9 2-2.9 4.1m0 3h.01"/></>,
    account: <><circle cx="12" cy="8" r="4"/><path d="M5 21c0-4 3-7 7-7s7 3 7 7"/></>,
  };
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[page]}</svg>;
}


function savedTheme(): Theme {
  try { return localStorage.getItem('echo-theme') === 'dark' ? 'dark' : 'light'; }
  catch { return 'light'; }
}

function saveJson(report: RunDetail) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `echo-report-${report.id}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Workspace({ account, onLogout, onDelete }: { account: AccountUser; onLogout: () => Promise<void>; onDelete: () => Promise<void> }) {
  const [page, setPage] = useState<Page>('overview');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  const firstNavButton = useRef<HTMLButtonElement>(null);
  const navWasOpened = useRef(false);
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [targets, setTargets] = useState<Target[]>([]);
  const [selectedTarget, setSelectedTarget] = useState('rate-limiter');
  const [settings, setSettings] = useState<Settings>({ ...PRESETS['rate-limiter']! });
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [runId, setRunId] = useState<string | null>(null);
  const [report, setReport] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const loadRuns = useCallback(async () => {
    const next = await api.runs();
    setRuns(next);
    setConnected(true);
    return next;
  }, []);
  const loadReport = useCallback(async (id: string) => {
    const next = await api.run(id);
    setReport(next);
    return next;
  }, []);
  const active = runs.some((run) => isActive(run.status)) || Boolean(report && isActive(report.status));

  useEffect(() => {
    try { localStorage.setItem('echo-theme', theme); } catch { /* Storage can be disabled. */ }
  }, [theme]);

  useEffect(() => {
    let mounted = true;
    Promise.all([api.targets(), api.runs(), api.ready()])
      .then(([available, history]) => {
        if (!mounted) return;
        setConnected(true);
        setTargets(available);
        setRuns(history);
        if (history[0]) setRunId(history[0].id);
        if (available[0]) {
          setSelectedTarget(available[0].id);
          setSettings({ ...(PRESETS[available[0].id] ?? PRESETS.external!) });
        }
      })
      .catch((cause) => { if (mounted) { setConnected(false); setError(cause instanceof Error ? cause.message : 'Unable to reach ECHO'); } })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!runId) { setReport(null); return; }
    let mounted = true;
    api.run(runId)
      .then((next) => { if (mounted) setReport(next); })
      .catch((cause) => { if (mounted) setError(cause instanceof Error ? cause.message : 'Unable to load report'); });
    return () => { mounted = false; };
  }, [runId]);

  // Only poll frequently while work is active, and never in a hidden browser tab.
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const interval = nextRefreshDelay(active);
    async function refresh() {
      if (disposed) return;
      if (document.hidden) { schedule(); return; }
      try {
        const latest = await api.runs();
        if (disposed) return;
        setConnected(true);
        setRuns(latest);
        const selected = latest.find((item) => item.id === runId);
        if (runId && (active || selected?.status !== report?.status)) {
          const next = await api.run(runId);
          if (!disposed) setReport(next);
        }
      } catch { if (!disposed) setConnected(false); }
      finally { schedule(); }
    }
    function schedule() { if (!disposed) timer = window.setTimeout(() => { void refresh(); }, interval); }
    function visibleAgain() { if (!document.hidden) { window.clearTimeout(timer); void refresh(); } }
    schedule();
    document.addEventListener('visibilitychange', visibleAgain);
    return () => { disposed = true; window.clearTimeout(timer); document.removeEventListener('visibilitychange', visibleAgain); };
  }, [active, runId, report?.status]);

  useEffect(() => {
    if (mobileNavOpen) {
      navWasOpened.current = true;
      firstNavButton.current?.focus();
    } else if (navWasOpened.current) {
      menuButton.current?.focus();
    }
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNavOpen(false);
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 4500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function navigate(nextPage: Page) {
    setPage(nextPage);
    setMobileNavOpen(false);
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function chooseTarget(id: string) {
    setSelectedTarget(id);
    setSettings({ ...(PRESETS[id] ?? PRESETS.external!) });
  }

  function inspect(id: string) {
    setRunId(id);
    setReport(null);
    setPage('explore');
    window.requestAnimationFrame(() => document.getElementById('reports')?.scrollIntoView({ behavior: 'smooth' }));
  }

  async function start() {
    setBusy(true);
    setError('');
    try {
      const created = await api.start(selectedTarget, settings);
      setRunId(created.id);
      setReport(null);
      setPage('explore');
      setToast('Your exploration is queued. Results update automatically.');
      await loadRuns();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not start exploration'); }
    finally { setBusy(false); }
  }

  async function cancel(id: string | null = runId) {
    if (!id) return;
    try {
      await api.cancel(id);
      setToast('Cancellation requested');
      await loadRuns();
      if (id === runId) await loadReport(id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not cancel run'); }
  }

  async function remove(id: string) {
    if (!window.confirm('Delete this saved experiment? This cannot be undone.')) return;
    try {
      await api.delete(id);
      const next = await loadRuns();
      if (id === runId) { setRunId(next[0]?.id ?? null); setReport(null); }
      setToast('Experiment deleted');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete run'); }
  }

  return <div className="app-shell" data-theme={theme}>
    <a className="skip-link" href="#main">Skip to main content</a>
    {mobileNavOpen && <button className="nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)} />}
    <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`} aria-label="Workspace navigation" id="workspace-navigation">
      <div className="brand">
        <div className="brand-symbol" aria-hidden="true"><span className="brand-wave">≋</span></div>
        <div className="brand-label"><strong>ECHO<span className="brand-dot">.</span></strong><small>BEHAVIOR LAB</small></div>
        <button className="sidebar-close" type="button" onClick={() => setMobileNavOpen(false)} aria-label="Close navigation">×</button>
      </div>
      <div className="nav-title">WORKSPACE</div>
      <nav className="nav-links" aria-label="Primary navigation">
        {PAGES.map((item, index) => <button ref={index === 0 ? firstNavButton : undefined} key={item.id} type="button" className={page === item.id ? 'active' : ''}
          aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(item.id)}>
          <span className="nav-icon"><NavIcon page={item.id}/></span>
          <span className="nav-copy"><strong>{item.label}</strong><small>{item.description}</small></span>
          {page === item.id && <span className="nav-active-mark" aria-hidden="true"/>}
        </button>)}
      </nav>
    </aside>

    <main id="main" className="main-content">
      <header className="topbar">
        <div className="topbar-location">
          <button ref={menuButton} className="mobile-menu-button" type="button" onClick={() => setMobileNavOpen(true)} aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={mobileNavOpen}>
            <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
          </button>
          <div className="breadcrumb"><span>ECHO / Workspace</span><span className="crumb-slash">/</span><strong>{PAGES.find((item) => item.id === page)?.label}</strong></div>
          <span className="mobile-page-title">{PAGES.find((item) => item.id === page)?.label}</span>
        </div>
        <div className="top-right">
          <button className="theme-button" type="button" onClick={() => setTheme((old) => old === 'light' ? 'dark' : 'light')}
            aria-label={theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'} title={theme === 'light' ? 'Dark mode' : 'Light mode'}>{theme === 'light' ? '☾' : '☀'}</button>
          <button className="btn btn-secondary account-top-button" type="button" onClick={() => navigate('account')}>@{account.login}</button>
          <button className="btn btn-primary top-action" type="button" onClick={() => navigate('explore')}>New exploration <span aria-hidden="true">↗</span></button>
        </div>
      </header>
      <div className="content">
        {error && <div role="alert" className="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {!connected && !loading && <div role="alert" className="alert"><span>ECHO cannot reach its API right now. Check the app container, then retry.</span><button className="text-button" onClick={() => window.location.reload()}>Retry</button></div>}
        {toast && <div role="status" className="toast"><span aria-hidden="true">✓</span> {toast}</div>}
        {loading ? <section className="panel empty-panel" role="status"><div className="loading-ring"/><p>Connecting to your workspace…</p></section> : <>
          {page === 'overview' && <Overview runs={runs} onExplore={(id) => { if (id) chooseTarget(id); navigate('explore'); }} onCompare={() => navigate('release')} onInspect={inspect}/>}
          {page === 'explore' && <Explorer targets={targets} selectedTarget={selectedTarget} onSelectTarget={chooseTarget} settings={settings} onSettingsChange={setSettings} runId={runId} runs={runs} report={report} onSelectRun={(id) => { setReport(null); setRunId(id); }} onStart={() => { void start(); }} onCancel={() => { void cancel(); }} onExport={() => { if (report) saveJson(report); }} busy={busy}/>}
          {page === 'release' && <ReleaseCheck runs={runs} onExplore={() => setPage('explore')}/>}
          {page === 'history' && <History runs={runs} onInspect={inspect} onCancel={(id) => { void cancel(id); }} onDelete={(id) => { void remove(id); }} onRefresh={() => { void loadRuns().catch(() => setError('Could not refresh the run history')); }}/>}
          {page === 'account' && <Account user={account} onLogout={onLogout} onDelete={onDelete}/>}
          {page === 'guide' && <div className="guide"><header className="page-heading intro-heading"><div className="eyebrow"><span className="eyebrow-rule"/> UNDER THE HOOD</div><h1>How ECHO works<span className="heading-period">.</span></h1><p>A clear look at what happens during an exploration, and what the results really mean.</p></header>
            {[
              ['01', 'Start from a known point', 'ECHO sends action sequences to a sandboxed API. Every sequence starts with a fresh state, so results can be compared fairly.'],
              ['02', 'Learn from real responses', 'Short sequences and their continuations help ECHO group similar histories into candidate states and transitions.'],
              ['03', 'Look for contradictions', 'Longer sequences test what the model predicts. When a real response differs, ECHO records the shortest failing sequence it found.'],
              ['04', 'Compare before and after', 'Save a run before changing an API. Run it again after the change, then use Release Check to inspect differences in saved models and traces.'],
            ].map(([number, title, detail]) => <section className="panel guide-step" key={number}><span className="guide-number">{number}</span><div><h3>{title}</h3><p>{detail}</p></div></section>)}
            <section className="panel guide-limit"><h3>What ECHO cannot promise</h3><p>A passing bounded check is not proof of correctness. ECHO works with repeatable APIs and a finite set of actions. Hosted workspaces use GitHub sign-in and only permit built-in test targets; broader API integrations require an operator security review.</p></section>
          </div>}
        </>}
        <footer className="footer"><span>Explore behavior. Keep the evidence.</span><span>Results are bounded observations, not correctness proofs.</span></footer>
      </div>
    </main>
  </div>;
}


/** Public accounts use secure server sessions. The browser never stores an access token. */
export default function App() {
  const [user, setUser] = useState<AccountUser | null>(null);
  const [authState, setAuthState] = useState<'loading' | 'signed-in' | 'signed-out'>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    let active = true;
    api.me().then((result) => {
      if (!active) return;
      setCsrfToken(result.csrfToken);
      setUser(result.user);
      setAuthState('signed-in');
    }).catch((error) => {
      if (!active) return;
      setAuthState('signed-out');
      if (error instanceof Error && !/Sign in|session expired|HTTP 401/i.test(error.message)) setMessage(error.message);
    });
    return () => { active = false; };
  }, []);
  async function signOut() { await api.logout(); setCsrfToken(''); setUser(null); setAuthState('signed-out'); }
  async function deleteAccount() { await api.deleteAccount(); setCsrfToken(''); setUser(null); setAuthState('signed-out'); }
  if (authState === 'loading') return <div className="sign-in-shell" role="status"><div className="login-brand">≋ <strong>ECHO.</strong></div><p>Opening your workspace…</p></div>;
  if (authState === 'signed-out' || !user) return <div className="sign-in-shell">
    <div className="login-layout">
      <div className="login-story"><div className="login-brand"><span>≋</span><strong>ECHO.</strong></div>
        <div className="login-eyebrow">BLACK-BOX BEHAVIOR LAB</div>
        <h1>Understand what your API <em>actually does.</em></h1>
        <p>Send controlled requests. Learn state transitions. Keep the evidence when behavior changes.</p>
        <div className="login-example"><span>REAL-WORLD EXAMPLE</span><strong>One unexpected reply can break a client.</strong>
          <div className="login-trace"><code>request × 8</code><span>→</span><code>cooldown</code></div>
          <small>Predict, probe, and explain the difference.</small></div>
      </div>
      <main className="login-card"><div className="login-card-eyebrow">YOUR WORKSPACE</div>
        <h2>Start exploring.</h2><p>Sign in securely with GitHub to save experiments and compare API behavior over time.</p>
        <a className="login-github" href="/api/v1/auth/login">Continue with GitHub <span aria-hidden="true">↗</span></a>
        {message && <p role="alert" className="login-error">{message}</p>}
        <div className="login-fine">Free research workspace · Your reports stay private to your account · No GitHub code access requested</div>
      </main>
    </div>
  </div>;
  return <Workspace account={user} onLogout={signOut} onDelete={deleteAccount}/>;
}
