import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import type { Target } from '../types';

export function TracePanel({ target }: { target: Target }) {
  const [actions, setActions] = useState<string[]>([]);
  const [outputs, setOutputs] = useState<string[] | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef<AbortController | null>(null);

  useEffect(() => {
    // A response from the old target must not overwrite results for a new one.
    pending.current?.abort();
    pending.current = null;
    setActions([]);
    setOutputs(null);
    setError('');
    setRunning(false);
    return () => { pending.current?.abort(); };
  }, [target.id]);

  const submit = async () => {
    const controller = new AbortController();
    pending.current = controller;
    setRunning(true);
    setError('');
    try {
      const result = await api.trace(target.id, actions, controller.signal);
      if (!controller.signal.aborted) setOutputs(result.outputs);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Trace failed');
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setRunning(false);
      }
    }
  };

  if (target.id === 'external') return <p className="muted">External target traces are run by the server during discovery. This manual tester supports the built-in sandboxes.</p>;

  return <div>
    <div className="panel-heading-row"><div><h3>Manual trace lab</h3><p>Build your own action sequence and replay it from clean state.</p></div><span className="tag">MAX 12 ACTIONS</span></div>
    <div className="action-buttons">{target.actions.map((action) => <button key={action} type="button" className="action-token" disabled={actions.length >= 12 || running} onClick={() => { setActions((previous) => [...previous, action]); setOutputs(null); }}>+ {action}</button>)}</div>
    <div className="trace-composer">{actions.length === 0 ? <span className="muted">Add an action above to start your sequence.</span> : actions.map((action, index) => <span key={index} className="trace-token">{index + 1}. {action}</span>)}</div>
    <div className="inline-actions">
      <button className="btn btn-primary small" disabled={running || actions.length === 0} onClick={() => { void submit(); }}>{running ? 'Replaying…' : 'Run trace →'}</button>
      <button className="btn btn-quiet small" disabled={running || actions.length === 0} onClick={() => { setActions((previous) => previous.slice(0, -1)); setOutputs(null); }}>Undo</button>
      <button className="btn btn-quiet small" disabled={running || actions.length === 0} onClick={() => { setActions([]); setOutputs(null); }}>Clear</button>
    </div>
    {error && <p className="error-text" role="alert">{error}</p>}
    {outputs && <div className="output-grid" aria-live="polite">{outputs.map((output, index) => <div key={index}><span className="muted">{index + 1} · {actions[index]}</span><strong>{output}</strong></div>)}</div>}
  </div>;
}
