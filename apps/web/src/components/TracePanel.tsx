import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Target } from '../types';

export function TracePanel({ target }: { target: Target }) {
  const [actions, setActions] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { setActions([]); setOutputs(null); setError(''); }, [target.id]);

  const submit = async () => {
    setRunning(true); setError('');
    try { setOutputs((await api.trace(target.id, actions)).outputs); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Trace failed'); }
    finally { setRunning(false); }
  };

  if (target.id === 'external') return <p className="muted">External target traces run through the server-configured endpoint during discovery. This manual tester supports the two built-in sandboxes.</p>;
  return <div>
    <div className="panel-heading-row"><div><h3>Manual trace lab</h3><p>Build a sequence and replay it from a fresh session.</p></div><span className="tag">UP TO 12 ACTIONS</span></div>
    <div className="action-buttons">{target.actions.map((action) => <button key={action} className="action-token" disabled={actions.length >= 12 || running} onClick={() => { setActions([...actions, action]); setOutputs(null); }}>+ {action}</button>)}</div>
    <div className="trace-composer">{actions.length === 0 ? <span className="muted">Choose actions above to compose a trace.</span> : actions.map((action, index) => <span key={index} className="trace-token">{index + 1}. {action}</span>)}</div>
    <div className="inline-actions">
      <button className="btn btn-primary small" disabled={running || actions.length === 0} onClick={() => { void submit(); }}>{running ? 'Replaying…' : 'Run trace'}</button>
      <button className="btn btn-quiet small" disabled={running || actions.length === 0} onClick={() => { setActions(actions.slice(0, -1)); setOutputs(null); }}>Undo</button>
      <button className="btn btn-quiet small" disabled={running || actions.length === 0} onClick={() => { setActions([]); setOutputs(null); }}>Clear</button>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {outputs && <div className="output-grid" aria-live="polite">{outputs.map((output, index) => <div key={index}><span className="muted">{index + 1} · {actions[index]}</span><strong>{output}</strong></div>)}</div>}
  </div>;
}
