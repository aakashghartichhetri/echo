import { ReportView } from './ReportView';
import { TracePanel } from './TracePanel';
import { shortId } from '../format';
import type { RunDetail, RunSummary, Settings, Target } from '../types';

const LIMIT_FIELDS = [
  ['accessDepth', 'Access depth', 2, 6],
  ['suffixDepth', 'Suffix depth', 1, 4],
  ['verifyDepth', 'Verification depth', 1, 9],
  ['queryLimit', 'Maximum probes', 100, 20000],
  ['findingLimit', 'Finding limit', 1, 5],
] as const;

type Props = {
  targets: Target[];
  selectedTarget: string;
  onSelectTarget: (id: string) => void;
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  runId: string | null;
  runs: RunSummary[];
  report: RunDetail | null;
  onSelectRun: (id: string) => void;
  onStart: () => void;
  onCancel: () => void;
  onExport: () => void;
  busy: boolean;
};

export function Explorer({ targets, selectedTarget, onSelectTarget, settings, onSettingsChange, runId, runs, report, onSelectRun, onStart, onCancel, onExport, busy }: Props) {
  const target = targets.find((item) => item.id === selectedTarget);
  const canRun = target && Object.entries(settings).every(([field, value]) => {
    const constraint = LIMIT_FIELDS.find(([key]) => key === field);
    return !constraint || (Number.isInteger(value) && value >= constraint[2] && value <= constraint[3]);
  });

  return <div className="explorer-page">
    <header className="page-heading intro-heading"><div className="eyebrow"><span className="eyebrow-rule"/> THE EXPLORER</div><h1>Find the behavior behind the API<span className="heading-period">.</span></h1><p>Pick a system, run an experiment, and inspect what ECHO learned from real HTTP responses.</p></header>

    <div className="section-header" id="new-exploration"><div><div className="eyebrow">01 <span className="eyebrow-rule"/> SET UP</div><h2>Choose what to test</h2><p>Each target exposes actions and outputs, not its implementation.</p></div><span className="section-aside">A FRESH STATE FOR EVERY TRACE</span></div>
    <section className="panel setup-panel">
      <div className="panel-heading-row"><div><h3>Available targets</h3><p>The built-in services are safe, repeatable examples.</p></div><span className="tag">LOCAL SANDBOX</span></div>
      <div className="target-grid">{targets.map((item) => <button key={item.id} type="button" className={`target-card ${selectedTarget === item.id ? 'chosen' : ''}`} aria-pressed={selectedTarget === item.id} onClick={() => onSelectTarget(item.id)}>
        <span className="target-card-top"><span className="target-icon" aria-hidden="true">{item.id === 'rate-limiter' ? '◉' : item.id === 'authentication' ? '⌘' : '↗'}</span><span className="selection-indicator" aria-hidden="true">{selectedTarget === item.id ? '✓' : ''}</span></span>
        <strong>{item.name}</strong><small>{item.summary}</small><span className="target-actions">{item.actions.join(' / ')}</span>
      </button>)}</div>
      {target && <div className="contract"><span>WHAT THE API PROMISES</span><p>{target.contract}</p></div>}
      <details className="advanced-settings"><summary>Adjust exploration limits <span className="muted">· Optional</span></summary>
        <div className="settings-grid">{LIMIT_FIELDS.map(([key, label, min, max]) => <label key={key}><span>{label}</span><input type="number" min={min} max={max} value={settings[key]} onChange={(event) => onSettingsChange({ ...settings, [key]: Number(event.target.value) })} /></label>)}</div>
        <p className="muted">Higher depths can increase HTTP requests quickly. The query budget keeps experiments bounded.</p>
      </details>
      <div className="setup-footer"><div><strong>Ready to explore?</strong><span>Your experiment runs in the background. You can leave this page and return to its report.</span></div><button className="btn btn-primary" disabled={busy || !canRun} onClick={onStart}>{busy ? 'Starting…' : 'Run exploration'} <span aria-hidden="true">↗</span></button></div>
    </section>

    {target && <section className="panel trace-panel"><TracePanel target={target}/></section>}

    <div className="section-header" id="reports"><div><div className="eyebrow">02 <span className="eyebrow-rule"/> REVIEW</div><h2>Learned behavior &amp; findings</h2><p>See state transitions, replay a counterexample, or export the report.</p></div>{report && (report.status === 'RUNNING' || report.status === 'QUEUED') && <button className="btn btn-outline small" onClick={onCancel}>Cancel run</button>}</div>
    {runs.length > 0 && <div className="report-select"><label htmlFor="report-selector">SELECT REPORT</label><select id="report-selector" value={runId ?? ''} onChange={(event) => onSelectRun(event.target.value)}>{runs.map((item) => <option key={item.id} value={item.id}>{item.targetId} · {shortId(item.id)} · {item.status.toLowerCase()}</option>)}</select>{report?.report && <button className="btn btn-outline small" onClick={onExport}>↓ Export JSON</button>}</div>}
    {report ? <ReportView run={report}/> : <section className="panel empty-panel" role="status"><div className="empty-icon" aria-hidden="true">◎</div><h3>{runId ? 'Opening your report…' : 'Your findings will appear here'}</h3><p>{runId ? 'Loading the latest state from the server.' : 'Choose a target and run an exploration to begin.'}</p></section>}
  </div>;
}
