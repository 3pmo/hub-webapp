import { useState, useEffect } from 'react';
import { firestore } from '../services/firebase';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts';
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
  test_compile?: string;
  test_dod?: string;
  test_sit?: string;
  dod_items?: { task: string; completed: boolean }[];
}

const STATUS_COLOR: Record<string, string> = {
  'Active': '#7CC170',
  'Standing': '#FF9E1B',
  'Deployed': '#c4ff61',
  'Active Tab': '#469CBE',
  'Initiating': '#aaaaaa',
};

export default function StatusTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(true);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [filterMetric, setFilterMetric] = useState<'All' | 'Active' | 'Standing' | 'Active Tab' | 'Bugs' | 'Enhancements' | 'Work'>('All');

  // ── Live projects from Firestore (Sync with SSOT) ──
  useEffect(() => {
    const q = query(collection(firestore, 'projects'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsed: Project[] = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          name: d.name || doc.id,
          status: d.status || null,
          description: d.description || null,
          current_ai: d.current_ai || null,
          // Firestore Timestamp to ISO string
          last_active: d.last_active?.toDate ? d.last_active.toDate().toISOString().slice(0, 10) : (d.last_active || null),
          github: d.github_repo || null,
          drive: d.drive_path || null,
          local: d.local_path || null,
          deploy: d.deploy_method || null,
          category: d.category || 'active',
        } as Project;
      });

      // Sort: standing -> active -> tab, then alphabetically
      const order: Record<string, number> = { standing: 0, active: 1, tab: 2 };
      const sorted = parsed.sort((a, b) => {
        const ao = order[a.category!] ?? 9;
        const bo = order[b.category!] ?? 9;
        if (ao !== bo) return ao - bo;
        return a.name.localeCompare(b.name);
      });

      setProjects(sorted);
      setProjectsLoading(false);
      setLastUpdated(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    });
    return () => unsubscribe();
  }, []);

  // ── Live issues from Firestore ────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(firestore, 'issues'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsed: Issue[] = [];
      snapshot.forEach(doc => parsed.push({ id: doc.id, ...doc.data() } as Issue));
      setIssues(parsed);
      setIssuesLoading(false);
      setLastUpdated(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    });
    return () => unsubscribe();
  }, []);

  // ── Derived data ──────────────────────────────────────────────────────────

  // Helper to calculate remediation work points (#h3sJDtR8SiUIvjCgjlSV)
  const calculateWorkPoints = (iss: Issue) => {
    let pts = 0;
    if (iss.test_compile === '✅') pts++;
    if (iss.test_dod === '✅') pts++;
    if (iss.test_sit === '✅') pts++;
    if (iss.dod_items) {
      pts += iss.dod_items.filter(i => i.completed).length;
    }
    // Also count being "Done" or "Closed" or "UAT" as work units
    if (['Done', 'Closed', 'UAT'].includes(iss.status)) pts += 1;
    return pts;
  };

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
  const totalWorkUnits = issues.reduce((sum, iss) => sum + calculateWorkPoints(iss), 0);

  // Issue graph data — CUMULATIVE progress (#a0oY7P)
  const graphData = (() => {
    const byDate: Record<string, { date: string; bugs: number; enhancements: number; work: number }> = {};
    issues.forEach(iss => {
      const ld = iss.logged_date as any;
      const raw: string | null = typeof ld === 'string' ? ld
        : (ld?.toDate ? ld.toDate().toISOString().slice(0, 10) : null)
          ?? (iss.created_at?.toDate ? iss.created_at.toDate().toISOString().slice(0, 10) : null);
      if (!raw) return;
      const date = raw.slice(0, 10);
      if (isNaN(new Date(date).getTime())) return;
      
      const workPts = calculateWorkPoints(iss);
      
      if (!byDate[date]) byDate[date] = { date, bugs: 0, enhancements: 0, work: 0 };
      if (iss.type === 'bug') byDate[date].bugs++;
      else byDate[date].enhancements++;
      byDate[date].work += workPts;
    });

    const sortedDates = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    
    // Calculate cumulative totals
    let cumulativeBugs = 0;
    let cumulativeEnhs = 0;
    let cumulativeWork = 0;
    
    return sortedDates.map(d => {
      cumulativeBugs += d.bugs;
      cumulativeEnhs += d.enhancements;
      cumulativeWork += d.work;
      
      const [y, m, day] = d.date.split('-').map(Number);
      const dateObj = new Date(y, m - 1, day);
      return {
        ...d,
        bugs: cumulativeBugs,
        enhancements: cumulativeEnhs,
        total: cumulativeBugs + cumulativeEnhs,
        remediation: cumulativeWork,
        date: isNaN(dateObj.getTime()) 
          ? 'Unknown' 
          : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      };
    });
  })();

  // Filtered project list
  const filtered = projects.filter(p => {
    const matchSearch = !search
      || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.description || '').toLowerCase().includes(search.toLowerCase());
    
    // Metric filter logic
    let matchMetric = true;
    if (filterMetric === 'Bugs') matchMetric = (issuesByProject[p.name]?.bugs || 0) > 0;
    else if (filterMetric === 'Enhancements') matchMetric = (issuesByProject[p.name]?.enhancements || 0) > 0;
    else if (filterMetric === 'Active') matchMetric = p.status === 'Active';
    else if (filterMetric === 'Standing') matchMetric = p.status === 'Standing';
    else if (filterMetric === 'Active Tab') matchMetric = p.status === 'Active Tab';

    const matchStatus = filterStatus === 'All' || p.status === filterStatus;
    
    return matchSearch && matchMetric && matchStatus;
  });

  return (
    <div className="status-tab">

      {/* ── KPI Stats Strip (Interactive Filters) ── */}
      <div className="status-stats-row">
        {[
          { label: 'All Projects', value: projects.length, type: 'All' },
          { label: 'Active',       value: projects.filter(p => (p.status || '').includes('Active')).length, type: 'Active' },
          { label: 'Standing',     value: projects.filter(p => p.status === 'Standing').length, type: 'Standing' },
          { label: 'Tabs',         value: projects.filter(p => p.status === 'Active Tab').length, type: 'Active Tab' },
        ].map(s => (
          <button 
            key={s.label} 
            className={`stat-card ${filterMetric === s.type ? 'active' : ''}`}
            onClick={() => {
              setFilterMetric(filterMetric === s.type ? 'All' : s.type as any);
              setFilterStatus('All');
            }}
          >
            <div className="stat-num">{projectsLoading ? '…' : s.value}</div>
            <div className="stat-label">{s.label}</div>
          </button>
        ))}
        
        <button 
          className={`stat-card stat-card--bug ${filterMetric === 'Bugs' ? 'active' : ''}`}
          onClick={() => {
            setFilterMetric(filterMetric === 'Bugs' ? 'All' : 'Bugs');
            setFilterStatus('All');
          }}
        >
          <div className="stat-num">{issuesLoading ? '…' : totalOpenBugs}</div>
          <div className="stat-label">🐛 Active Bugs</div>
          {!issuesLoading && <div className="stat-sub">{totalOpenBugs} of {totalBugsAll} total</div>}
        </button>

        <button 
          className={`stat-card stat-card--enh ${filterMetric === 'Enhancements' ? 'active' : ''}`}
          onClick={() => {
            setFilterMetric(filterMetric === 'Enhancements' ? 'All' : 'Enhancements');
            setFilterStatus('All');
          }}
        >
          <div className="stat-num">{issuesLoading ? '…' : totalOpenEnhs}</div>
          <div className="stat-label">🚀 Active Enhs</div>
          {!issuesLoading && <div className="stat-sub">{totalOpenEnhs} of {totalEnhsAll} total</div>}
        </button>

        {/* New KPI: Remediation Effort (#h3sJDtR8SiUIvjCgjlSV) */}
        <button 
          className={`stat-card stat-card--work ${filterMetric === 'Work' ? 'active' : ''}`}
          onClick={() => {
            setFilterMetric(filterMetric === 'Work' ? 'All' : 'Work');
            setFilterStatus('All');
          }}
        >
          <div className="stat-num">{issuesLoading ? '…' : totalWorkUnits}</div>
          <div className="stat-label">🛠 Remediation Units</div>
          {!issuesLoading && <div className="stat-sub">Total verified effort points</div>}
        </button>

      </div>

      {/* ── Issue Graph (LineChart with Cumulative Progress) ── */}
      {!issuesLoading && graphData.length > 0 && (
        <div className="card status-graph-card">
          <div className="status-graph-header">
            <h3 className="status-graph-title">Work Evolution & Remediation Velocity</h3>
            <div className="status-graph-meta">
              <span className="status-graph-sub">All projects · {issues.length} lifetime items</span>
              {lastUpdated && <span className="status-last-updated">Last Updated: {lastUpdated}</span>}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={graphData} margin={{ top: 12, right: 30, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(255,255,255,0.05)" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 11, fill: 'var(--pmo-grey)' }} 
                axisLine={false}
                tickLine={false}
              />
              <YAxis 
                allowDecimals={false} 
                tick={{ fontSize: 11, fill: 'var(--pmo-grey)' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-elevated)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  fontSize: '0.85rem',
                  color: 'var(--text-primary)',
                }}
              />
              <Legend 
                wrapperStyle={{ fontSize: '0.8rem', color: 'var(--text-secondary)', paddingTop: '15px' }} 
                iconType="circle"
              />
              {/* Total Backlog (Gold) */}
              <Line 
                type="monotone" 
                dataKey="total" 
                name="Total Backlog" 
                stroke="var(--pmo-gold)" 
                strokeWidth={3}
                dot={{ fill: 'var(--pmo-gold)', r: 3 }}
                activeDot={{ r: 6 }}
              />
              {/* Remediation Effort (Green) */}
              <Line 
                type="monotone" 
                dataKey="remediation" 
                name="Remediation Work (RU)" 
                stroke="var(--pmo-green)" 
                strokeWidth={4}
                strokeDasharray="5 5"
                dot={{ fill: 'var(--pmo-green)', r: 4 }}
                activeDot={{ r: 8 }}
              />
              <Line 
                type="monotone" 
                dataKey="bugs" 
                name="Cumulative Bugs" 
                stroke="#FF6B6B" 
                strokeWidth={2}
                dot={{ fill: '#FF6B6B', r: 2 }}
                activeDot={{ r: 4 }}
              />
              <Line 
                type="monotone" 
                dataKey="enhancements" 
                name="Cumulative Enhancements" 
                stroke="#469CBE" 
                strokeWidth={2}
                dot={{ fill: '#469CBE', r: 2 }}
                activeDot={{ r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* ── Projects Section Header ── */}
      <div className="status-grid-header">
        <h3 className="status-grid-title">Projects & Health</h3>
        <div className="filter-group">
          <span className="filter-label hide-mobile">Quick Search:</span>
          <input
            className="field-input search-input"
            placeholder="Filter projects..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
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
                      {`🐛 ${liveCounts?.bugs || 0} Bug${(liveCounts?.bugs || 0) !== 1 ? 's' : ''}`}
                    </span>
                    <span className="issue-chip-sep"> | </span>
                    <span className={`issue-chip ${(liveCounts?.enhancements || 0) > 0 ? 'issue-chip--enh' : 'issue-chip--zero'}`}>
                      {`🚀 ${liveCounts?.enhancements || 0} Enhancement${(liveCounts?.enhancements || 0) !== 1 ? 's' : ''}`}
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
