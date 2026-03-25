import { useState, useEffect, useRef } from 'react';
import { db, auth } from '../services/firebase';
import { ref, push, onValue, off, set } from 'firebase/database';
import type { DataSnapshot } from 'firebase/database';
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';

interface PairwiseItem {
  id: string;
  label: string;
  score: number;
}

interface Analysis {
  id: string;
  title: string;
  createdAt: number;
  items: PairwiseItem[];
  comparisons: Record<string, boolean>; // key: `${idA}__${idB}`, value: true=A wins
}

function calcScores(items: PairwiseItem[], comparisons: Record<string, boolean>): PairwiseItem[] {
  const counts: Record<string, number> = {};
  items.forEach(i => { counts[i.id] = 0; });
  Object.entries(comparisons).forEach(([key, aWins]) => {
    const [aId, bId] = key.split('__');
    if (aWins) counts[aId] = (counts[aId] || 0) + 1;
    else counts[bId] = (counts[bId] || 0) + 1;
  });
  const max = Math.max(...Object.values(counts), 1);
  return items.map(i => ({
    ...i,
    score: Math.round((counts[i.id] / max) * 100),
  })).sort((a, b) => b.score - a.score);
}

function getPairs(items: PairwiseItem[]) {
  const pairs: [PairwiseItem, PairwiseItem][] = [];
  for (let i = 0; i < items.length - 1; i++)
    for (let j = i + 1; j < items.length; j++)
      pairs.push([items[i], items[j]]);
  return pairs;
}

