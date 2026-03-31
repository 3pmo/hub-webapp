import { useState, useEffect } from 'react';
import { firestore } from '../services/firebase';
import { collection, onSnapshot, query, orderBy, addDoc, doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { formatDate } from '../utils/formatDate';
import projects from '../assets/projects.json';

export interface Issue {
  id: string;
  project_slug: string;
  type: 'bug' | 'enhancement';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  title: string;
  description: string;
  status: 'Open' | 'In Progress' | 'UAT' | 'Done' | 'Parked';
  logged_date: string;
  test_compile: '⬜' | '✅' | 'N/A';
  test_dod: '⬜' | '✅' | 'N/A';
  test_sit: '⬜' | '✅' | 'N/A';
  test_uat: '⬜' | '✅' | 'N/A';
  dod_items?: { task: string; completed: boolean }[];
  created_at?: any;
  created_by?: string;
  updated_at?: any;
  updated_by?: string;
}

export default function IssueTrackerTab() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterProject, setFilterProject] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('Open'); // Open = Not Done/Parked
  const [searchText, setSearchText] = useState('');
  const [searchId, setSearchId] = useState('');

  // Sort
  const [sortField, setSortField] = useState<'status' | 'priority' | 'project_slug' | 'updated_at'>('status');
  const [sortAsc, setSortAsc] = useState(true);

  // Form / Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [editingDoDIdx, setEditingDoDIdx] = useState<number | null>(null);
  const [voiceField, setVoiceField] = useState<'title' | 'description' | null>(null);
  const [formData, setFormData] = useState<Partial<Issue>>({
    title: '',
    description: '',
    project_slug: '',
    type: undefined,
    priority: 'P4',
    status: 'Open',
    test_compile: '⬜',
    test_dod: '⬜',
    test_sit: '⬜',
    test_uat: '⬜',
    dod_items: []
  });

  // Voice capture using Web Speech API
  const startVoice = (field: 'title' | 'description') => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Voice capture not supported in this browser.'); return; }
    const rec = new SpeechRecognition();
    rec.lang = 'en-GB';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    setVoiceField(field);
    rec.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setFormData(prev => ({
        ...prev,
        [field]: field === 'description'
          ? (prev.description ? prev.description + ' ' + transcript : transcript)
          : transcript
      }));
      setVoiceField(null);
    };
    rec.onerror = () => setVoiceField(null);
    rec.onend = () => setVoiceField(null);
    rec.start();
  };

  useEffect(() => {
    const q = query(collection(firestore, 'issues'), orderBy('created_at', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const parsed: Issue[] = [];
      snapshot.forEach(doc => {
        parsed.push({ id: doc.id, ...doc.data() } as Issue);
      });
      setIssues(parsed);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // Pre-type-filter: used for stat tile counts (project + status only)
  const preTypeFiltered = issues.filter(iss => {
    if (filterProject !== 'All' && iss.project_slug !== filterProject) return false;
    if (filterStatus === 'Open') {
      if (['Done', 'Parked'].includes(iss.status)) return false;
    } else if (filterStatus !== 'All' && iss.status !== filterStatus) {
      return false;
    }
    return true;
  });

  // Full filter (including type + search)
  const filteredIssues = preTypeFiltered.filter(iss => {
    if (filterType !== 'All' && iss.type !== filterType) return false;
    if (searchId.trim()) {
      if (!iss.id.toLowerCase().includes(searchId.trim().toLowerCase())) return false;
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      const match = iss.title.toLowerCase().includes(q) || (iss.description || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Stat tile counts
  const bugCount = preTypeFiltered.filter(i => i.type === 'bug').length;
  const enhCount = preTypeFiltered.filter(i => i.type === 'enhancement').length;

  // Sort Logic
  const sortedIssues = [...filteredIssues].sort((a, b) => {
    const statusOrder: Record<string, number> = { 'Open': 1, 'In Progress': 2, 'UAT': 3, 'Done': 4, 'Parked': 5 };
    const priorityOrder: Record<string, number> = { 'P0': 1, 'P1': 2, 'P2': 3, 'P3': 4, 'P4': 5 };

    let valA: any = a[sortField] || '';
    let valB: any = b[sortField] || '';

    if (sortField === 'updated_at') {
      valA = a.updated_at?.toMillis ? a.updated_at.toMillis() : Date.now();
      valB = b.updated_at?.toMillis ? b.updated_at.toMillis() : Date.now();
    }

    let result = 0;
    if (sortField === 'status') {
      result = (statusOrder[valA] || 99) - (statusOrder[valB] || 99);
    } else if (sortField === 'priority') {
      result = (priorityOrder[valA] || 99) - (priorityOrder[valB] || 99);
    } else if (typeof valA === 'string' && typeof valB === 'string') {
      result = valA.localeCompare(valB);
    } else {
      result = valA > valB ? 1 : valA < valB ? -1 : 0;
    }

    // Secondary sort by priority
    if (result === 0 && sortField !== 'priority') {
      const pA = priorityOrder[a.priority as keyof typeof priorityOrder] || 99;
      const pB = priorityOrder[b.priority as keyof typeof priorityOrder] || 99;
      result = pA - pB;
    }
    // Final tie-breaker
    if (result === 0) result = a.id.localeCompare(b.id);

    return sortAsc ? result : -result;
  });

  // Unique projects for dropdown
  const uniqueProjects = Array.from(new Set(issues.map(i => i.project_slug))).sort();

  const handleLogIssue = () => {
    setEditingIssue(null);
    setEditingDoDIdx(null);
    setFormData({
      title: '',
      description: '',
      project_slug: '',
      type: undefined,   // must be selected
      priority: 'P4',
      status: 'Open',
      test_compile: '⬜',
      test_dod: '⬜',
      test_sit: '⬜',
      test_uat: '⬜',
      dod_items: []
    });
    setIsModalOpen(true);
  };

  const handleRowClick = (issue: Issue) => {
    setEditingIssue(issue);
    setEditingDoDIdx(null);
    // Sort DoD: incomplete first
    const sortedDoD = [...(issue.dod_items || [])].sort((a, b) => {
      if (a.completed === b.completed) return 0;
      return a.completed ? 1 : -1;
    });
    setFormData({ ...issue, dod_items: sortedDoD });
    setIsModalOpen(true);
  };

  const handleTestCycle = (field: 'test_compile' | 'test_dod' | 'test_sit' | 'test_uat') => {
    const cycle: Record<string, '⬜' | '✅' | 'N/A'> = { '⬜': '✅', '✅': 'N/A', 'N/A': '⬜' };
    const newValue = cycle[formData[field] || '⬜'];

    setFormData(prev => {
      const updated = { ...prev, [field]: newValue };
      // Auto-transition: Compile ✅ → In Progress
      if (field === 'test_compile' && newValue === '✅' && prev.status === 'Open') {
        updated.status = 'In Progress';
      }
      // Auto-transition: SIT ✅ → UAT
      if (field === 'test_sit' && newValue === '✅' && prev.status === 'In Progress') {
        updated.status = 'UAT';
      }
      return updated;
    });
  };

  const handleToggleDoD = (index: number) => {
    setFormData(prev => {
      const newItems = [...(prev.dod_items || [])];
      newItems[index] = { ...newItems[index], completed: !newItems[index].completed };
      return { ...prev, dod_items: newItems };
    });
  };

  const handleEditDoDTask = (index: number, newTask: string) => {
    setFormData(prev => {
      const newItems = [...(prev.dod_items || [])];
      newItems[index] = { ...newItems[index], task: newTask };
      return { ...prev, dod_items: newItems };
    });
  };

  const handleAddDoD = () => {
    setFormData(prev => ({
      ...prev,
      dod_items: [...(prev.dod_items || []), { task: 'New task', completed: false }]
    }));
    // Auto-open edit for the new item
    const newIdx = (formData.dod_items || []).length;
    setEditingDoDIdx(newIdx);
  };

  const handleDeleteDoD = (index: number) => {
    setFormData(f => ({ ...f, dod_items: f.dod_items?.filter((_, i) => i !== index) }));
    setEditingDoDIdx(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...formData,
      updated_at: serverTimestamp(),
      updated_by: 'user'
    };

    try {
      if (editingIssue) {
        const docRef = doc(firestore, 'issues', editingIssue.id);
        await updateDoc(docRef, data as any);
      } else {
        await addDoc(collection(firestore, 'issues'), {
          ...data,
          created_at: serverTimestamp(),
          created_by: 'user',
          logged_date: new Date().toISOString().split('T')[0]
        });
      }
      setIsModalOpen(false);
    } catch (err) {
      console.error("Error saving issue:", err);
      alert("Failed to save issue.");
    }
  };

  const getStatusClass = (status: string) => {
    if (status === 'Done') return 'success';
    if (status === 'Parked') return 'inactive';
    if (status === 'In Progress') return 'warning';
    if (status === 'UAT') return 'warning';
    return 'danger';
  };

  if (loading) return <div className="loading">Loading Issues...</div>;

  return (
    <div className="issue-tracker-tab">
      <div className="tab-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
        <p className="tab-section-desc">
          Centralized tracking of all bugs and enhancements across projects.
        </p>
        <button className="btn-primary" onClick={handleLogIssue} style={{ minWidth: '150px' }}>
          ＋ Log Issue
        </button>
      </div>

      {/* ── Stat Tiles ── */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => setFilterType('All')}
          style={{
            flex: '1 1 120px',
            padding: '0.75rem 1rem',
            background: filterType === 'All' ? 'var(--pmo-gold)' : 'var(--bg-card)',
            color: filterType === 'All' ? '#000' : 'var(--text-primary)',
            border: `1px solid ${filterType === 'All' ? 'var(--pmo-gold)' : 'var(--border-subtle)'}`,
            borderRadius: '6px', cursor: 'pointer', textAlign: 'left' as const, transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', lineHeight: 1 }}>{preTypeFiltered.length}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '2px' }}>Total</div>
        </button>
        <button
          onClick={() => setFilterType(filterType === 'bug' ? 'All' : 'bug')}
          style={{
            flex: '1 1 120px', padding: '0.75rem 1rem',
            background: filterType === 'bug' ? '#ff475720' : 'var(--bg-card)',
            color: filterType === 'bug' ? '#ff4757' : 'var(--text-primary)',
            border: `1px solid ${filterType === 'bug' ? '#ff4757' : 'var(--border-subtle)'}`,
            borderRadius: '6px', cursor: 'pointer', textAlign: 'left' as const, transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', lineHeight: 1 }}>{bugCount}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '2px' }}>🐛 Bugs</div>
        </button>
        <button
          onClick={() => setFilterType(filterType === 'enhancement' ? 'All' : 'enhancement')}
          style={{
            flex: '1 1 120px', padding: '0.75rem 1rem',
            background: filterType === 'enhancement' ? 'var(--pmo-green, #7CC17020)' : 'var(--bg-card)',
            color: filterType === 'enhancement' ? 'var(--pmo-green, #7CC170)' : 'var(--text-primary)',
            border: `1px solid ${filterType === 'enhancement' ? 'var(--pmo-green, #7CC170)' : 'var(--border-subtle)'}`,
            borderRadius: '6px', cursor: 'pointer', textAlign: 'left' as const, transition: 'all 0.15s ease'
          }}
        >
          <div style={{ fontSize: '1.6rem', fontWeight: 'bold', lineHeight: 1 }}>{enhCount}</div>
          <div style={{ fontSize: '0.8rem', opacity: 0.8, marginTop: '2px' }}>🚀 Enhancements</div>
        </button>
      </div>

      {/* ── Filters ── */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '2 1 200px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--pmo-slate)', fontWeight: 'bold' }}>🔍 Search</label>
          <input
            style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.9rem' }}
            placeholder="Filter by title or description..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 150px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--pmo-slate)', fontWeight: 'bold' }}>🪪 Issue ID</label>
          <input
            style={{ padding: '0.4rem 0.6rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: '0.9rem', fontFamily: 'monospace' }}
            placeholder="Paste partial ID..."
            value={searchId}
            onChange={e => setSearchId(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--pmo-slate)', fontWeight: 'bold' }}>Project</label>
          <select className="filter-select" value={filterProject} onChange={e => setFilterProject(e.target.value)} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            <option value="All">All Projects</option>
            {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--pmo-slate)', fontWeight: 'bold' }}>Type</label>
          <select className="filter-select" value={filterType} onChange={e => setFilterType(e.target.value)} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            <option value="All">All Types</option>
            <option value="bug">Bug</option>
            <option value="enhancement">Enhancement</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--pmo-slate)', fontWeight: 'bold' }}>Status</label>
          <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            <option value="All">All Statuses</option>
            <option value="Open">Active (excl. Done/Parked)</option>
            <option value="In Progress">In Progress</option>
            <option value="UAT">UAT</option>
            <option value="Done">Done</option>
            <option value="Parked">Parked</option>
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <label style={{ fontSize: '0.85rem', color: 'var(--pmo-slate)', fontWeight: 'bold' }}>Sort By</label>
          <select className="filter-select" value={`${sortField}-${sortAsc}`} onChange={e => {
            const [f, a] = e.target.value.split('-');
            setSortField(f as any);
            setSortAsc(a === 'true');
          }} style={{ padding: '0.4rem', borderRadius: '4px', border: '1px solid var(--border-subtle)', background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
            <option value="status-true">Status</option>
            <option value="priority-true">Priority (P0 → P4)</option>
            <option value="priority-false">Priority (P4 → P0)</option>
            <option value="project_slug-true">Project (A → Z)</option>
            <option value="updated_at-false">Recently Updated</option>
          </select>
        </div>
      </div>

      {/* ── Issue Cards ── */}
      <div className="issue-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {sortedIssues.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--pmo-slate)' }}>
            No issues match the current filters.
          </div>
        ) : sortedIssues.map(issue => (
          <div
            key={issue.id}
            onClick={() => handleRowClick(issue)}
            className="card clickable-row"
            style={{
              padding: '1.25rem',
              cursor: 'pointer',
              borderLeft: `4px solid ${
                issue.priority === 'P0' ? '#ff4757' :
                issue.priority === 'P1' ? 'var(--pmo-gold)' :
                'var(--border-subtle)'
              }`
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '0.85rem', color: 'var(--pmo-slate)' }}>#{issue.id.substring(0,6)}</span>
                  <span style={{ color: 'var(--pmo-gold)', fontWeight: 'bold' }}>{issue.project_slug}</span>
                  <span className={`status-badge ${issue.type === 'bug' ? 'danger' : 'success'}`} style={{ padding: '0.15rem 0.5rem', fontSize: '0.7rem' }}>
                    {issue.type === 'bug' ? 'Bug' : 'Enh'}
                  </span>
                  <span style={{
                    fontSize: '0.85rem', fontWeight: 'bold',
                    color: issue.priority === 'P0' ? '#ff4757' : issue.priority === 'P1' ? 'var(--pmo-gold)' : 'var(--text-primary)'
                  }}>
                    {issue.priority}
                  </span>
                </div>
                <h4 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--text-primary)' }}>{issue.title}</h4>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                <span className={`status-badge ${getStatusClass(issue.status)}`} style={{ padding: '0.25rem 0.75rem', fontSize: '0.8rem' }}>
                  {issue.status}
                </span>
                <div style={{ display: 'flex', gap: '4px', fontSize: '1.1rem' }}>
                  <span title="Pass Criteria: Build, Lint, or Syntax passes (0 errors, 0 warnings).">{issue.test_compile}</span>
                  <span title="Pass Criteria: AI confirms all items in Description and DoD Checklist are implemented." style={{ display: 'flex', alignItems: 'center', gap: '2px' }}>
                    {issue.test_dod}
                    {issue.dod_items && issue.dod_items.length > 0 && (
                      <span style={{ fontSize: '0.65rem', color: 'var(--pmo-gold)', fontWeight: 'bold' }}>
                        {Math.round((issue.dod_items.filter(i => i.completed).length / issue.dod_items.length) * 100)}%
                      </span>
                    )}
                  </span>
                  <span title="Pass Criteria: Integrated into master/main; verified in Production/Live.">{issue.test_sit}</span>
                  <span title="Pass Criteria: Explicit approval from Will in chat (AI PROHIBITED from marking ✅).">{issue.test_uat}</span>
                </div>
              </div>
            </div>

            <p style={{
              margin: '0.5rem 0 0.75rem 0',
              fontSize: '0.9rem',
              color: 'var(--pmo-slate)',
              whiteSpace: 'pre-wrap',
              width: '100%',
              display: 'block'
            }}>
              {issue.description}
            </p>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '0.75rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
              <div style={{ color: 'var(--pmo-slate)', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem' }}>
                {issue.dod_items && issue.dod_items.length > 0 && (
                  <>
                    <span>DoD: {issue.dod_items.filter(i => i.completed).length}/{issue.dod_items.length}</span>
                    <span style={{ padding: '2px 6px', background: 'var(--bg-main)', borderRadius: '4px', color: 'var(--pmo-gold)', fontWeight: 'bold' }}>
                      {Math.round((issue.dod_items.filter(i => i.completed).length / issue.dod_items.length) * 100)}%
                    </span>
                  </>
                )}
              </div>
              <div style={{ color: 'var(--pmo-slate)', fontSize: '0.85rem' }}>
                Updated: {issue.updated_at?.toMillis ? formatDate(new Date(issue.updated_at.toMillis()).toISOString()) : ''}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Issue Modal ── */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '640px' }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h3 style={{ margin: 0 }}>{editingIssue ? 'Edit Issue' : 'Log New Issue'}</h3>
                {editingIssue && (
                  <div style={{ fontFamily: 'monospace', fontSize: '0.8rem', color: 'var(--pmo-slate)', marginTop: '2px' }}>
                    ID: {editingIssue.id}
                  </div>
                )}
              </div>
              <button className="cancel-btn" onClick={() => setIsModalOpen(false)} style={{ fontSize: '1.2rem' }}>✕</button>
            </div>

            <form onSubmit={handleSave} className="capture-form">
              <div className="form-row">
                <div style={{ flex: 2 }}>
                  <label className="slider-label">Project</label>
                  <select
                    className="field-select"
                    value={formData.project_slug}
                    onChange={e => setFormData(f => ({ ...f, project_slug: e.target.value }))}
                    required
                  >
                    <option value="" disabled>Select project...</option>
                    {projects.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="slider-label">Type <span style={{ color: '#ff4757', fontSize: '0.75rem' }}>{!formData.type ? '(required)' : ''}</span></label>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    {(['bug', 'enhancement'] as const).map(t => (
                      <label key={t} style={{
                        flex: 1, textAlign: 'center', padding: '6px 4px',
                        borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 'bold',
                        border: `1px solid ${formData.type === t ? (t === 'bug' ? '#ff4757' : 'var(--pmo-green, #7CC170)') : 'var(--border-subtle)'}`,
                        background: formData.type === t ? (t === 'bug' ? '#ff475720' : 'var(--pmo-green-20, #7CC17020)') : 'var(--bg-card)',
                        color: formData.type === t ? (t === 'bug' ? '#ff4757' : 'var(--pmo-green, #7CC170)') : 'var(--pmo-slate)',
                        transition: 'all 0.15s'
                      }}>
                        <input type="radio" name="type" value={t} checked={formData.type === t}
                          onChange={() => setFormData(f => ({ ...f, type: t }))}
                          style={{ display: 'none' }} required={!editingIssue} />
                        {t === 'bug' ? '🐛 Bug' : '🚀 Enh'}
                      </label>
                    ))}
                  </div>
                </div>
                <div style={{ flex: 1 }}>
                  <label className="slider-label">Priority</label>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {(['P0', 'P1', 'P2', 'P3', 'P4'] as const).map(p => (
                      <label key={p} style={{
                        padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 'bold',
                        border: `1px solid ${formData.priority === p ? (p === 'P0' ? '#ff4757' : p === 'P1' ? 'var(--pmo-gold)' : 'var(--border-subtle)') : 'var(--border-subtle)'}`,
                        background: formData.priority === p ? (p === 'P0' ? '#ff475720' : p === 'P1' ? 'var(--pmo-gold-20, rgba(212,175,55,0.15))' : 'var(--bg-main)') : 'var(--bg-card)',
                        color: formData.priority === p ? (p === 'P0' ? '#ff4757' : p === 'P1' ? 'var(--pmo-gold)' : 'var(--text-primary)') : 'var(--pmo-slate)',
                        transition: 'all 0.15s'
                      }}>
                        <input type="radio" name="priority" value={p} checked={formData.priority === p}
                          onChange={() => setFormData(f => ({ ...f, priority: p }))}
                          style={{ display: 'none' }} />
                        {p}
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="slider-label" style={{ margin: 0 }}>Title</label>
                  <button type="button" onClick={() => startVoice('title')} title="Voice capture"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '2px 4px',
                      color: voiceField === 'title' ? '#ff4757' : 'var(--pmo-slate)', transition: 'color 0.2s' }}>
                    {voiceField === 'title' ? '🔴' : '🎤'}
                  </button>
                </div>
                <input
                  className="field-input"
                  value={formData.title}
                  onChange={e => setFormData(f => ({ ...f, title: e.target.value }))}
                  placeholder={voiceField === 'title' ? 'Listening...' : 'Summarize the issue...'}
                  required
                />
              </div>

              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="slider-label" style={{ margin: 0 }}>Description</label>
                  <button type="button" onClick={() => startVoice('description')} title="Voice capture (appends to existing text)"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '1.1rem', padding: '2px 4px',
                      color: voiceField === 'description' ? '#ff4757' : 'var(--pmo-slate)', transition: 'color 0.2s' }}>
                    {voiceField === 'description' ? '🔴' : '🎤'}
                  </button>
                </div>
                <textarea
                  className="field-input"
                  style={{ width: '100%', boxSizing: 'border-box', minHeight: '120px' }}
                  rows={4}
                  value={formData.description}
                  onChange={e => setFormData(f => ({ ...f, description: e.target.value }))}
                  placeholder={voiceField === 'description' ? 'Listening...' : 'More context, expected behavior, logs...'}
                />
              </div>

              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <label className="slider-label">Status</label>
                  <select
                    className="field-select"
                    value={formData.status}
                    onChange={e => setFormData(f => ({ ...f, status: e.target.value as any }))}
                  >
                    {['Open', 'In Progress', 'UAT', 'Done', 'Parked'].map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: 2, display: 'flex', gap: '8px', justifyContent: 'flex-end', paddingBottom: '4px' }}>
                  {[
                    { key: 'test_compile', label: 'Comp', tip: 'Pass Criteria: Build, Lint, or Syntax passes (0 errors, 0 warnings).' },
                    { key: 'test_dod', label: 'DoD', tip: 'Pass Criteria: AI confirms all items in Description and DoD Checklist are implemented.' },
                    { key: 'test_sit', label: 'SIT', tip: 'Pass Criteria: Integrated into master/main; verified in Production/Live.' },
                    { key: 'test_uat', label: 'UAT', tip: 'Pass Criteria: Explicit approval from Will in chat (AI PROHIBITED from marking ✅).' }
                  ].map(test => (
                    <div key={test.key} style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.6rem', textTransform: 'uppercase', color: 'var(--pmo-slate)', marginBottom: '4px' }}>
                        {test.label}
                      </div>
                      <button
                        type="button"
                        className="icon-btn"
                        title={test.tip}
                        onClick={() => handleTestCycle(test.key as any)}
                        style={{
                          fontSize: '1.2rem', padding: '0.4rem 0.8rem', width: '45px',
                          opacity: (test.key === 'test_uat' && formData.test_sit !== '✅') ? 0.4 : 1
                        }}
                        disabled={test.key === 'test_uat' && formData.test_sit !== '✅'}
                      >
                        {formData[test.key as keyof Issue] as string}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {formData.test_sit === '✅' && formData.test_uat !== '✅' && (
                <div style={{
                  background: 'var(--pmo-gold-20)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  fontSize: '0.85rem',
                  border: '1px solid var(--pmo-gold)',
                  marginBottom: '1rem'
                }}>
                  ⚠️ <strong>Manual Gate:</strong> UAT requires explicit approval from Will in chat before marking as passed.
                </div>
              )}

              {/* ── DoD Checklist ── */}
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="slider-label" style={{ margin: 0 }}>Definition of Done Checklist</label>
                  <button type="button" onClick={handleAddDoD} style={{ fontSize: '0.75rem', padding: '2px 8px' }} className="btn-secondary">＋ Task</button>
                </div>
                <div style={{
                  background: 'var(--bg-main)',
                  padding: '0.75rem',
                  borderRadius: '6px',
                  border: '1px solid var(--border-subtle)',
                  maxHeight: '220px',
                  overflowY: 'auto'
                }}>
                  {(!formData.dod_items || formData.dod_items.length === 0) ? (
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--pmo-slate)', fontStyle: 'italic' }}>No tasks added. Click "+ Task" to start.</p>
                  ) : (
                    formData.dod_items.map((item, idx) => (
                      <div key={idx} style={{ marginBottom: '0.5rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                          <input
                            type="checkbox"
                            checked={item.completed}
                            onChange={() => handleToggleDoD(idx)}
                            style={{ width: '16px', height: '16px', cursor: 'pointer', flexShrink: 0 }}
                          />
                          {editingDoDIdx === idx ? (
                            <input
                              type="text"
                              value={item.task}
                              onChange={e => handleEditDoDTask(idx, e.target.value)}
                              onBlur={() => setEditingDoDIdx(null)}
                              onKeyDown={e => { if (e.key === 'Enter') setEditingDoDIdx(null); }}
                              autoFocus
                              style={{
                                flex: 1, fontSize: '0.9rem', padding: '2px 6px',
                                borderRadius: '4px', border: '1px solid var(--pmo-gold)',
                                background: 'var(--bg-card)', color: 'var(--text-primary)'
                              }}
                            />
                          ) : (
                            <span
                              onClick={() => setEditingDoDIdx(idx)}
                              title="Click to edit"
                              style={{
                                flex: 1, fontSize: '0.9rem', cursor: 'text',
                                textDecoration: item.completed ? 'line-through' : 'none',
                                color: item.completed ? 'var(--pmo-slate)' : 'var(--text-primary)'
                              }}
                            >
                              {item.task}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDeleteDoD(idx)}
                            style={{ background: 'none', border: 'none', color: '#ff4757', cursor: 'pointer', fontSize: '0.8rem', flexShrink: 0, padding: '0 4px' }}
                            title="Delete task"
                          >✕</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="modal-actions">
                <button type="button" className="cancel-btn" onClick={() => setIsModalOpen(false)}>Cancel</button>
                <button type="submit" className="btn-primary" style={{ padding: '0.6rem 2rem' }}>
                  {editingIssue ? 'Update Issue' : 'Log Issue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
