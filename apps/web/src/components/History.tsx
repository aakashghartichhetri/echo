import { useMemo, useState } from 'react';
import { formatDate, isActive, shortId } from '../format';
import type { RunSummary, RunStatus } from '../types';

export function History({ runs, onInspect, onCancel, onDelete, onRefresh }: {
  runs: RunSummary[];
  onInspect: (id: string) => void;
  onCancel: (id: string) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const filtered = useMemo(() => runs.filter((run) => (status === 'ALL' || run.status === status) &&
    (!search.trim() || `${run.id} ${run.targetId}`.toLowerCase().includes(search.trim().toLowerCase()))), [runs, search, status]);

  return <div className="history-page">
    <header className="page-heading intro-heading"><div className="eyebrow"><span className="eyebrow-rule"/> EXPERIMENT HISTORY</div><h1>Keep the evidence<span className="heading-period">.</span></h1><p>Review past experiments, follow in-progress work, and download reports when you need them.</p></header>
    <section className="panel history-panel">
      <div className="panel-heading-row history-heading"><div><h3>Saved runs <span className="count-badge">{runs.length}</span></h3><p>Showing the 50 most recent runs. Refresh to see new results.</p></div><button className="btn btn-outline small" onClick={onRefresh}>↻ Refresh</button></div>
      <div className="history-filters"><label className="search-field"><span className="sr-only">Search runs</span><span aria-hidden="true">⌕</span><input placeholder="Search target or run ID" value={search} onChange={(event) => setSearch(event.target.value)}/></label><label className="sr-only" htmlFor="history-status">Filter by status</label><select id="history-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="ALL">All statuses</option>{(['COMPLETED','RUNNING','QUEUED','FAILED','CANCELLED'] satisfies RunStatus[]).map((value) => <option key={value} value={value}>{value.toLowerCase()}</option>)}</select></div>
      <div className="table-scroll history-table"><table className="data-table"><thead><tr><th>RUN</th><th>TARGET</th><th>DATE</th><th>STATUS</th><th>STATES</th><th>FINDINGS</th><th>ACTIONS</th></tr></thead><tbody>{filtered.map((run) => <tr key={run.id}>
        <td><code>{shortId(run.id)}</code></td><td className="table-target">{run.targetId}</td><td>{formatDate(run.createdAt)}</td><td><span className={`status-chip ${run.status === 'COMPLETED' ? 'complete' : isActive(run.status) ? 'running' : 'warning'}`}><span className="status-dot"/>{run.status.toLowerCase()}</span></td><td>{run.stateCount}</td><td>{run.findingCount}</td><td className="table-actions"><button className="text-button" onClick={() => onInspect(run.id)}>Inspect ↗</button>{isActive(run.status) ? <button className="text-button danger" onClick={() => onCancel(run.id)}>Cancel</button> : !run.id.startsWith('demo-') && <button className="text-button danger" onClick={() => onDelete(run.id)}>Delete</button>}</td>
      </tr>)}</tbody></table></div>
      <div className="history-mobile">{filtered.map((run) => <div className="history-mobile-item" key={run.id}><div><strong>{run.targetId}</strong><small>{formatDate(run.createdAt)} · {shortId(run.id)}</small></div><div><span>{run.status.toLowerCase()} · {run.findingCount} findings</span><button className="text-button" onClick={() => onInspect(run.id)}>Inspect ↗</button>{isActive(run.status) ? <button className="text-button danger" onClick={() => onCancel(run.id)}>Cancel</button> : !run.id.startsWith('demo-') && <button className="text-button danger" onClick={() => onDelete(run.id)}>Delete</button>}</div></div>)}</div>
      {filtered.length === 0 && <div className="empty-table">{runs.length === 0 ? 'No runs yet. Start an exploration to create your first report.' : 'No runs match your search.'}</div>}
    </section>
  </div>;
}
