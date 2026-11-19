import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Workspace } from './App';
import { Overview } from './components/Overview';
import { ReleaseCheck } from './components/ReleaseCheck';
import type { RunSummary } from './types';

const sample: RunSummary = {
  id: 'demo-rate-limiter', targetId: 'rate-limiter', status: 'COMPLETED',
  createdAt: '2026-11-19T14:00:00Z', completedAt: '2026-11-19T14:00:05Z',
  stateCount: 4, queries: 255, casesChecked: 255, findingCount: 1,
};

describe('dashboard states', () => {
  it('keeps navigation focused on the work rather than local status or filler', () => {
    const markup = renderToStaticMarkup(<Workspace account={{ id: 'local-demo', login: 'local-demo', displayName: 'Local demo', avatarUrl: null }} onLogout={async () => {}} onDelete={async () => {}} />);
    expect(markup).toContain('Explore APIs');
    expect(markup).toContain('Release check');
    expect(markup).toContain('Open navigation');
    expect(markup).not.toContain('Local environment');
    expect(markup).not.toContain('Sandboxed · Local-first');
    expect(markup).not.toContain('ECHO / VERSION 1.0');
  });

  it('renders numbers from saved runs and explains a real finding', () => {
    const markup = renderToStaticMarkup(<Overview runs={[sample]} onExplore={() => {}} onCompare={() => {}} onInspect={() => {}} />);
    expect(markup).toContain('Recent activity');
    expect(markup).toContain('Model vs. observed output');
    expect(markup).toContain('cooldown');
    expect(markup).toContain('1 finding');
  });

  it('shows an honest empty state before a second snapshot exists', () => {
    const markup = renderToStaticMarkup(<ReleaseCheck runs={[sample]} onExplore={() => {}} />);
    expect(markup).toContain('Two saved runs');
    expect(markup).toContain('Start an exploration');
  });
});