export default function PairwiseTab() {
  const [user, setUser] = useState<User | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [active, setActive] = useState<Analysis | null>(null);
  const [pairIdx, setPairIdx] = useState(0);
  const [newTitle, setNewTitle] = useState('');
  const [newItems, setNewItems] = useState('');
  const [view, setView] = useState<'list' | 'compare' | 'results' | 'new'>('list');
  const dbPathRef = useRef('');

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u: User | null) => {
      setUser(u);
      dbPathRef.current = u ? `pairwise_analyses/${u.uid}` : '';
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) { setAnalyses([]); return; }
    const r = ref(db, `pairwise_analyses/${user.uid}`);
    onValue(r, (snap: DataSnapshot) => {
      const data = snap.val();
      if (!data) { setAnalyses([]); return; }
      const list = Object.entries(data).map(([id, v]: [string, any]) => ({ id, ...v })) as Analysis[];
      list.sort((a, b) => b.createdAt - a.createdAt);
      setAnalyses(list);
    });
    return () => off(r);
  }, [user]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try { await signInWithEmailAndPassword(auth, email, password); }
    catch { setAuthError('Login failed. Check credentials.'); }
  };

  const createAnalysis = async () => {
    if (!newTitle.trim() || !newItems.trim() || !user) return;
    const items: PairwiseItem[] = newItems.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map((label, i) => ({ id: `item_${i}_${Date.now()}`, label, score: 0 }));
    if (items.length < 2) { alert('Add at least 2 items'); return; }
    const analysis: Omit<Analysis, 'id'> = {
      title: newTitle.trim(), items, comparisons: {}, createdAt: Date.now(),
    };
    const r = await push(ref(db, `pairwise_analyses/${user.uid}`), analysis);
    const freshAnalysis = { id: r.key!, ...analysis };
    setActive(freshAnalysis);
    setPairIdx(0);
    setView('compare');
    setNewTitle(''); setNewItems('');
  };

  const choose = async (winner: PairwiseItem, loser: PairwiseItem) => {
    if (!active || !user) return;
    const key = `${winner.id}__${loser.id}`;
    const updatedComps = { ...active.comparisons, [key]: winner.id === key.split('__')[0] };
    // Actually store: key = "aId__bId", value = true means first item in key wins
    const compKey = `${winner.id}__${loser.id}`;
    const updated = { ...active.comparisons, [compKey]: true };
    await set(ref(db, `pairwise_analyses/${user.uid}/${active.id}/comparisons`), updated);
    const updatedActive = { ...active, comparisons: updated };
    setActive(updatedActive);
    const pairs = getPairs(active.items);
    if (pairIdx < pairs.length - 1) {
      setPairIdx(p => p + 1);
    } else {
      setView('results');
    }
    void updatedComps; // suppress unused
  };

  if (!user) {
    return (
      <div className="org-auth">
        <div className="card" style={{ maxWidth: 360, margin: '4rem auto' }}>
          <h3>Sign In to Pairwise</h3>
          <form onSubmit={handleLogin} className="auth-form">
            <input className="field-input" type="email" placeholder="Email" value={email}
              onChange={e => setEmail(e.target.value)} required />
            <input className="field-input" type="password" placeholder="Password" value={password}
              onChange={e => setPassword(e.target.value)} required />
            {authError && <p className="error-msg">{authError}</p>}
            <button type="submit" style={{ width: '100%' }}>Sign In</button>
          </form>
        </div>
      </div>
    );
  }

  const pairs = active ? getPairs(active.items) : [];
  const currentPair = pairs[pairIdx];
  const ranked = active ? calcScores(active.items, active.comparisons) : [];

  return (
    <div className="pairwise-tab">
      <div className="org-header">
        <h3>Pairwise Analysis</h3>
        <span className="auth-badge">● {user.email}</span>
        <button className="sign-out-btn" onClick={() => signOut(auth)}>Sign Out</button>
      </div>

      {view === 'list' && (
        <div>
          <div style={{ display:'flex', gap:'1rem', marginBottom:'1.5rem', flexWrap:'wrap' }}>
            <button onClick={() => setView('new')}>+ New Analysis</button>
            {analyses.length === 0 && <p style={{ color:'var(--pmo-grey)' }}>No analyses yet. Create one to get started.</p>}
          </div>
          <div className="pw-list">
            {analyses.map(a => (
              <div key={a.id} className="card pw-card" onClick={() => { setActive(a); setPairIdx(0); setView('compare'); }}>
                <div className="pw-card-title">{a.title}</div>
                <div className="pw-card-meta">{a.items.length} items · {new Date(a.createdAt).toLocaleDateString()}</div>
                <div className="pw-card-actions">
                  <button onClick={e => { e.stopPropagation(); setActive(a); setView('results'); }}>Results</button>
                  <button className="cancel-btn" onClick={e => { e.stopPropagation(); setActive(a); setPairIdx(0); setView('compare'); }}>Compare</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {view === 'new' && (
        <div className="card" style={{ maxWidth: 500 }}>
          <h4>New Analysis</h4>
          <input className="field-input" placeholder="Analysis title" value={newTitle}
            onChange={e => setNewTitle(e.target.value)} />
          <textarea className="field-input" rows={6} placeholder={"One item per line:\nOption A\nOption B\nOption C"}
            value={newItems} onChange={e => setNewItems(e.target.value)} />
          <div className="modal-actions">
            <button onClick={createAnalysis}>Create & Start</button>
            <button className="cancel-btn" onClick={() => setView('list')}>Cancel</button>
          </div>
        </div>
      )}

      {view === 'compare' && active && currentPair && (
        <div className="pw-compare">
          <div className="pw-progress">
            Comparison {pairIdx + 1} of {pairs.length}
            <div className="pw-progress-bar"><div style={{ width: `${((pairIdx) / pairs.length) * 100}%` }} /></div>
          </div>
          <h4 style={{ color:'var(--pmo-grey)', marginBottom:'2rem' }}>{active.title}: Which is more important?</h4>
          <div className="pw-choices">
            <button className="pw-choice-btn" onClick={() => choose(currentPair[0], currentPair[1])}>
              {currentPair[0].label}
            </button>
            <span className="pw-vs">vs</span>
            <button className="pw-choice-btn" onClick={() => choose(currentPair[1], currentPair[0])}>
              {currentPair[1].label}
            </button>
          </div>
          <div style={{ textAlign:'center', marginTop:'2rem' }}>
            <button className="cancel-btn" onClick={() => setView('list')}>← Back</button>
          </div>
        </div>
      )}

      {view === 'results' && active && (
        <div className="pw-results">
          <h4>{active.title} — Results</h4>
          <div className="pw-ranking">
            {ranked.map((item, i) => (
              <div key={item.id} className="pw-result-row">
                <span className="pw-rank">#{i + 1}</span>
                <div className="pw-result-bar-wrap">
                  <div className="pw-result-label">{item.label}</div>
                  <div className="pw-result-bar">
                    <div className="pw-result-fill" style={{ width: `${item.score}%` }} />
                  </div>
                </div>
                <span className="pw-score">{item.score}%</span>
              </div>
            ))}
          </div>
          <div style={{ display:'flex', gap:'1rem', marginTop:'2rem' }}>
            <button onClick={() => { setPairIdx(0); setView('compare'); }}>Re-Compare</button>
            <button className="cancel-btn" onClick={() => { setActive(null); setView('list'); }}>← Back to List</button>
          </div>
        </div>
      )}
    </div>
  );
}
