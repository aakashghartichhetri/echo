import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { formatDate, shortId } from '../format';
import type { Comparison, ModelDifference, RunSummary } from '../types';

function ComparisonTrace({ title, difference }: { title: string; difference: ModelDifference }) {
  return <div className="diff-block">
    <div className="diff-label"><span className="signal signal-amber" /> {title}</div>
    <p className="muted">The first difference appears at step {difference.mismatchAt + 1}. Use this action sequence to reproduce it.</p>
    <div className="diff-steps" aria-label="Actions in the differing trace">
      {difference.actions.map((action, index) => <span key={index} className={`diff-action ${index === difference.mismatchAt ? 'diff-action-hot' : ''}`}>{index + 1} <strong>{action}</strong></span>)}
    </div>
    <div className="table-scroll"><table className="data-table compare-table">
      <thead><tr><th>Step</th><th>Action</th><th>Before</th><th>After</th></tr></thead>
      <tbody>{difference.actions.map((action, index) => <tr className={index === difference.mismatchAt ? 'mismatch-row' : ''} key={index}>
        <td>{index + 1}</td><td><code>{action}</code></td>
        <td><code>{difference.baseline[index]}</code></td>
        <td><code>{difference.candidate[index]}</code></td>
      </tr>)}</tbody>
    </table></div>
  </div>;
}

