import { useEffect, useState } from 'react';
import { api, type AccountUser } from '../api';

type Props = {
  user: AccountUser;
  onLogout: () => Promise<void>;
  onDelete: () => Promise<void>;
};

export function Account({ user, onLogout, onDelete }: Props) {
  const [usage, setUsage] = useState<{ usedToday: number; dailyLimit: number } | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const isDemo = user.id === 'local-demo';

  useEffect(() => { void api.usage().then(setUsage).catch(() => setError('Could not load usage. Refresh this page to retry.')); }, []);

  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    try { await action(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to complete your request'); }
    finally { setBusy(false); }
  }

  return <div className="account-page">
    <header className="page-heading intro-heading"><div className="eyebrow">YOUR ACCOUNT</div>
      <h1>Workspace settings<span className="heading-period">.</span></h1>
      <p>Stay in control of your experiments, saved reports, and account data.</p></header>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="account-grid">
      <section className="panel account-panel">
        <div className="eyebrow">IDENTITY</div>
        <h2>{user.displayName}</h2>
        <p>{isDemo ? 'Local demo · Available only on your computer' : `Signed in with GitHub as @${user.login}`}</p>
        {!isDemo && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void act(onLogout)}>Sign out</button>}
      </section>
      <section className="panel account-panel">
        <div className="eyebrow">FAIR USE</div>
        <h2>{usage ? `${usage.usedToday} of ${usage.dailyLimit}` : '—'} <span className="account-muted">runs today</span></h2>
        <p>Free workspace: up to {usage?.dailyLimit ?? 20} runs per UTC day, two active or queued at once, and 200 saved reports. Delete reports you no longer need.</p>
      </section>
    </div>
    <section className="panel account-panel account-privacy">
      <div className="eyebrow">PRIVACY & DATA</div>
      <h2>Your experiments belong to your account.</h2>
      <p>We use your GitHub public profile to identify your workspace. ECHO saves your settings, learned models, test results, and dates in PostgreSQL. We don't store GitHub access tokens. Sessions expire after seven days. Other accounts cannot read your reports through the application.</p>
      <p>Built-in test targets use simulated data. Hosted workspaces cannot submit arbitrary external URLs. Deleting your account also deletes its stored runs and login sessions.</p>
      {!isDemo && <div className="account-danger"><h3>Delete this account</h3><p>This permanently removes your ECHO workspace and saved reports. It cannot be undone.</p>
        <label htmlFor="confirm-delete">Type <strong>DELETE</strong> to confirm</label>
        <div className="account-delete-controls"><input id="confirm-delete" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" placeholder="DELETE" />
          <button className="btn btn-danger" type="button" disabled={confirmation !== 'DELETE' || busy} onClick={() => void act(onDelete)}>Delete account and data</button></div>
      </div>}
    </section>
  </div>;
}
