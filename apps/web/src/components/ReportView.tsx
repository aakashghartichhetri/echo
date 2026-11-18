import { MachineGraph } from './MachineGraph';
import type { RunDetail } from '../types';
import { compactNumber, duration, formatDate, shortId } from '../format';

export function ReportView({ run }: { run: RunDetail }) {
  const report = run.report;
  if (run.status === 'QUEUED' || run.status === 'RUNNING') return <div className="panel empty-panel"><div className="loading-ring"/><h3>{run.status === 'QUEUED' ? 'Queued for exploration' : 'Exploration in progress'}</h3><p>Replaying isolated traces, grouping observable states, then checking candidate predictions. The page refreshes automatically.</p></div>;
  if (run.status === 'CANCELLED') return <div className="panel empty-panel"><h3>Exploration cancelled</h3><p>The run was stopped before a report was created.</p></div>;
  if (run.status === 'FAILED') return <div className="panel empty-panel"><h3>Run failed</h3><p className="error-text">{run.error ?? 'Unknown error'}</p><p>Reduce the learning bounds or check that the target endpoint is reachable.</p></div>;
  if (!report) return <div className="panel empty-panel">This completed run has no saved report.</div>;

  const finding = report.findings[0];
  return <div className="report-stack">
    <div className="report-title-row">
      <div><div className="eyebrow">EXPLORATION REPORT · {shortId(run.id)}</div><h2>{report.target.name}</h2><p>Completed {formatDate(run.completedAt ?? run.createdAt)} · {duration(report.durationMs)}</p></div>
      <span className={`status-chip ${finding ? 'warning' : 'complete'}`}>{finding ? 'Difference detected' : 'No mismatch in bounds'}</span>
    </div>
    <div className="metrics four">
      <div className="metric"><span>Inferred states</span><strong>{report.machine.states.length}</strong><small>Observable equivalence classes</small></div>
      <div className="metric"><span>Transitions</span><strong>{report.machine.transitions.length}</strong><small>Total modeled edges</small></div>
      <div className="metric"><span>Verification traces</span><strong>{compactNumber(report.checkedTraces)}</strong><small>Breadth-first search</small></div>
      <div className="metric"><span>Unique probes</span><strong>{compactNumber(report.uniqueQueries)}</strong><small>{compactNumber(report.cacheHits)} cache hits</small></div>
    </div>
    {finding ? <section className="panel finding-panel">
      <div className="panel-heading-row"><div><div className="eyebrow rose">COUNTEREXAMPLE #{1}</div><h3>Learned model disagrees with the target</h3><p>The shortest mismatching trace encountered in this bounded search.</p></div><span className="status-chip warning">Step {finding.firstMismatch + 1}</span></div>
      <div className="finding-table-wrap"><table className="data-table"><thead><tr><th>Step</th><th>Input</th><th>Predicted</th><th>Observed</th><th>Result</th></tr></thead><tbody>{finding.actions.map((action, index) => <tr className={index === finding.firstMismatch ? 'mismatch-row' : ''} key={index}><td>{index + 1}</td><td><code>{action}</code></td><td><code>{finding.predicted[index]}</code></td><td><code>{finding.observed[index]}</code></td><td>{index === finding.firstMismatch ? <span className="bad-result">Mismatch</span> : <span className="good-result">Match</span>}</td></tr>)}</tbody></table></div>
      <p className="insight">The learner predicted <strong>{finding.predicted[finding.firstMismatch]}</strong>, but the black box returned <strong>{finding.observed[finding.firstMismatch]}</strong>. Review the documented target contract before classifying this as a bug.</p>
    </section> : <section className="panel"><div className="panel-heading-row"><div><div className="eyebrow mint">MODEL CHECK</div><h3>No mismatch found</h3><p>Every verified trace matched the candidate within the chosen search depth and query budget.</p></div><span className="status-chip complete">Passed in bounds</span></div></section>}
    <section className="panel"><MachineGraph machine={report.machine} /></section>
    <section className="panel"><div className="panel-heading-row"><div><h3>Method and limits</h3><p>What this result does—and does not—establish.</p></div></div>
      <div className="method-grid"><div><span>Training access depth</span><strong>{report.settings.accessDepth}</strong></div><div><span>Distinguishing suffix depth</span><strong>{report.settings.suffixDepth}</strong></div><div><span>Verification depth</span><strong>{report.settings.verifyDepth}</strong></div><div><span>Query budget</span><strong>{compactNumber(report.settings.queryLimit)}</strong></div></div>
      <p className="muted note">{report.confidenceNote}</p>
      {report.stoppedEarly && <p className="notice">Search stopped early after reaching its finding limit or query budget. This report is not an exhaustive verification of the selected depth.</p>}
    </section>
  </div>;
}
