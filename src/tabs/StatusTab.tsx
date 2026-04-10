interface Issue {
  id: string;
  project_slug: string;
  type: 'bug' | 'enhancement';
  status: 'Captured' | 'Comp' | 'DoD' | 'SIT' | 'UAT' | 'Done' | 'Blocked';
  logged_date?: string;
  created_at?: any;
  updated_at?: any;
  test_compile?: string;
  test_dod?: string;
  test_sit?: string;
  dod_items?: { task: string; completed: boolean }[];
}

const STATUS_COLOR: Record<string, string> = {
  'Captured': '#AAAAAA',
  'Comp': '#469CBE',
  'DoD': '#D4AF37',
  'SIT': '#FF9E1B',
  'UAT': '#c4ff61',
  'Done': '#7CC170',
  'Blocked': '#ff4757',
  'Standing': '#FF9E1B',
  'Active Tab': '#469CBE',
};

export default function StatusTab() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [history, setHistory] = useState<any[]>([]);
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
          last_active: d.last_active?.toDate ? d.last_active.toDate().toISOString().slice(0, 10) : (d.last_active || null),
          created_at: d.created_at?.toDate ? d.created_at.toDate().toISOString().slice(0, 10) : null,
          github: d.github_repo || null,
          drive: d.drive_path || null,
          local: d.local_path || null,
          deploy: d.deploy_method || null,
          category: d.category || 'active',
        } as Project;
      });

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

  // ── Live issues from Firestore ──
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

  // ── Live history from Firestore ──
  useEffect(() => {
    const q = query(collection(firestore, 'issue_history'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsed = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(parsed);
    });
    return () => unsubscribe();
  }, []);

  // ── Derived data ──

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

  const issuesByProject = issues.reduce((acc, iss) => {
    if (['Done', 'Blocked'].includes(iss.status)) return acc;
    if (!acc[iss.project_slug]) acc[iss.project_slug] = { bugs: 0, enhancements: 0 };
    if (iss.type === 'bug') acc[iss.project_slug].bugs++;
    else acc[iss.project_slug].enhancements++;
    return acc;
  }, {} as Record<string, { bugs: number; enhancements: number }>);

  const openIssues = issues.filter(i => !['Done', 'Blocked'].includes(i.status));
  const totalOpenBugs = openIssues.filter(i => i.type === 'bug').length;
  const totalOpenEnhs = openIssues.filter(i => i.type === 'enhancement').length;
  const totalBugsAll = issues.filter(i => i.type === 'bug').length;
  const totalEnhsAll = issues.filter(i => i.type === 'enhancement').length;
  const totalWorkUnits = issues.reduce((sum, iss) => sum + calculateWorkPoints(iss), 0);

  // Issue graph data — Consolidated Cumulative Progress
  const graphData = (() => {
    const byDate: Record<string, { 
      date: string; 
      bugs: number; 
      enhancements: number; 
      projects: number; 
      remediated: number; 
      total_created: number;
      work_points: number;
    }> = {};
    
    const getDateStr = (val: any) => {
      if (!val) return null;
      if (typeof val === 'string') return val.slice(0, 10);
      if (val.toDate) return val.toDate().toISOString().slice(0, 10);
      if (val._seconds) return new Date(val._seconds * 1000).toISOString().slice(0, 10);
      return null;
    };

    // 1. Process Issues (Creation)
    issues.forEach(iss => {
      const date = getDateStr(iss.logged_date) ?? getDateStr(iss.created_at);
      if (!date || isNaN(new Date(date).getTime())) return;
      if (!byDate[date]) byDate[date] = { date, bugs: 0, enhancements: 0, projects: 0, remediated: 0, total_created: 0, work_points: 0 };
      if (iss.type === 'bug') byDate[date].bugs++;
      else byDate[date].enhancements++;
      byDate[date].total_created++;
    });

    // 2. Process History (Remediation Events & Work Units)
    // For work points, we use the issue's updated_at or history timestamp
    issues.forEach(iss => {
      const workPts = calculateWorkPoints(iss);
      if (workPts > 0) {
        const date = getDateStr(iss.updated_at) ?? getDateStr(iss.created_at);
        if (date && !isNaN(new Date(date).getTime())) {
          if (!byDate[date]) byDate[date] = { date, bugs: 0, enhancements: 0, projects: 0, remediated: 0, total_created: 0, work_points: 0 };
          byDate[date].work_points += workPts;
        }
      }
    });

    history.forEach(h => {
      const statusChange = h.changes?.status;
      if (statusChange && ['Done', 'Blocked', 'UAT'].includes(statusChange.new)) {
        const date = getDateStr(h.timestamp);
        if (date && !isNaN(new Date(date).getTime())) {
          if (!byDate[date]) byDate[date] = { date, bugs: 0, enhancements: 0, projects: 0, remediated: 0, total_created: 0, work_points: 0 };
          byDate[date].remediated++;
        }
      }
    });

    // 3. Process Projects (Creation)
    projects.forEach(proj => {
      const date = getDateStr(proj.created_at) ?? getDateStr(proj.last_active);
      if (!date || isNaN(new Date(date).getTime())) return;
      if (!byDate[date]) byDate[date] = { date, bugs: 0, enhancements: 0, projects: 0, remediated: 0, total_created: 0, work_points: 0 };
      byDate[date].projects++;
    });

    const sortedDates = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
    
    let cumulativeBugs = 0;
    let cumulativeEnhs = 0;
    let cumulativeProjects = 0;
    let cumulativeRemediated = 0;
    let cumulativeTotalCreated = 0;
    let cumulativeWorkPoints = 0;
    
    return sortedDates.map(d => {
      cumulativeBugs += d.bugs;
      cumulativeEnhs += d.enhancements;
      cumulativeProjects += d.projects;
      cumulativeRemediated += d.remediated;
      cumulativeTotalCreated += d.total_created;
      cumulativeWorkPoints += d.work_points;
      
      const [y, m, day] = d.date.split('-').map(Number);
      const dateObj = new Date(y, m - 1, day);
      return {
        ...d,
        bugs_created: cumulativeBugs,
        enh_created: cumulativeEnhs,
        projects_created: cumulativeProjects,
        remediated_count: cumulativeRemediated,
        total_backlog: cumulativeTotalCreated,
        remediation_effort: cumulativeWorkPoints,
        date: isNaN(dateObj.getTime()) 
          ? 'Unknown' 
          : dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
      };
    });
  })();

  const filtered = projects.filter(p => {
    const matchSearch = !search
      || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.description || '').toLowerCase().includes(search.toLowerCase());
    
    let matchMetric = true;
    if (filterMetric === 'Bugs') matchMetric = (issuesByProject[p.name]?.bugs || 0) > 0;
    else if (filterMetric === 'Enhancements') matchMetric = (issuesByProject[p.name]?.enhancements || 0) > 0;
    else if (filterMetric === 'Active') matchMetric = (p.status || '').includes('Active') || ['Captured', 'Comp', 'DoD', 'SIT', 'UAT'].includes(p.status || '');
    else if (filterMetric === 'Standing') matchMetric = p.status === 'Standing';
    else if (filterMetric === 'Active Tab') matchMetric = p.status === 'Active Tab';

    const matchStatus = filterStatus === 'All' || p.status === filterStatus;
    
    return matchSearch && matchMetric && matchStatus;
  });

  return (
    <div className="status-tab">

      <div className="status-stats-row" style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Total Projects', value: projects.length, type: 'All' },
          { label: 'Active',         value: projects.filter(p => (p.status || '').includes('Active') || ['Captured', 'Comp', 'DoD', 'SIT', 'UAT'].includes(p.status || '')).length, type: 'Active' },
          { label: 'Standing',       value: projects.filter(p => p.status === 'Standing').length, type: 'Standing' },
          { label: 'Tabs',           value: projects.filter(p => p.status === 'Active Tab').length, type: 'Active Tab' },
        ].map(s => (
          <button 
            key={s.label} 
            className={`stat-tile ${filterMetric === s.type ? 'selected' : ''}`}
            style={{ flex: '1 1 140px', padding: '0.85rem 1rem', textAlign: 'left' }}
            onClick={() => {
              setFilterMetric(filterMetric === s.type ? 'All' : s.type as any);
              setFilterStatus('All');
            }}
          >
            <div className="stat-number" style={{ fontSize: '1.4rem', fontWeight: 'bold', lineHeight: 1 }}>
              {projectsLoading ? '…' : s.value}
            </div>
            <div className="stat-label" style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              {s.label}
            </div>
          </button>
        ))}
        
        <button 
          className={`stat-tile ${filterMetric === 'Bugs' ? 'selected' : ''}`}
          style={{ flex: '1 1 160px', padding: '0.85rem 1rem', textAlign: 'left' }}
          onClick={() => {
            setFilterMetric(filterMetric === 'Bugs' ? 'All' : 'Bugs');
            setFilterStatus('All');
          }}
        >
          <div className="stat-number" style={{ fontSize: '1.4rem', fontWeight: 'bold', lineHeight: 1, color: '#FF6B6B' }}>
            {issuesLoading ? '…' : totalOpenBugs} <span style={{fontSize: '0.8rem', fontWeight: 'normal'}}>filtered Bugs</span>
          </div>
          <div className="stat-label" style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            of {totalBugsAll} Total Bugs
          </div>
        </button>

        <button 
          className={`stat-tile ${filterMetric === 'Enhancements' ? 'selected' : ''}`}
          style={{ flex: '1 1 160px', padding: '0.85rem 1rem', textAlign: 'left' }}
          onClick={() => {
            setFilterMetric(filterMetric === 'Enhancements' ? 'All' : 'Enhancements');
            setFilterStatus('All');
          }}
        >
          <div className="stat-number" style={{ fontSize: '1.4rem', fontWeight: 'bold', lineHeight: 1, color: 'var(--pmo-green)' }}>
            {issuesLoading ? '…' : totalOpenEnhs} <span style={{fontSize: '0.8rem', fontWeight: 'normal'}}>filtered Enh.</span>
          </div>
          <div className="stat-label" style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            of {totalEnhsAll} Total Enh.
          </div>
        </button>

        {/* New KPI: Remediation Effort (#h3sJDtR8SiUIvjCgjlSV) */}
        <button 
          className={`stat-tile ${filterMetric === 'Work' ? 'selected' : ''}`}
          style={{ flex: '1 1 160px', padding: '0.85rem 1rem', textAlign: 'left' }}
          onClick={() => {
            setFilterMetric(filterMetric === 'Work' ? 'All' : 'Work');
            setFilterStatus('All');
          }}
        >
          <div className="stat-number" style={{ fontSize: '1.4rem', fontWeight: 'bold', lineHeight: 1, color: 'var(--pmo-gold)' }}>
            {issuesLoading ? '…' : totalWorkUnits} <span style={{fontSize: '0.8rem', fontWeight: 'normal'}}>Units</span>
          </div>
          <div className="stat-label" style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Remediation Effort
          </div>
        </button>

      </div>

      {/* ── Issue Graph (LineChart with Cumulative Progress) ── */}
      {!issuesLoading && graphData.length > 0 && (
        <div className="card status-graph-card">
          <div className="status-graph-header">
            <h3>Cumulative System Maturity</h3>
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
              <Line 
                type="monotone" 
                dataKey="total_backlog" 
                name="Total Backlog" 
                stroke="var(--pmo-gold)" 
                strokeWidth={3}
                dot={{ fill: 'var(--pmo-gold)', r: 3 }}
                activeDot={{ r: 6 }}
              />
              <Line 
                type="monotone" 
                dataKey="remediation_effort" 
                name="Remediation Work (RU)" 
                stroke="var(--pmo-green)" 
                strokeWidth={4}
                strokeDasharray="5 5"
                dot={{ fill: 'var(--pmo-green)', r: 4 }}
                activeDot={{ r: 8 }}
              />
              <Line 
                type="monotone" 
                dataKey="remediated_count" 
                name="Remediated Issues" 
                stroke="#7CC170" 
                strokeWidth={2}
                dot={false}
              />
              <Line 
                type="monotone" 
                dataKey="bugs_created" 
                name="Cumulative Bugs" 
                stroke="#FF6B6B" 
                strokeWidth={2}
                dot={false}
              />
              <Line 
                type="monotone" 
                dataKey="enh_created" 
                name="Cumulative Enhancements" 
                stroke="#469CBE" 
                strokeWidth={2}
                dot={false}
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
