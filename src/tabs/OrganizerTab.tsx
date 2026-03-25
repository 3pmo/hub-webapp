import { useState, useEffect, useRef } from 'react';
import { db, auth } from '../services/firebase';
import { ref, push, set, onValue, off, remove } from 'firebase/database';
import type { DataSnapshot } from 'firebase/database';
import { signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';

type ThoughtStatus = 'Idea' | 'Started' | 'Published' | 'Finished';
type ThoughtType = 'Task' | 'Project' | 'Learning' | 'Decision';
type ThoughtCategory = 'Personal' | 'Work' | 'Opportunities' | 'Family';

interface Thought {
  id: string;
  title: string;
  description: string;
  category: ThoughtCategory;
  type: ThoughtType;
  status: ThoughtStatus;
  impact: number;
  effort: number;
  urgency: number;
  weight: number;
  priorityScore: number;
  createdAt: number;
  tags: string;
}

function calcPriority(impact: number, effort: number, urgency: number) {
  const weight = Math.round((impact + (11 - effort) + urgency) / 3);
  const score = parseFloat(((impact + urgency + (11 - effort) + weight) / 4).toFixed(1));
  return { weight, score };
}

const CATEGORY_COLORS: Record<ThoughtCategory, string> = {
  Personal: '#7CC170', Work: '#FF9E1B', Opportunities: '#c4ff61', Family: '#6bcfff',
};

const STATUS_ORDER: Record<ThoughtStatus, number> = { Idea: 0, Started: 1, Published: 2, Finished: 3 };

export default function OrganizerTab() {
  const [user, setUser] = useState<User | null>(null);
  const [authError, setAuthError] = useState('');
  const [thoughts, setThoughts] = useState<Thought[]>([]);
  const [filterCat, setFilterCat] = useState<string>('All');
  const [filterStatus, setFilterStatus] = useState<string>('All');
  const [editThought, setEditThought] = useState<Thought | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recogRef = useRef<any>(null);

  // New thought form state
  const [form, setForm] = useState({
    title: '', description: '', category: 'Work' as ThoughtCategory,
    type: 'Task' as ThoughtType, impact: 5, effort: 5, urgency: 5, tags: '',
  });

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u: User | null) => setUser(u));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) { setThoughts([]); return; }
    const thoughtsRef = ref(db, 'thoughts');
    onValue(thoughtsRef, (snap: DataSnapshot) => {
      const data = snap.val();
      if (!data) { setThoughts([]); return; }
      const list = Object.entries(data).map(([id, v]: [string, any]) => ({ id, ...v })) as Thought[];
      list.sort((a, b) => b.priorityScore - a.priorityScore);
      setThoughts(list);
    });
    return () => off(ref(db, 'thoughts'));
  }, [user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    console.log("[Organizer] Starting Google Sign-In Popup...");
    try { 
      const res = await signInWithPopup(auth, new GoogleAuthProvider()); 
      console.log("[Organizer] Sign-In Success:", res.user.email);
    }
    catch (err: any) { 
      console.error("[Organizer] Sign-In Error:", err);
      setAuthError(`Google Sign-In failed: ${err.message || 'Check Console'}`); 
    }
  };

  const startListening = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { alert('Voice capture not supported in this browser.'); return; }
    const rec = new SR();
    rec.lang = 'en-GB'; rec.interimResults = false;
    rec.onresult = (e: any) => {
      setForm(f => ({ ...f, title: e.results[0][0].transcript }));
      setIsListening(false);
    };
    rec.onerror = () => setIsListening(false);
    rec.onend = () => setIsListening(false);
    recogRef.current = rec;
    rec.start();
    setIsListening(true);
  };

  const stopListening = () => {
    recogRef.current?.stop();
    setIsListening(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    const { weight, score } = calcPriority(form.impact, form.effort, form.urgency);
    const thought: Omit<Thought, 'id'> = {
      ...form, weight, priorityScore: score, status: 'Idea', createdAt: Date.now(),
    };
    await push(ref(db, 'thoughts'), thought);
    setForm({ title: '', description: '', category: 'Work', type: 'Task', impact: 5, effort: 5, urgency: 5, tags: '' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this thought?')) return;
    await remove(ref(db, `thoughts/${id}`));
  };

  const handleSaveEdit = async () => {
    if (!editThought) return;
    const { weight, score } = calcPriority(editThought.impact, editThought.effort, editThought.urgency);
    const { id, ...rest } = editThought;
    await set(ref(db, `thoughts/${id}`), { ...rest, weight, priorityScore: score });
    setEditThought(null);
  };

  const filtered = thoughts.filter(t =>
    (filterCat === 'All' || t.category === filterCat) &&
    (filterStatus === 'All' || t.status === filterStatus)
  );

  const { weight: prevW, score: prevS } = calcPriority(form.impact, form.effort, form.urgency);

  if (!user) {
    return (
      <div className="org-auth">
        <div className="card" style={{ maxWidth: 360, margin: '4rem auto' }}>
          <h3>Sign In to Organizer</h3>
          <form onSubmit={handleLogin} className="auth-form">
            {authError && <p className="error-msg">{authError}</p>}
            <button type="submit" style={{ width: '100%' }}>Sign In with Google</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="organizer-tab">
      <div className="org-header">
        {/* Main Tab */}
        <span className="auth-badge">● {user.email}</span>
        <button className="sign-out-btn" onClick={() => signOut(auth)}>Sign Out</button>
      </div>

      {/* Capture Panel */}
      <div className="card org-capture">
        <h4>Capture</h4>
        <form onSubmit={handleSubmit} className="capture-form">
          <div className="capture-title-row">
            <input className="field-input" placeholder="What's on your mind?" value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} required />
            <button type="button" className={`mic-btn ${isListening ? 'listening' : ''}`}
              onClick={isListening ? stopListening : startListening}>
              {isListening ? '⏹' : '🎙'}
            </button>
          </div>
          <textarea className="field-input" placeholder="Description (optional)" rows={2}
            value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          <div className="form-row">
            <select className="field-select" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value as ThoughtCategory }))}>
              {(['Personal','Work','Opportunities','Family'] as ThoughtCategory[]).map(c => <option key={c}>{c}</option>)}
            </select>
            <select className="field-select" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as ThoughtType }))}>
              {(['Task','Project','Learning','Decision'] as ThoughtType[]).map(t => <option key={t}>{t}</option>)}
            </select>
            <input className="field-input" placeholder="Tags (comma sep)" value={form.tags}
              onChange={e => setForm(f => ({ ...f, tags: e.target.value }))} />
          </div>
          <div className="form-row sliders-row">
            {(['impact','effort','urgency'] as const).map(key => (
              <label key={key} className="slider-label">
                <span>{key.charAt(0).toUpperCase() + key.slice(1)}: {form[key]}</span>
                <input type="range" min={1} max={10} value={form[key]}
                  onChange={e => setForm(f => ({ ...f, [key]: +e.target.value }))} />
              </label>
            ))}
            <div className="score-preview">
              <div className="score-num">{prevS}</div>
              <div className="score-label">Priority</div>
              <div className="weight-num">W: {prevW}</div>
            </div>
          </div>
          <button type="submit">Add Thought</button>
        </form>
      </div>

      {/* Filter Bar */}
      <div className="org-filters">
        <div className="filter-group">
          <span className="filter-label">Category:</span>
          {['All','Personal','Work','Opportunities','Family'].map(c => (
            <button key={c} className={`filter-btn ${filterCat === c ? 'active' : ''}`}
              onClick={() => setFilterCat(c)}>{c}</button>
          ))}
        </div>
        <div className="filter-group">
          <span className="filter-label">Status:</span>
          {['All','Idea','Started','Published','Finished'].map(s => (
            <button key={s} className={`filter-btn ${filterStatus === s ? 'active' : ''}`}
              onClick={() => setFilterStatus(s)}>{s}</button>
          ))}
        </div>
        <span className="thought-count">{filtered.length} thought{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Thoughts Table */}
      <div className="thoughts-table-wrap">
        {filtered.length === 0 ? (
          <div className="empty-state">No thoughts yet. Capture something above.</div>
        ) : (
          <table className="thoughts-table">
            <thead>
              <tr>
                <th>Score</th><th>Title</th><th>Category</th><th>Type</th>
                <th>Status</th><th>I/E/U</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(t => (
                <tr key={t.id}>
                  <td><span className="score-badge">{t.priorityScore}</span></td>
                  <td>
                    <div className="thought-title">{t.title}</div>
                    {t.description && <div className="thought-desc">{t.description}</div>}
                    {t.tags && <div className="thought-tags">{t.tags.split(',').map(tag => <span key={tag} className="tag">{tag.trim()}</span>)}</div>}
                  </td>
                  <td><span className="cat-chip" style={{ background: CATEGORY_COLORS[t.category] + '33', color: CATEGORY_COLORS[t.category] }}>{t.category}</span></td>
                  <td><span className="type-chip">{t.type}</span></td>
                  <td>
                    <select className="status-select" value={t.status}
                      onChange={async e => {
                        await set(ref(db, `thoughts/${t.id}/status`), e.target.value as ThoughtStatus);
                      }}>
                      {(['Idea','Started','Published','Finished'] as ThoughtStatus[]).map(s => <option key={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="ieu-cell">{t.impact}/{t.effort}/{t.urgency}</td>
                  <td className="actions-cell">
                    <button className="icon-btn" onClick={() => setEditThought({ ...t })}>✏️</button>
                    <button className="icon-btn danger" onClick={() => handleDelete(t.id)}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit Modal */}
      {editThought && (
        <div className="modal-overlay" onClick={() => setEditThought(null)}>
          <div className="modal-card" onClick={e => e.stopPropagation()}>
            <h4>Edit Thought</h4>
            <input className="field-input" value={editThought.title}
              onChange={e => setEditThought(t => t && ({ ...t, title: e.target.value }))} />
            <textarea className="field-input" rows={3} value={editThought.description}
              onChange={e => setEditThought(t => t && ({ ...t, description: e.target.value }))} />
            <div className="form-row">
              <select className="field-select" value={editThought.category}
                onChange={e => setEditThought(t => t && ({ ...t, category: e.target.value as ThoughtCategory }))}>
                {(['Personal','Work','Opportunities','Family'] as ThoughtCategory[]).map(c => <option key={c}>{c}</option>)}
              </select>
              <select className="field-select" value={editThought.type}
                onChange={e => setEditThought(t => t && ({ ...t, type: e.target.value as ThoughtType }))}>
                {(['Task','Project','Learning','Decision'] as ThoughtType[]).map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-row sliders-row">
              {(['impact','effort','urgency'] as const).map(key => (
                <label key={key} className="slider-label">
                  <span>{key.charAt(0).toUpperCase() + key.slice(1)}: {editThought[key]}</span>
                  <input type="range" min={1} max={10} value={editThought[key]}
                    onChange={e => setEditThought(t => t && ({ ...t, [key]: +e.target.value }))} />
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button onClick={handleSaveEdit}>Save</button>
              <button className="cancel-btn" onClick={() => setEditThought(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Keep STATUS_ORDER in scope to avoid unused import warning
void STATUS_ORDER;