export function ReleaseCheck({ runs, onExplore }: { runs: RunSummary[]; onExplore: () => void }) {
  const completed = useMemo(() => runs.filter((item) => item.status === 'COMPLETED'), [runs]);
  const pair = useMemo(() => {
    for (const current of completed) {
      const older = completed.find((item) => item.id !== current.id && item.targetId === current.targetId && new Date(item.createdAt).getTime() <= new Date(current.createdAt).getTime());
      if (older) return { baseline: older.id, candidate: current.id };
    }
    return { baseline: '', candidate: '' };
  }, [completed]);
  const [baseline, setBaseline] = useState('');
  const [candidate, setCandidate] = useState('');
  const [result, setResult] = useState<Comparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const selectedBaseline = completed.find((item) => item.id === baseline);
  const candidates = useMemo(() => completed.filter((item) => item.targetId === selectedBaseline?.targetId && item.id !== baseline), [completed, selectedBaseline?.targetId, baseline]);

  useEffect(() => {
    if (!baseline || !completed.some((item) => item.id === baseline)) {
      setBaseline(pair.baseline);
      setCandidate(pair.candidate);
    }
  }, [pair.baseline, pair.candidate, baseline, completed]);

  useEffect(() => {
    if (candidate && !candidates.some((item) => item.id === candidate)) {
      setCandidate(candidates[0]?.id ?? '');
    }
  }, [candidate, candidates]);

  useEffect(() => {
    if (!baseline || !candidate || baseline === candidate) { setResult(null); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setError('');
    setResult(null);
    api.compare(candidate, baseline)
      .then((next) => { if (!cancelled) setResult(next); })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Comparison failed'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [baseline, candidate]);

  const displayRun = (run: RunSummary) => `${run.targetId} · ${formatDate(run.createdAt)} · ${shortId(run.id)}`;
  const changed = Boolean(result?.observedDifference || result?.modelDifference);
  const noSharedSamples = Boolean(result && result.comparedSamples === 0);

  return <div className="release-page">
    <header className="page-heading intro-heading">
      <div className="eyebrow"><span className="eyebrow-rule" /> RELEASE CHECK</div>
      <h1>What changed between runs<span className="heading-period">?</span></h1>
      <p>Compare two snapshots of the same API. ECHO shows where observed outputs or learned behavior changed—and gives you the steps to investigate.</p>
    </header>

    <div className="release-story">
      <div className="release-story-symbol" aria-hidden="true">↗</div>
      <div><strong>A release looks healthy. But did it change behavior?</strong><p>Imagine a checkout service starts returning a different result after several failed attempts. A health check stays green, but an API client breaks. Save a run before and after the release to find the first difference.</p></div>
    </div>

    {completed.length < 2 || !pair.baseline ? <div className="panel empty-panel release-empty">
      <div className="empty-icon" aria-hidden="true">◎</div>
      <h3>Two saved runs, one clear comparison</h3>
      <p>Explore the same target twice to create your first baseline and candidate. Reports stay in the database between restarts.</p>
      <button className="btn btn-primary" onClick={onExplore}>Start an exploration <span aria-hidden="true">↗</span></button>
    </div> : <>
      <section className="panel comparison-controls" aria-label="Compare saved runs">
        <div className="panel-heading-row"><div><h3>Choose two snapshots</h3><p>Both runs must be complete and use the same action set.</p></div><span className="tag">SAVED EVIDENCE</span></div>
        <div className="compare-selectors">
          <label><span className="control-label"><span className="control-number">01</span> Before / baseline</span>
            <select value={baseline} onChange={(event) => { const id = event.target.value; setBaseline(id); const other = completed.find((item) => item.id !== id && item.targetId === completed.find((run) => run.id === id)?.targetId); setCandidate(other?.id ?? ''); }}>
              {completed.filter((item) => completed.some((other) => other.id !== item.id && other.targetId === item.targetId)).map((run) => <option key={run.id} value={run.id}>{displayRun(run)}</option>)}
            </select></label>
          <span className="compare-arrow" aria-hidden="true">→</span>
          <label><span className="control-label"><span className="control-number">02</span> After / candidate</span>
            <select value={candidate} onChange={(event) => setCandidate(event.target.value)}>
              {candidates.map((run) => <option key={run.id} value={run.id}>{displayRun(run)}</option>)}
            </select></label>
        </div>
      </section>
      {error && <div role="alert" className="alert">{error}</div>}
      {loading && <section className="panel comparison-wait" role="status"><div className="loading-ring"/><p>Comparing saved models and traces…</p></section>}
      {result && <div className="compare-result">
        <section className={`comparison-outcome ${changed ? 'has-difference' : 'no-difference'}`} aria-live="polite">
          <div className="outcome-symbol" aria-hidden="true">{changed ? '↯' : '✓'}</div>
          <div><span className="eyebrow">COMPARISON RESULT</span><h2>{changed ? 'Behavior changed.' : noSharedSamples ? 'Models match. Trace evidence is limited.' : 'No difference in saved evidence.'}</h2><p>{changed ? 'The two runs disagree in at least one saved check. Inspect the sequence below before deciding whether the change is intentional.' : noSharedSamples ? 'These reports have no common recorded verification samples. Run both targets again to collect trace evidence.' : 'The recorded traces and learned models agree. This is helpful evidence, but not proof that the implementations are identical.'}</p></div>
        </section>
        <div className="metrics compare-metrics">
          <div className="metric"><span>State pairs checked</span><strong>{result.comparedStatePairs}</strong><small>Compared without new API calls</small></div>
          <div className="metric"><span>Model transitions</span><strong>{result.comparedTransitions}</strong><small>Explored across both models</small></div>
          <div className="metric"><span>Shared trace samples</span><strong>{result.comparedSamples}</strong><small>Real saved API observations</small></div>
          <div className="metric"><span>Findings</span><strong>{result.baselineFindings} <span className="metric-arrow">→</span> {result.candidateFindings}</strong><small>Before and after</small></div>
        </div>
        {(result.observedDifference || result.modelDifference) && <section className="panel"><div className="panel-heading-row"><div><h3>The evidence</h3><p>Compare the same inputs, one step at a time.</p></div></div>
          {result.observedDifference && <ComparisonTrace title="Observed API outputs differ" difference={result.observedDifference}/>}
          {result.modelDifference && <ComparisonTrace title="Learned models differ" difference={result.modelDifference}/>}
        </section>}
        <section className="panel interpretation-panel"><h3>How to read this result</h3><p>{result.note}</p></section>
      </div>}
    </>}
  </div>;
}
