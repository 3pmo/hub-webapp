import { useState, useEffect, useRef } from 'react';
import { firestore } from '../services/firebase';
import { collection, onSnapshot, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { issueService } from '../services/issue-service';
import projects from '../assets/projects.json';

export interface Issue {
  id: string;
  project_slug: string;
  type: 'bug' | 'enhancement';
  priority: 'P0' | 'P1' | 'P2' | 'P3' | 'P4';
  title: string;
  description: string;
  status: 'Captured' | 'Comp' | 'DoD' | 'SIT' | 'UAT' | 'Release' | 'Done' | 'Parked' | 'Blocked';
  logged_date: string;
  test_compile: '⬜' | '✅' | 'N/A';
  test_dod: '⬜' | '✅' | 'N/A';
  test_sit: '⬜' | '✅' | 'N/A';
  test_uat: '⬜' | '✅' | 'N/A';
  dod_items?: { task: string; completed: boolean }[];
  screenshots?: { url: string; name: string; timestamp: number }[];
  screenshot_url?: string;  // Keep for backward compat
  screenshot_name?: string; // Keep for backward compat
  created_at?: any;
  created_by?: string;
  updated_at?: any;
  updated_by?: string;
}
// Helper to format dates to 3PMO branded standard: DD MMM YY (e.g. 07 Apr 26)
const formatBrandedDate = (dateInput: any) => {
  if (!dateInput) return '-';
  const date = dateInput.toDate ? dateInput.toDate() : new Date(dateInput);
  if (isNaN(date.getTime())) return '-';
  
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const year = String(date.getFullYear()).slice(-2);
  
  return `${day} ${month} ${year}`;
};

export default function IssueTrackerTab() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortAsc, setSortAsc] = useState(true);
  const [history, setHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Filters
  const [filterProject, setFilterProject] = useState<string>('All');
  const [filterType, setFilterType] = useState<string>('All');
  const [filterPriority, setFilterPriority] = useState<string[]>(['P0', 'P1', 'P2', 'P3', 'P4']);
  const [filterStatus, setFilterStatus] = useState<string>('Active'); // Active = Captured, Comp, DoD, SIT, UAT
  const [searchText, setSearchText] = useState('');
  const [searchId, setSearchId] = useState('');

  // Sort
  const [sortField, setSortField] = useState<'status' | 'priority' | 'project_slug' | 'updated_at'>('priority');


  // Form / Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingIssue, setEditingIssue] = useState<Issue | null>(null);
  const [identity, setIdentity] = useState<string>('user');

  // Detect AI identity if provided by environment/session
  useEffect(() => {
    const savedIdentity = localStorage.getItem('issue_tracker_identity') || 'user';
    setIdentity(savedIdentity);
  }, []);
  const [editingDoDIdx, setEditingDoDIdx] = useState<number | null>(null);
  const [voiceField, setVoiceField] = useState<'title' | 'description' | null>(null);
  const [formData, setFormData] = useState<Partial<Issue>>({
    title: '',
    description: '',
    project_slug: '',
    type: undefined,
    priority: 'P4',
    status: 'Captured',
    test_compile: '⬜',
    test_dod: '⬜',
    test_sit: '⬜',
    test_uat: '⬜',
    dod_items: [],
    screenshots: []
  });

  // Track last description/title that triggered AI DoD to avoid unnecessary repeats
  const lastProcessedContent = useRef('');

  // Autosave formData to localStorage
  useEffect(() => {
    if (isModalOpen && !loading) {
      localStorage.setItem('issue_tracker_autosave', JSON.stringify({
        formData,
        editingIssueId: editingIssue?.id || null
      }));
    }
  }, [formData, isModalOpen, loading, editingIssue]);

  // Load autosave on open
  useEffect(() => {
    if (isModalOpen) {
      const saved = localStorage.getItem('issue_tracker_autosave');
      if (saved) {
        try {
          const { formData: savedData, editingIssueId } = JSON.parse(saved);
          // Only restore if it's the same issue or both are new
          if (editingIssueId === (editingIssue?.id || null)) {
            setFormData(prev => ({ ...prev, ...savedData }));
          }
        } catch (e) {
          console.error("Autosave load error", e);
        }
      }
    }
  }, [isModalOpen]); // Only on open


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
    if (editingIssue) {
      setLoadingHistory(true);
      issueService.getHistory(editingIssue.id)
        .then(setHistory)
        .catch(err => console.error("History fetch error:", err))
        .finally(() => setLoadingHistory(false));
    } else {
      setHistory([]);
    }
  }, [editingIssue]);

  useEffect(() => {
    const q = query(collection(firestore, 'issues'), orderBy('updated_at', 'desc'));
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
    // Normalize project slug comparison to handle 'issue tracker' vs 'issue-tracker'
    if (filterProject !== 'All') {
      const p = (iss.project_slug || '').replace(/\s+/g, '-').toLowerCase();
      const fp = filterProject.replace(/\s+/g, '-').toLowerCase();
      if (p !== fp) return false;
    }
    
    if (filterStatus === 'Active') {
      if (['Done', 'Parked', 'Blocked', 'Release'].includes(iss.status || '')) return false;
    } else if (filterStatus === 'Test') {
      if (!['Comp', 'DoD', 'SIT', 'UAT', 'Release'].includes(iss.status || '')) return false;
    } else if (filterStatus === 'AI Test') {
      if (!['Comp', 'DoD', 'SIT'].includes(iss.status || '')) return false;
    } else if (filterStatus === 'Remediated') {
      if (!['Done', 'Parked'].includes(iss.status || '')) return false;
    } else if (filterStatus !== 'All' && (iss.status || '') !== filterStatus) {
      return false;
    }
    return true;
  });

  // Full filter (including type + priority + search)
  const filteredIssues = preTypeFiltered.filter(iss => {
    if (filterType !== 'All' && (iss.type || '') !== filterType) return false;
    if (!filterPriority.includes(iss.priority)) return false;
    if (searchId.trim()) {
      if (!(iss.id || '').toLowerCase().includes(searchId.trim().toLowerCase())) return false;
    }
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase();
      const match = (iss.title || '').toLowerCase().includes(q) || 
                    (iss.description || '').toLowerCase().includes(q) ||
                    (iss.project_slug || '').toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  // Stat tile counts
  const bugCount = preTypeFiltered.filter(i => i.type === 'bug').length;
  const enhCount = preTypeFiltered.filter(i => i.type === 'enhancement').length;
  const totalBugCount = issues.filter(i => i.type === 'bug').length;
  const totalEnhCount = issues.filter(i => i.type === 'enhancement').length;

  // Sort Logic
  const sortedIssues = [...filteredIssues].sort((a, b) => {
    const statusOrder: Record<string, number> = { 'Captured': 1, 'Comp': 2, 'DoD': 3, 'SIT': 4, 'UAT': 5, 'Release': 6, 'Done': 7, 'Parked': 8, 'Blocked': 9 };
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

  // Unique projects for dropdown, ensuring '3pmo-hub' and 'issue-tracker' are always present and normalized
  const uniqueProjects = Array.from(new Set([
    ...issues.map(i => (i.project_slug || '').replace(/\s+/g, '-').toLowerCase()),
    '3pmo-hub',
    'issue-tracker'
  ].filter(Boolean))).sort();

  const handleLogIssue = () => {
    setEditingIssue(null);
    setEditingDoDIdx(null);
    setFormData({
      title: '',
      description: '',
      project_slug: filterProject !== 'All' ? filterProject : '',
      type: undefined,   // must be selected
      priority: 'P4',
      status: 'Captured',
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

    // AI GATE ENFORCEMENT: Block AI from marking UAT
    if (field === 'test_uat' && newValue === '✅' && identity !== 'user') {
      alert("AI ERROR: Manual UAT Gate. You cannot mark UAT without explicit approval in chat.");
      return;
    }

    setFormData(prev => {
      const updated = { ...prev, [field]: newValue };
      
      // Auto-transitions based on test cycles
      if (newValue === '✅') {
        if (field === 'test_compile') updated.status = 'Comp';
        if (field === 'test_dod')     updated.status = 'DoD';
        if (field === 'test_sit')     updated.status = 'SIT';
        if (field === 'test_uat')     updated.status = 'UAT';
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
      dod_items: [...(prev.dod_items || []), { task: '', completed: false }]
    }));
    // Auto-open edit for the new item
    const newIdx = (formData.dod_items || []).length;
    setEditingDoDIdx(newIdx);
  };

  const handleDeleteDoD = (index: number) => {
    setFormData(f => ({ ...f, dod_items: f.dod_items?.filter((_, i) => i !== index) }));
    setEditingDoDIdx(null);
  };

  const handleAutoGenerateDoD = (isAutomatic = false) => {
    const currentTriggerContent = (formData.title || '') + (formData.description || '');
    if (isAutomatic && (currentTriggerContent === lastProcessedContent.current || !currentTriggerContent.trim())) return;
    
    lastProcessedContent.current = currentTriggerContent;

    // 1. Heuristic Suggestions
    const suggestions: string[] = [];
    const title = (formData.title || '').toLowerCase();
    const desc = (formData.description || '').toLowerCase();
    const type = formData.type;

    // Base suggestions by type
    if (type === 'bug') {
      suggestions.push('Root cause identified and verified');
      suggestions.push('Fix verified in dev environment');
      suggestions.push('Regression testing complete');
    } else if (type === 'enhancement') {
      suggestions.push('Functional requirements met');
      suggestions.push('UI consistency check');
      suggestions.push('Error handling implemented');
    } else {
      // Generic fallback if no type selected
      suggestions.push('Success criteria verified');
      suggestions.push('Code reviewed and cleaned');
    }

    // Keyword-based suggestions
    const keywordMap: Record<string, string> = {
      'ui': 'Responsive layout verification',
      'layout': 'Responsive layout verification',
      'css': 'Cross-browser check',
      'responsive': 'Mobile/Tablet testing',
      'api': 'Data validation complete',
      'database': 'Data integrity verified',
      'firestore': 'Security rules check',
      'security': 'Access control verification',
      'login': 'Session/Auth check',
      'voice': 'Mic permissions/browser compatibility check',
      'search': 'Search performance/indexing check'
    };

    Object.keys(keywordMap).forEach(key => {
      if (title.includes(key) || desc.includes(key)) {
        suggestions.push(keywordMap[key]);
      }
    });

    // 2. Extraction from Description
    const lines = (formData.description || '').split('\n');
    const extracted = lines
      .map(line => line.trim())
      .filter(line => line.startsWith('-') || line.startsWith('*') || /^\d+\./.test(line))
      .map(line => line.replace(/^[-*\d.]+\s*/, '').trim())
      .filter(line => line.length > 0);

    // 3. Merge and Deduplicate
    const combined = Array.from(new Set([...suggestions, ...extracted]));
    
    setFormData(prev => {
      const existingTasks = prev.dod_items || [];
      const freshTasks = combined.filter(t => !existingTasks.some(e => e.task === t));
      
      return {
        ...prev,
        dod_items: [
          ...existingTasks,
          ...freshTasks.map(task => ({ task, completed: false }))
        ]
      };
    });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingIssue) return;
    
    try {
      const screenshot = await issueService.uploadScreenshot(editingIssue.id, file);
      setFormData(prev => ({ 
        ...prev, 
        screenshots: [...(prev.screenshots || []), screenshot] 
      }));
    } catch (err: any) {
      alert(`Upload failed: ${err.message}`);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    if (!editingIssue) return;

    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          try {
            const screenshot = await issueService.uploadScreenshot(editingIssue.id, file);
            setFormData(prev => ({ 
              ...prev, 
              screenshots: [...(prev.screenshots || []), screenshot] 
            }));
          } catch (err: any) {
            console.error("Paste upload failed:", err);
          }
        }
      }
    }
  };

  const handleRemoveScreenshot = (timestamp: number) => {
    setFormData(prev => ({
      ...prev,
      screenshots: (prev.screenshots || []).filter(s => s.timestamp !== timestamp)
    }));
  };


  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();

    // AI GATE ENFORCEMENT: Block AI from marking Done or Parked
    if (identity !== 'user' && (formData.status === 'Done' || formData.status === 'Parked')) {
      alert(`AI ERROR: Final status gate. You cannot set status to ${formData.status} without explicit approval.`);
      return;
    }
    
    // 1. Prepare base data with metadata
    const { id, ...cleanData } = formData as any; // Extract ID so we don't save it as a document field
    const data = {
      ...cleanData,
      updated_at: serverTimestamp(),
      updated_by: identity
    };

    try {
      if (editingIssue) {
        // Use the centralized service for Sparse Update + Log
        await issueService.updateIssue(editingIssue.id, data as any, identity as any);
      } else {
        // Use the centralized service for Create
        await issueService.createIssue(data as any, identity as any);
      }
      localStorage.removeItem('issue_tracker_autosave');
      setIsModalOpen(false);
    } catch (err: any) {
      console.error("Error saving issue:", err);
      alert(`Failed to save issue: ${err.message || "Unknown error"}`);
    }
  };

  const getStatusClass = (status: string) => {
    if (status === 'Done') return 'success';
    if (status === 'Blocked') return 'inactive';
    if (['Comp', 'DoD', 'SIT', 'UAT'].includes(status)) return 'warning';
    return 'danger'; // Captured
  };

  if (loading) return <div className="loading">Loading Issues...</div>;

  return (
    <div className="issue-tracker-tab">
      <div className="tab-section-header flex-between p-md">
        <div>
          <h2 style={{ margin: 0 }}>Issue Tracker</h2>
          <p className="tab-section-desc">
            Centralized tracking of all bugs and enhancements across active projects.
          </p>
        </div>
        <button className="btn-primary" onClick={handleLogIssue} style={{ minWidth: '150px' }}>
          ＋ Log Issue
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div
          onClick={() => {
            setFilterType('All');
            setFilterPriority(['All']);
            setSearchText('');
            setSearchId('');
            setFilterProject('All');
          }}
          className={`stat-tile ${filterType === 'All' && filterPriority.length >= 5 ? 'selected' : ''}`}
        >
          <div className="p-md">
            <div className="stat-number">{filteredIssues.length}</div>
            <div className="stat-label">Filtered Issues</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '4px' }}>of {issues.length} total</div>
          </div>
        </div>

        <div
          onClick={() => setFilterType(filterType === 'bug' ? 'All' : 'bug')}
          className={`stat-tile ${filterType === 'bug' ? 'selected' : ''}`}
        >
          <div className="p-md">
            <div className="stat-number">{bugCount}</div>
            <div className="stat-label">Filtered Bugs</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '4px' }}>of {totalBugCount} total</div>
          </div>
        </div>

        <div
          onClick={() => setFilterType(filterType === 'enhancement' ? 'All' : 'enhancement')}
          className={`stat-tile ${filterType === 'enhancement' ? 'selected' : ''}`}
        >
          <div className="p-md">
            <div className="stat-number">{enhCount}</div>
            <div className="stat-label">Filtered Enh.</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-dim)', marginTop: '4px' }}>of {totalEnhCount} total</div>
          </div>
        </div>
      </div>



      {/* ── Filters ── */}
      <div className="card" style={{ padding: '1.25rem', marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '2 1 200px' }}>
          <label className="stat-label" style={{ marginBottom: '4px', display: 'block' }}>🔍 Search</label>
          <input
            className="field-input"
            style={{ width: '100%' }}
            placeholder="Search title or description..."
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
          />
        </div>
        
        <div style={{ flex: '1 1 120px' }}>
          <label className="stat-label" style={{ marginBottom: '4px', display: 'block' }}>🪪 ID</label>
          <input
            className="field-input"
            style={{ width: '100%', fontFamily: 'monospace' }}
            placeholder="Partial ID..."
            value={searchId}
            onChange={e => setSearchId(e.target.value)}
          />
        </div>

        <div>
          <label className="stat-label" style={{ marginBottom: '4px', display: 'block' }}>Project</label>
          <select className="field-select" value={filterProject} onChange={e => setFilterProject(e.target.value)}>
            <option value="All">All Projects</option>
            {uniqueProjects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        <div>
          <label className="stat-label" style={{ marginBottom: '4px', display: 'block' }}>Status Group</label>
          <select className="field-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="Active">Active</option>
            <option value="Test">Test</option>
            <option value="AI Test">AI Test</option>
            <option value="Remediated">Remediated</option>
            <option value="All">All Statuses</option>
            <option disabled>──────</option>
            {['Captured', 'Comp', 'DoD', 'SIT', 'UAT', 'Release', 'Done', 'Parked', 'Blocked'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 180px' }}>
          <label className="stat-label" style={{ marginBottom: '4px', display: 'block' }}>Priority</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {['P0', 'P1', 'P2', 'P3', 'P4'].map(p => {
              const isActive = filterPriority.includes(p);
              return (
                <button
                  key={p}
                  onClick={() => {
                    let next = [...filterPriority];
                    if (isActive) {
                      next = next.filter(x => x !== p);
                    } else {
                      next.push(p);
                    }
                    setFilterPriority(next);
                  }}
                  className={`btn-ghost selected-indicator ${isActive ? 'active' : ''}`}
                  style={{ 
                    padding: '4px 10px', 
                    fontSize: '0.75rem', 
                    minWidth: '40px',
                    fontWeight: isActive ? 'bold' : 'normal',
                    color: isActive ? 'var(--text-primary)' : 'var(--pmo-slate)'
                  }}
                >
                  {p}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label className="stat-label" style={{ marginBottom: '4px', display: 'block' }}>Sort</label>
          <select className="field-select" value={`${sortField}-${sortAsc}`} onChange={e => {
            const [f, a] = e.target.value.split('-');
            setSortField(f as any);
            setSortAsc(a === 'true');
          }}>
            <option value="priority-true">Priority (P0 → P4)</option>
            <option value="status-true">Status</option>
            <option value="priority-false">Priority (P4 → P0)</option>
            <option value="project_slug-true">Project (A → Z)</option>
            <option value="updated_at-false">Recently Updated</option>
          </select>
        </div>
      </div>

      {/* ── Issue List ── */}
      <div className="issue-list" style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1, overflowY: 'auto', paddingBottom: '1.5rem' }}>
        {sortedIssues.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
            No issues found matching the criteria.
          </div>
        ) : (
          sortedIssues.map(issue => {
            const isBug = issue.type === 'bug';
            const statusClass = getStatusClass(issue.status);
            
            return (
              <div 
                key={issue.id} 
                className="card p-md clickable-row"
                style={{ 
                  borderLeft: `3px solid ${issue.priority === 'P0' ? '#ff4757' : issue.priority === 'P1' ? 'var(--pmo-gold)' : 'transparent'}`,
                  transition: 'transform 0.15s ease'
                }}
                onClick={(e) => {
                  if ((e.target as HTMLElement).tagName !== 'SELECT' && (e.target as HTMLElement).tagName !== 'BUTTON') {
                    handleRowClick(issue);
                  }
                }}
              >
                <div className="flex-between" style={{ marginBottom: '8px', alignItems: 'flex-start' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px', flexWrap: 'wrap' }}>
                      <span className={`status-badge ${isBug ? 'urgent' : 'warning'}`} style={{ fontSize: '0.65rem' }}>
                        {isBug ? 'BUG' : 'ENH'}
                      </span>
                      <span style={{ color: 'var(--pmo-gold)', fontSize: '0.75rem', fontWeight: 'bold' }}>{issue.priority}</span>
                      <span style={{ color: 'var(--text-dim)', fontSize: '0.7rem', fontFamily: 'monospace' }}>#{issue.id?.substring(0, 5)}</span>
                      <span className="status-badge ghost" style={{ fontSize: '0.7rem' }}>{issue.project_slug}</span>
                    </div>
                    <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--text-primary)' }}>{issue.title}</h3>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px' }}>
                    <select 
                      className={`status-badge ${statusClass}`}
                      style={{ 
                        padding: '2px 8px', 
                        fontSize: '0.7rem', 
                        height: '24px', 
                        width: 'auto',
                        cursor: 'pointer',
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}
                      value={issue.status}
                      onChange={async (e) => {
                        const newStatus = e.target.value as any;
                        if (identity !== 'user' && (newStatus === 'Done' || newStatus === 'Parked')) {
                          alert("AI ERROR: Final status gate. Manual approval required.");
                          return;
                        }
                        try {
                          await issueService.updateIssue(issue.id!, { status: newStatus }, identity as any);
                        } catch (err: any) {
                          alert(`Failed to update status: ${err.message}`);
                        }
                      }}
                      onClick={e => e.stopPropagation()}
                    >
                       {['Captured', 'Comp', 'DoD', 'SIT', 'UAT', 'Release', 'Done', 'Parked', 'Blocked'].map(s => (
                        <option key={s} value={s} style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>{s}</option>
                       ))}
                    </select>
                    
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {['test_compile', 'test_dod', 'test_sit', 'test_uat'].map(k => (
                        <span key={k} style={{ 
                          fontSize: '0.9rem', 
                          opacity: (issue as any)[k] === '✅' ? 1 : 0.2,
                          filter: (issue as any)[k] === '✅' ? 'none' : 'grayscale(1)'
                        }}>
                          {(issue as any)[k] === '✅' ? '✅' : '⬜'}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <p style={{ 
                  margin: '0 0 12px', 
                  fontSize: '0.88rem', 
                  color: 'var(--text-dim)', 
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  lineHeight: '1.4'
                }}>
                  {issue.description || 'No additional details provided.'}
                </p>

                <div className="flex-between" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '8px' }}>
                  <div style={{ display: 'flex', gap: '12px' }}>
                    {issue.dod_items && issue.dod_items.length > 0 && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--pmo-gold)', fontWeight: 'bold' }}>
                        DoD: {issue.dod_items.filter(i => i.completed).length}/{issue.dod_items.length} ({Math.round((issue.dod_items.filter(i => i.completed).length / (issue.dod_items.length || 1)) * 100)}%)
                      </span>
                    )}
                    {((issue.screenshots?.length || 0) + (issue.screenshot_url ? 1 : 0)) > 0 && (
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                        📸 {(issue.screenshots?.length || 0) + (issue.screenshot_url ? 1 : 0)} Attachment(s)
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '0.72rem', color: 'var(--text-dim)' }}>
                    Last update: {formatBrandedDate(issue.updated_at)}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ── Issue Modal ── */}
      {isModalOpen && (
        <div className="modal-overlay" onClick={() => setIsModalOpen(false)}>
          <div className="modal-card" style={{ maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
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

            {/* AI GATE BANNER */}
            {formData.test_sit === '✅' && formData.test_uat !== '✅' && (
              <div style={{ 
                background: 'rgba(239, 68, 68, 0.1)', 
                border: '1px solid #ef4444', 
                borderRadius: '8px', 
                padding: '1rem', 
                marginBottom: '1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '1rem'
              }}>
                <span style={{ fontSize: '1.5rem' }}>🚧</span>
                <div>
                  <div style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.9rem', textTransform: 'uppercase' }}>Manual UAT Gate Required</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>SIT is verified. Explicit human approval required to progress to UAT and Done.</div>
                </div>
              </div>
            )}

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
                  onBlur={() => handleAutoGenerateDoD(true)}
                  placeholder={voiceField === 'title' ? 'Listening...' : 'Summarize the issue...'}
                  required
                />
              </div>

              <div style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label className="slider-label" style={{ margin: 0 }}>Outcome Description</label>
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
                  onBlur={() => handleAutoGenerateDoD(true)}
                  placeholder={voiceField === 'description' ? 'Listening...' : 'More context, expected behavior, logs...'}
                />
              </div>

              {/* Screenshot Gallery Section */}
              <div style={{ width: '100%', marginTop: '1rem', border: '1px dashed var(--border-subtle)', borderRadius: '8px', padding: '1rem', background: 'var(--bg-main)' }} onPaste={handlePaste}>
                 <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <label className="slider-label" style={{ margin: 0 }}>📸 Screenshots & Attachments</label>
                  {editingIssue ? (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="file" id="screenshot-upload" multiple style={{ display: 'none' }} onChange={handleFileUpload} accept="image/*" />
                      <label htmlFor="screenshot-upload" className="btn-secondary" style={{ padding: '4px 12px', fontSize: '0.8rem', cursor: 'pointer' }}>
                        Upload
                      </label>
                    </div>
                  ) : (
                    <span style={{ fontSize: '0.75rem', color: 'var(--pmo-slate)' }}>Save issue first to enable screenshots</span>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '0.75rem' }}>
                  {/* Legacy Support */}
                  {formData.screenshot_url && !formData.screenshots?.some(s => s.url === formData.screenshot_url) && (
                    <div style={{ position: 'relative', border: '1px solid var(--pmo-gold)', borderRadius: '6px', overflow: 'hidden', height: '80px' }}>
                      <img src={formData.screenshot_url} alt="Legacy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      <div style={{ position: 'absolute', top: 2, left: 2, background: 'var(--pmo-gold)', color: 'black', fontSize: '8px', padding: '1px 3px', borderRadius: '3px', fontWeight: 'bold' }}>LEGACY</div>
                    </div>
                  )}

                  {formData.screenshots?.map(s => (
                    <div key={s.timestamp} style={{ position: 'relative', border: '1px solid var(--border-subtle)', borderRadius: '6px', overflow: 'hidden', height: '80px', background: 'var(--bg-card)' }}>
                      <img src={s.url} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover', cursor: 'zoom-in' }} onClick={() => window.open(s.url, '_blank')} />
                      <button 
                        type="button" 
                        onClick={() => handleRemoveScreenshot(s.timestamp)}
                        style={{ position: 'absolute', top: 2, right: 2, background: 'rgba(239, 68, 68, 0.9)', color: 'white', border: 'none', borderRadius: '4px', width: '18px', height: '18px', cursor: 'pointer', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >✕</button>
                    </div>
                  ))}
                  
                  <div style={{ border: '1px dashed var(--border-subtle)', borderRadius: '6px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', fontSize: '0.7rem', color: 'var(--pmo-slate)', padding: '0 4px' }}>
                    Paste (Ctrl+V) or click Upload
                  </div>
                </div>
              </div>

              <div className="form-row" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <label className="slider-label">Status</label>
                  <select
                    className="field-select"
                    value={formData.status}
                    onChange={e => setFormData(f => ({ ...f, status: e.target.value as any }))}
                  >
                    {['Captured', 'Comp', 'DoD', 'SIT', 'UAT', 'Done', 'Blocked'].map(s => (
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


              {/* ── DoD Checklist ── */}
              <div style={{ marginTop: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <label className="slider-label" style={{ margin: 0 }}>Definition of Done Checklist</label>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="button" onClick={() => handleAutoGenerateDoD()} style={{ fontSize: '0.75rem', padding: '2px 8px' }} className="btn-secondary" title="Convert bullet points from description to tasks">✨ AI DoD</button>
                    <button type="button" onClick={handleAddDoD} style={{ fontSize: '0.75rem', padding: '2px 8px' }} className="btn-secondary">＋ Task</button>
                  </div>
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
                              placeholder="Describe the task..."
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

              {/* ── Change History ── */}
              {editingIssue && (
                <div style={{ marginTop: '1.5rem' }}>
                  <label className="slider-label">Change History</label>
                  <div style={{
                    background: 'var(--bg-main)',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    border: '1px solid var(--border-subtle)',
                    maxHeight: '180px',
                    overflowY: 'auto',
                    fontSize: '0.82rem'
                  }}>
                    {loadingHistory ? (
                      <div style={{ color: 'var(--pmo-slate)', fontStyle: 'italic' }}>Loading history...</div>
                    ) : history.length === 0 ? (
                      <div style={{ color: 'var(--pmo-slate)', fontStyle: 'italic' }}>No change history recorded yet.</div>
                    ) : (
                      history.map((log: any) => (
                        <div key={log.id} style={{ 
                          marginBottom: '0.75rem', 
                          paddingBottom: '0.75rem', 
                          borderBottom: '1px solid var(--border-subtle)',
                          lineHeight: '1.4'
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                            <strong style={{ color: 'var(--pmo-gold)' }}>{log.updated_by}</strong>
                            <span style={{ color: 'var(--pmo-slate)', fontSize: '0.75rem' }}>
                              {formatBrandedDate(log.timestamp)}
                            </span>
                          </div>
                          {Object.entries(log.changes || {}).map(([field, delta]: [string, any]) => (
                            <div key={field} style={{ marginLeft: '8px' }}>
                              <span style={{ color: 'var(--pmo-slate)', textTransform: 'capitalize' }}>{field.replace('_', ' ')}:</span>{' '}
                              <span style={{ color: '#ff4757', textDecoration: 'line-through' }}>{String(delta.old || 'none')}</span>
                              {' → '}
                              <span style={{ color: 'var(--pmo-green)' }}>{String(delta.new)}</span>
                            </div>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

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

      {/* ── Page Footer ── */}
      <div className="tab-footer" style={{ 
        marginTop: 'auto', 
        paddingTop: '1.5rem', 
        borderTop: '1px solid var(--border-subtle)', 
        color: 'var(--pmo-slate)', 
        fontSize: '0.85rem',
        textAlign: 'center'
      }}>
        Last Updated: {new Date().toLocaleString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}
