import { useState, useEffect } from 'react';
import { firestore } from '../services/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import projectsData from '../assets/projects.json';
import { formatDate } from '../utils/formatDate';

interface Project {
  name: string;
  status?: string | null;
  description?: string | null;
  current_ai?: string | null;
  last_active?: string | null;
  github?: string | null;
  backlog?: string | null;
  deploy?: string | null;
  drive?: string | null;
  local?: string | null;
  category?: string | null;
}

interface Issue {
  id: string;
  project_slug: string;
  type: 'bug' | 'enhancement';
  status: string;
  logged_date?: string;
  created_at?: any;
}

const STATUS_COLOR: Record<string, string> = {
  'Active': '#7CC170',
  'Standing': '#FF9E1B',
  'Deployed': '#c4ff61',
  'Active Tab': '#469CBE',
  'Initiating': '#aaaaaa',
};

export default function StatusTab() {
  const [projects] = useState<Project[]>(projectsData as Project[]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  // ── Live issues from Firestore ────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(firestore, 'issues'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsed: Issue[] = [];
      snapshot.forEach(doc => parsed.push({ id: doc.id, ...doc.data() } as Issue));
      setIssues(parsed);
      setIssuesLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  // Per-project open issue counts (#ZKsdzd — live from Firestore SSOT)
  const issuesByProject = issues.reduce((acc, iss) => {
    if (['Done', 'Closed', 'Parked'].includes(iss.status)) return acc;
    if (!acc[iss.project_slug]) acc[iss.project_slug] = { bugs: 0, enhancements: 0 };
    if (iss.type === 'bug') acc[iss.project_slug].bugs++;
    else acc[iss.project_slug].enhancements++;
    return acc;
  }, {} as Record<string, { bugs: number; enhancements: number }>);

  // Global KPI counts (#kRWMiI)
  const openIssues = issues.filter(i => !['Done', 'Closed', 'Parked'].includes(i.status));
  const totalOpenBugs = openIssues.filter(i => i.type === 'bug').length;
  const totalOpenEnhs = openIssues.filter(i => i.type === 'enhancement').length;
  const totalBugsAll = issues.filter(i => i.type === 'bug').length;
  const totalEnhsAll = issues.filter(i => i.type === 'enhancement').length;

  // Issue graph data — group by date (#a0oY7P)
  const graphData = (() => {
    const byDate: Record<string, { date: string; bugs: number; enhancements: number }> = {};
    issues.forEach(iss => {
      // logged_date may be a Firestore Timestamp at runtime even though typed as string
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ld = iss.logged_date as any;
      const raw: string | null = typeof ld === 'string' ? ld
        : (ld?.toDate ? ld.toDate().toISOString().slice(0, 10) : null)
          ?? (iss.created_at?.toDate ? iss.created_at.toDate().toISOString().slice(0, 10) : null);
      if (!raw) return;
      const date = raw.slice(0, 10);
      if (isNaN(new Date(date).getTime())) return; // skip unparseable dates
      if (!byDate[date]) byDate[date] = { date, bugs: 0, enhancements: 0 };
      if (iss.type === 'bug') byDate[date].bugs++;
      else byDate[date].enhancements++;
    });
    return Object.values(byDate)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(d => ({
        ...d,
        date: new Date(d.date + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      }));
  })();

  // Filtered project list
  const statuses = ['All', ...Array.from(new Set(projects.map(p => p.status || 'Unknown')))];
  const filtered = projects.filter(p => {
    const matchSearch = !search
      || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.description || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  return (
    <div className="status-tab">

      {/* ── KPI Stats Strip (#kRWMiI: adds live bug/enh counts) ── */}
      <div className="status-stats-row">
        {[
          { label: 'Total',    value: projects.length },
          { label: 'Active',   value: projects.filter(p => (p.status || '').includes('Active')).length },
          { label: 'Standing', value: projects.filter(p => p.status === 'Standing').length },
          { label: 'Tabs',     value: projects.filter(p => p.status === 'Active Tab').length },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-num">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
        <div className="stat-card stat-card--bug">
          <div className="stat-num">{issuesLoading ? '…' : totalOpenBugs}</div>
          <div className="stat-label">🐛 Open Bugs</div>
          {!issuesLoading && <div className="stat-sub">of {totalBugsAll} total</div>}
        </div>
        <div className="stat-card stat-card--enh">
          <div className="stat-num">{issuesLoading ? '…' : totalOpenEnhs}</div>
          <div className="stat-label">🚀 Open Enhs</div>
          {!issuesLoading && <div className="stat-sub">of {totalEnhsAll} total</div>}
        </div>
      </div>

      {/* ── Issue Graph (#a0oY7P) ── */}
      {!issuesLoading && graphData.length > 0 && (
        <div className="card status-graph-card">
          <div className="status-graph-header">
            <h3 className="status-graph-title">Issues Logged Over Time</h3>
            <span className="status-graph-sub">All projects · {issues.length} total</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={graphData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--pmo-grey)' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--pmo-grey)' }} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '6px',
                  fontSize: '0.8rem',
                  color: 'var(--text-primary)',
                }}
              />
              <Legend wrapperStyle={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }} />
              <Bar dataKey="bugs" name="Bugs" fill="#FF6B6B" radius={[3, 3, 0, 0]} />
              <Bar dataKey="enhancements" name="Enhancements" fill="#469CBE" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Filter Bar ── */}
      <div className="status-filters">
        <input
          className="field-input search-input"
          placeholder="Search projects..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <div className="filter-group">
          {statuses.map(s => (
            <button
              key={s}
              className={`filter-btn ${filterStatus === s ? 'active' : ''}`}
              onClick={() => setFilterStatus(s)}
            >{s}</button>
          ))}
        </div>
        {/* Refresh button (#KkvylY) */}
        <button
          className="filter-btn status-refresh-btn"
          onClick={() => window.location.reload()}
          title="Force-refresh all data"
        >🔄 Refresh</button>
      </div>

      {/* ── Projects Grid ── */}
      {filtered.length === 0 ? (
        <div className="empty-state">No projects found.</div>
      ) : (
        <div className="projects-grid">
          {filtered.map(p => {
            const liveCounts = issuesByProject[p.name];
            return (
              <div key={p.name} className="card project-card">
                <div className="project-card-header">
                  <span className="project-name">{p.name}</span>
                  {p.status && (
                    <span
                      className="status-badge"
                      style={{
                        background: (STATUS_COLOR[p.status] || '#7F8589') + '22',
                        color: STATUS_COLOR[p.status] || '#7F8589',
                      }}
                    >{p.status}</span>
                  )}
                </div>

                {p.description && <p className="project-desc">{p.description}</p>}

                <div className="project-meta">
                  {p.last_active && <span>🕐 {formatDate(p.last_active)}</span>}
                  {p.current_ai && <span>🤖 {p.current_ai}</span>}
                  {/* Drive URL (#doCrHy — renders when drive_path starts with https://) */}
                  {p.drive?.startsWith('http') && (
                    <a className="meta-link" href={p.drive} target="_blank" rel="noreferrer">☁ Drive</a>
                  )}
                  {p.github && (
                    <a
                      href={`https://github.com/${p.github.replace(/`/g, '')}`}
                      target="_blank" rel="noreferrer"
                      className="meta-link"
                    >⎇ GitHub</a>
                  )}
                </div>

                {/* Live issue counts from Firestore (#ZKsdzd) */}
                {!issuesLoading && (
                  <div className="project-issue-counts">
                    <span className={`issue-chip ${(liveCounts?.bugs || 0) > 0 ? 'issue-chip--bug' : 'issue-chip--zero'}`}>
                      🐛 {liveCounts?.bugs || 0} Bug{(liveCounts?.bugs || 0) !== 1 ? 's' : ''}
                    </span>
                    <span className="issue-chip-sep"> | </span>
                    <span className={`issue-chip ${(liveCounts?.enhancements || 0) > 0 ? 'issue-chip--enh' : 'issue-chip--zero'}`}>
                      🚀 {liveCounts?.enhancements || 0} Enhancement{(liveCounts?.enhancements || 0) !== 1 ? 's' : ''}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
