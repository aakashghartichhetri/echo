import { compactNumber, formatDate, shortId } from '../format';
import type { RunSummary } from '../types';

type Props = {
  runs: RunSummary[];
  onExplore: (targetId?: string) => void;
  onCompare: () => void;
  onInspect: (id: string) => void;
};

function Metric({ label, value, note, index }: { label: string; value: number | string; note: string; index: number }) {
  return <div className="metric">
    <span className="metric-index">0{index}</span>
    <span className="metric-label">{label}</span>
    <strong>{value}</strong>
    <small>{note}</small>
  </div>;
}

function ExampleTrace() {
  return <div className="hero-evidence" aria-label="Reference example: a rate limiter returns an unexpected response on request eight">
    <div className="evidence-heading"><span className="evidence-pulse"/> CONTROLLED TEST <span className="evidence-more">TRACE / 08</span></div>
    <div className="evidence-title">Rate limiter / request sequence</div>
    <div className="evidence-path" aria-hidden="true">
      <span>01</span><i/><span>02</span><i/><span>03</span><i/><span>…</span><i/><span className="highlighted">08</span>
    </div>
    <div className="evidence-output"><span>Predicted</span><code>denied</code></div>
    <div className="evidence-output observed"><span>Observed</span><code>cooldown</code><strong>DIFF</strong></div>
    <div className="evidence-bottom">Observed result saved with the exact action sequence.</div>
  </div>;
}

export function Overview({ runs, onExplore, onCompare, onInspect }: Props) {
  const complete = runs.filter((run) => run.status === 'COMPLETED');
  const totalProbes = complete.reduce((total, run) => total + run.queries, 0);
  const findings = complete.reduce((total, run) => total + run.findingCount, 0);
  const recent = runs.slice(0, 5);
  const rateDemo = runs.find((run) => run.id === 'demo-rate-limiter');

  return <div className="overview">
    <div className="overview-topline"><span className="eyebrow">THE BEHAVIOR WORKSPACE</span><span className="overview-topline-rule"/></div>
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-copy">
        <div className="hero-label"><span className="hero-label-icon">✦</span> Learn from behavior, not assumptions.</div>
        <h1 id="hero-title">Understand the behavior <em>behind every response.</em></h1>
        <p>Explore a stateful API safely, learn its response patterns, and investigate changes before they reach your clients.</p>
        <div className="hero-actions">
          <button className="btn btn-hero" type="button" onClick={() => onExplore()}>Explore an API <span aria-hidden="true">↗</span></button>
          <button className="hero-secondary" type="button" onClick={onCompare}>Compare releases <span aria-hidden="true">→</span></button>
        </div>
      </div>
      <ExampleTrace/>
    </section>

    <div className="metrics" aria-label="Saved experiment metrics">
      <Metric index={1} label="Saved experiments" value={runs.length} note="Up to 50 recent runs"/>
      <Metric index={2} label="Learned models" value={complete.length} note="Completed experiments"/>
      <Metric index={3} label="Differences found" value={findings} note="Model vs. observed output"/>
      <Metric index={4} label="HTTP probes" value={compactNumber(totalProbes)} note="Across completed runs"/>
    </div>

    <div className="section-header overview-section-title"><div><span className="eyebrow">WORKSPACE SIGNALS</span><h2>Your evidence, at a glance.</h2><p>These numbers come from saved experiments in this workspace.</p></div></div>
    <div className="overview-panels">
      <section className="panel recent-panel" aria-label="Recent activity">
        <div className="panel-heading-row"><div><h3>Recent activity</h3><p>Open a report to see exactly what happened.</p></div><span className="tag">LAST {recent.length} RUNS</span></div>
        {recent.length ? <div className="recent-list">{recent.map((run) => <button type="button" key={run.id} className="recent-item" onClick={() => onInspect(run.id)}>
          <span className={`activity-mark ${run.findingCount > 0 ? 'activity-alert' : ''}`} aria-hidden="true">{run.findingCount > 0 ? '!' : '✓'}</span>
          <span className="recent-main"><strong>{run.targetId === 'rate-limiter' ? 'Rate limiter' : run.targetId === 'authentication' ? 'Authentication flow' : run.targetId}</strong><small>{formatDate(run.createdAt)} · {shortId(run.id)}</small></span>
          <span className={`recent-result ${run.findingCount ? 'has-findings' : ''}`}>{run.status === 'COMPLETED' ? `${run.findingCount} ${run.findingCount === 1 ? 'finding' : 'findings'}` : run.status.toLowerCase()}</span>
          <span className="recent-arrow" aria-hidden="true">↗</span>
        </button>)}</div> : <div className="empty-table">No experiments yet. Start with the rate limiter or authentication example.</div>}
      </section>
      <section className="panel story-panel">
        <div className="eyebrow"><span className="signal signal-amber"/> REALISTIC TEST CASE</div>
        <h2>When one response changes, clients notice.</h2>
        <p>A mobile client expects a rate-limit response. The test service returns a different value after repeated requests. ECHO records the exact trace so the team can reproduce the change.</p>
        <div className="story-trace"><span>request</span><span>× 8</span><span className="story-trace-arrow">→</span><strong>cooldown</strong></div>
        <div className="story-outcomes"><span>Expected <code>denied</code></span><span>Observed <code>cooldown</code></span></div>
        <button className="text-button story-link" type="button" onClick={() => rateDemo ? onInspect(rateDemo.id) : onExplore('rate-limiter')}>Inspect the trace <span aria-hidden="true">↗</span></button>
      </section>
    </div>

    <section className="workflow-strip" aria-label="How ECHO works">
      <div><span className="workflow-number">01 / DISCOVER</span><strong>Choose a system</strong><p>Start with a resettable API interface.</p></div>
      <span className="workflow-divider" aria-hidden="true">→</span>
      <div><span className="workflow-number">02 / MODEL</span><strong>Learn its behavior</strong><p>HTTP traces become candidate states.</p></div>
      <span className="workflow-divider" aria-hidden="true">→</span>
      <div><span className="workflow-number">03 / VERIFY</span><strong>Keep the evidence</strong><p>Inspect mismatches and compare releases.</p></div>
    </section>
  </div>;
}
