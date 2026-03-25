import { useState, useEffect } from 'react';
import projectsData from '../assets/projects.json';

interface Project {
  name: string;
  status?: string;
  description?: string;
  current_ai?: string;
  last_active?: string;
  github?: string;
  backlog?: string;
  deploy?: string;
  drive?: string;
  local?: string;
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
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('All');

  useEffect(() => {
    try {
      setProjects(projectsData as Project[]);
    } catch {
      setProjects([]);
    }
  }, []);

  const statuses = ['All', ...Array.from(new Set(projects.map(p => p.status || 'Unknown')))];

  const filtered = projects.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === 'All' || p.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const handleCopy = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    alert(`Copied ${label} path: ${text}`);
  };

  return (
    <div className="status-tab">
      <div className="tab-section-header">
        <p className="tab-section-desc">
        </p>
      </div>

      {/* Stats strip */}
      <div className="status-stats-row">
        {[
          { label: 'Total', value: projects.length },
          { label: 'Active', value: projects.filter(p => (p.status || '').includes('Active')).length },
          { label: 'Standing', value: projects.filter(p => (p.status || '').includes('Standing')).length },
          { label: 'Tabs', value: projects.filter(p => p.status === 'Active Tab').length },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-num">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="status-filters">
        <input className="field-input search-input" placeholder="Search projects..." value={search}
          onChange={e => setSearch(e.target.value)} />
        <div className="filter-group">
          {statuses.map(s => (
            <button key={s} className={`filter-btn ${filterStatus === s ? 'active' : ''}`}
              onClick={() => setFilterStatus(s)}>{s}</button>
          ))}
        </div>
      </div>

      {/* Projects grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">No projects found. Run <code>npm run dev</code> to sync from registry.</div>
      ) : (
        <div className="projects-grid">
          {filtered.map(p => (
            <div key={p.name} className="card project-card">
              <div className="project-card-header">
                <span className="project-name">{p.name}</span>
                {p.status && (
                  <span className="status-badge"
                    style={{ background: (STATUS_COLOR[p.status] || '#7F8589') + '22', color: STATUS_COLOR[p.status] || '#7F8589' }}>
                    {p.status}
                  </span>
                )}
              </div>
              {p.description && <p className="project-desc">{p.description}</p>}
              
              <div className="project-meta-links">
                {p.drive && (
                  p.drive.startsWith('http') ? (
                    <a href={p.drive} target="_blank" rel="noreferrer" className="path-copy-btn" title="Open in Google Drive" style={{textDecoration: 'none'}}>
                      ☁ Open Drive Folder
                    </a>
                  ) : (
                    <button className="path-copy-btn" onClick={() => handleCopy(p.drive!, 'Drive')} title={p.drive}>
                      ☁ Copy Drive Path
                    </button>
                  )
                )}
                {p.local && p.local.includes('C:') && (
                  <button className="path-copy-btn" onClick={() => handleCopy(p.local!, 'Local')} title={p.local}>
                    💻 Copy Local Path
                  </button>
                )}
              </div>

              <div className="project-meta">
                {p.last_active && <span>🕐 {p.last_active}</span>}
                {p.current_ai && <span>🤖 {p.current_ai}</span>}
                {p.github && (
                  <a href={`https://github.com/3pmo/${p.github.replace(/`/g,'')}`} target="_blank" rel="noreferrer"
                    className="meta-link">⎇ GitHub</a>
                )}
              </div>
              {p.backlog && <div className="project-backlog">{p.backlog}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
