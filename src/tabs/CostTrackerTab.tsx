import { useState, useEffect } from 'react';
import { db, functions } from '../services/firebase';
import { ref, onValue, off, set } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts';
import { formatDate, formatDateTime } from '../utils/formatDate';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  estimated_cost_cents: number;
  sessions?: number;
  commits?: number;
  pull_requests?: number;
  lines_added?: number;
  lines_removed?: number;
  date?: string;
  last_updated: number;
  limits: { daily_input: number; daily_output: number };
}

interface ManualUsage {
  input_tokens: number;
  output_tokens: number;
  estimated_cost_cents: number;
  date?: string;
  last_updated: number;
  limits: { daily_input: number; daily_output: number };
  source: 'manual';
}

interface AntigravityUsage {
  claude_input_tokens: number;
  claude_output_tokens: number;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  estimated_cost_cents: number;
  date?: string;
  last_updated: number;
  limits: { daily_input: number; daily_output: number };
  source: 'manual';
}

interface TokenUsageSnapshot {
  claude?: ClaudeUsage;
  gemini?: ManualUsage;
  antigravity?: AntigravityUsage;
}

interface DailyEntry {
  date: string;  // YYYY-MM-DD key
  claudeTokens: number;
  geminiTokens: number;
  antigravityTokens: number;
  claudeCost: number;
  geminiCost: number;
  antigravityCost: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatCost(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function getStatusClass(pct: number): string {
  return pct > 80 ? 'blocked' : pct > 50 ? 'standing' : 'active';
}

function getGaugeClass(pct: number): string {
  return pct > 80 ? 'danger' : pct > 50 ? 'warning' : 'success';
}

// Build last N days of YYYY-MM-DD strings (oldest → newest)
function lastNDays(n: number): string[] {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ProviderCardProps {
  title: string;
  subtitle?: string;
  usedTokens: number;
  limitTokens: number;
  costCents: number;
  lastUpdated?: number;
  isManual?: boolean;
  children?: React.ReactNode;
}

function ProviderCard({ title, subtitle, usedTokens, limitTokens, costCents, lastUpdated, isManual, children }: ProviderCardProps) {
  const pct = limitTokens > 0 ? Math.min((usedTokens / limitTokens) * 100, 100) : 0;

  return (
    <div className="card cost-card">
      <div className="cost-card-header">
        <div>
          <h3 className="cost-card-title">{title}</h3>
          {subtitle && <span style={{ fontSize: '0.75rem', color: 'var(--pmo-slate)', display: 'block', marginTop: '2px' }}>{subtitle}</span>}
        </div>
        <span className={`status-badge ${getStatusClass(pct)}`}>
          {pct > 80 ? 'Critical' : pct > 50 ? 'Warning' : 'Healthy'}
        </span>
      </div>

      <div className="gauge-container">
        <div className="gauge-track">
          <div className={`gauge-fill ${getGaugeClass(pct)}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="gauge-stats">
          <span>{pct.toFixed(1)}% capacity used</span>
          <span>{formatCost(costCents)} today</span>
        </div>
      </div>

      <div className="cost-details">
        <div className="cost-detail-item">
          <label>Input Tokens</label>
          <span>{usedTokens.toLocaleString()} / {limitTokens.toLocaleString()}</span>
        </div>
        {children}
      </div>

      {isManual && lastUpdated && (
        <div style={{ marginTop: '0.75rem', fontSize: '0.75rem', color: 'var(--pmo-slate)', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.5rem' }}>
          ✏️ Manual entry · Last updated: {formatDateTime(lastUpdated)}
        </div>
      )}
    </div>
  );
}

interface NoDataCardProps {
  title: string;
  subtitle?: string;
  onManualEntry: () => void;
}

function NoDataCard({ title, subtitle, onManualEntry }: NoDataCardProps) {
  return (
    <div className="card cost-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.75rem', minHeight: '180px', opacity: 0.7 }}>
      <h3 className="cost-card-title" style={{ marginBottom: 0 }}>{title}</h3>
      {subtitle && <span style={{ fontSize: '0.75rem', color: 'var(--pmo-slate)' }}>{subtitle}</span>}
      <p style={{ fontSize: '0.85rem', color: 'var(--pmo-grey)', textAlign: 'center', margin: 0 }}>No data yet</p>
      <button className="filter-btn" onClick={onManualEntry} style={{ marginTop: '0.25rem' }}>
        ✏️ Add Manual Entry
      </button>
    </div>
  );
}

// ─── Custom tooltip for recharts ─────────────────────────────────────────────

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}

function ChartTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', borderRadius: '8px', padding: '0.75rem 1rem', fontSize: '0.8rem' }}>
      <p style={{ color: 'var(--pmo-gold)', marginBottom: '0.5rem', fontWeight: 'bold' }}>{label ? formatDate(label) : ''}</p>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, marginBottom: '2px' }}>
          {p.name}: {(p.value || 0).toLocaleString()} tokens
        </div>
      ))}
    </div>
  );
}

// ─── Manual Entry Panel ───────────────────────────────────────────────────────

interface ManualEntryPanelProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function ManualEntryPanel({ isOpen, onClose, onSaved }: ManualEntryPanelProps) {
  const today = todayISO();

  const [geminiIn, setGeminiIn] = useState('');
  const [geminiOut, setGeminiOut] = useState('');
  const [geminiLimit, setGeminiLimit] = useState('1000000');
  const [geminiCost, setGeminiCost] = useState('');

  const [agIn, setAgIn] = useState('');
  const [agOut, setAgOut] = useState('');
  const [agCost, setAgCost] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const now = Date.now();

      if (geminiIn || geminiOut) {
        const geminiData: ManualUsage = {
          input_tokens: parseInt(geminiIn || '0'),
          output_tokens: parseInt(geminiOut || '0'),
          estimated_cost_cents: Math.round(parseFloat(geminiCost || '0') * 100),
          date: today,
          last_updated: now,
          limits: { daily_input: parseInt(geminiLimit || '1000000'), daily_output: 500000 },
          source: 'manual',
        };
        await set(ref(db, 'hub_status/token_usage/gemini'), geminiData);
        await set(ref(db, `hub_cost_tracker/daily/gemini/${today}`), geminiData);
      }

      if (agIn || agOut) {
        const agTotal = parseInt(agIn || '0') + parseInt(agOut || '0');
        const agData: AntigravityUsage = {
          claude_input_tokens: Math.round(parseInt(agIn || '0') * 0.5),
          claude_output_tokens: Math.round(parseInt(agOut || '0') * 0.5),
          gemini_input_tokens: Math.round(parseInt(agIn || '0') * 0.5),
          gemini_output_tokens: Math.round(parseInt(agOut || '0') * 0.5),
          estimated_cost_cents: Math.round(parseFloat(agCost || '0') * 100),
          date: today,
          last_updated: now,
          limits: { daily_input: 500000, daily_output: 250000 },
          source: 'manual',
        };
        const agChartData = {
          total_input_tokens: parseInt(agIn || '0'),
          total_output_tokens: parseInt(agOut || '0'),
          estimated_cost_cents: Math.round(parseFloat(agCost || '0') * 100),
          source: 'manual',
          last_updated: now,
          _totalTokens: agTotal,
        };
        await set(ref(db, 'hub_status/token_usage/antigravity'), agData);
        await set(ref(db, `hub_cost_tracker/daily/antigravity/${today}`), agChartData);
      }

      onSaved();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  const inputStyle: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '6px',
    color: 'var(--text-primary)',
    padding: '0.4rem 0.6rem',
    width: '120px',
    fontSize: '0.85rem',
    fontFamily: 'Verdana, sans-serif',
  };
  const labelStyle: React.CSSProperties = { fontSize: '0.8rem', color: 'var(--pmo-slate)', marginBottom: '2px', display: 'block' };

  return (
    <div className="card" style={{ marginTop: '1.5rem', border: '1px solid var(--pmo-gold)', borderRadius: 'var(--radius-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h3 style={{ color: 'var(--pmo-gold)', margin: 0 }}>✏️ Manual Entry — {formatDate(today)}</h3>
        <button className="filter-btn" onClick={onClose} style={{ padding: '0.25rem 0.75rem' }}>✕ Close</button>
      </div>

      {error && (
        <div style={{ background: 'rgba(255,71,87,0.1)', border: '1px solid #ff4757', borderRadius: '6px', padding: '0.5rem 0.75rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#ff4757' }}>
          {error}
        </div>
      )}

      {/* Gemini row */}
      <div style={{ marginBottom: '1.25rem' }}>
        <p style={{ color: 'var(--pmo-gold)', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>Gemini Pro</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Input tokens</label>
            <input style={inputStyle} type="number" placeholder="0" value={geminiIn} onChange={e => setGeminiIn(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Output tokens</label>
            <input style={inputStyle} type="number" placeholder="0" value={geminiOut} onChange={e => setGeminiOut(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Daily limit (input)</label>
            <input style={inputStyle} type="number" placeholder="1000000" value={geminiLimit} onChange={e => setGeminiLimit(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Est. cost ($)</label>
            <input style={inputStyle} type="number" step="0.01" placeholder="0.00" value={geminiCost} onChange={e => setGeminiCost(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Antigravity row */}
      <div style={{ marginBottom: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--border-subtle)' }}>
        <p style={{ color: 'var(--agy-lime)', fontSize: '0.9rem', fontWeight: 'bold', marginBottom: '0.75rem' }}>Antigravity</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Input tokens (total)</label>
            <input style={inputStyle} type="number" placeholder="0" value={agIn} onChange={e => setAgIn(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Output tokens (total)</label>
            <input style={inputStyle} type="number" placeholder="0" value={agOut} onChange={e => setAgOut(e.target.value)} />
          </div>
          <div>
            <label style={labelStyle}>Est. cost ($)</label>
            <input style={inputStyle} type="number" step="0.01" placeholder="0.00" value={agCost} onChange={e => setAgCost(e.target.value)} />
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn-primary" onClick={handleSave} disabled={saving} style={{ minWidth: '100px' }}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CostTrackerTab() {
  const [snapshot, setSnapshot] = useState<TokenUsageSnapshot | null>(null);
  const [chartData, setChartData] = useState<DailyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState('');
  const [refreshSuccess, setRefreshSuccess] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

  // Subscribe to snapshot
  useEffect(() => {
    const snapshotRef = ref(db, 'hub_status/token_usage');
    onValue(snapshotRef, (snap) => {
      setSnapshot(snap.val());
      setLoading(false);
    });
    return () => off(snapshotRef);
  }, []);

  // Fetch 7-day time-series for chart
  const fetchChartData = () => {
    const days = lastNDays(7);
    const providers = ['claude', 'gemini', 'antigravity'] as const;
    const accumulated: Record<string, Partial<DailyEntry>> = {};

    days.forEach(d => { accumulated[d] = { date: d, claudeTokens: 0, geminiTokens: 0, antigravityTokens: 0, claudeCost: 0, geminiCost: 0, antigravityCost: 0 }; });

    let pending = providers.length;

    providers.forEach(provider => {
      const chartRef = ref(db, `hub_cost_tracker/daily/${provider}`);
      onValue(chartRef, (snap) => {
        const data = snap.val() || {};
        days.forEach(d => {
          if (data[d]) {
            const entry = data[d];
            if (provider === 'claude') {
              accumulated[d].claudeTokens = (entry.input_tokens || 0) + (entry.output_tokens || 0);
              accumulated[d].claudeCost = entry.estimated_cost_cents || 0;
            } else if (provider === 'gemini') {
              accumulated[d].geminiTokens = (entry.input_tokens || 0) + (entry.output_tokens || 0);
              accumulated[d].geminiCost = entry.estimated_cost_cents || 0;
            } else {
              accumulated[d].antigravityTokens = (entry.total_input_tokens || 0) + (entry.total_output_tokens || 0)
                || (entry.claude_input_tokens || 0) + (entry.claude_output_tokens || 0) + (entry.gemini_input_tokens || 0) + (entry.gemini_output_tokens || 0);
              accumulated[d].antigravityCost = entry.estimated_cost_cents || 0;
            }
          }
        });
        pending--;
        if (pending === 0) {
          setChartData(days.map(d => accumulated[d] as DailyEntry));
        }
      }, { onlyOnce: true });
    });
  };

  useEffect(() => {
    fetchChartData();
  }, []);

  // Refresh Claude via Cloud Function
  const handleRefresh = async () => {
    setRefreshing(true);
    setRefreshError('');
    setRefreshSuccess(false);
    try {
      const fetchUsage = httpsCallable(functions, 'fetchClaudeUsage');
      await fetchUsage();
      setRefreshSuccess(true);
      setTimeout(() => setRefreshSuccess(false), 4000);
      fetchChartData(); // re-fetch chart after refresh
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Refresh failed';
      setRefreshError(msg.includes('NOT_FOUND') || msg.includes('not found')
        ? 'Cloud Function not yet deployed — run: firebase deploy --only functions'
        : msg);
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div className="loading">Initializing Spend Tracker…</div>;

  const { claude, gemini, antigravity } = snapshot || {};

  const claudeUsed = (claude?.input_tokens || 0) + (claude?.output_tokens || 0);
  const claudeLimit = (claude?.limits?.daily_input || 700000) + (claude?.limits?.daily_output || 300000);

  const geminiUsed = (gemini?.input_tokens || 0) + (gemini?.output_tokens || 0);
  const geminiLimit = (gemini?.limits?.daily_input || 1000000) + (gemini?.limits?.daily_output || 500000);

  const agUsed = antigravity
    ? (antigravity.claude_input_tokens || 0) + (antigravity.claude_output_tokens || 0)
    + (antigravity.gemini_input_tokens || 0) + (antigravity.gemini_output_tokens || 0)
    : 0;
  const agLimit = (antigravity?.limits?.daily_input || 500000) + (antigravity?.limits?.daily_output || 250000);

  const hasChartData = chartData.some(d => d.claudeTokens > 0 || d.geminiTokens > 0 || d.antigravityTokens > 0);
  const distinctDaysWithData = chartData.filter(d => d.claudeTokens > 0 || d.geminiTokens > 0 || d.antigravityTokens > 0).length;

  return (
    <div className="cost-tracker-tab">
      {/* Header */}
      <div className="tab-section-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
        <p className="tab-section-desc">
          Real-time AI token usage and estimated spend across Claude Pro, Gemini Pro, and Antigravity.
        </p>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            className="filter-btn"
            onClick={() => setManualOpen(o => !o)}
          >
            ✏️ Manual Entry {manualOpen ? '▲' : '▾'}
          </button>
          <button
            className="btn-primary"
            onClick={handleRefresh}
            disabled={refreshing}
            style={{ minWidth: '150px' }}
          >
            {refreshing ? '⟳ Refreshing…' : '🔄 Refresh Claude'}
          </button>
        </div>
      </div>

      {/* Refresh feedback */}
      {refreshError && (
        <div style={{ background: 'rgba(255,71,87,0.1)', border: '1px solid #ff4757', borderRadius: '8px', padding: '0.6rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: '#ff4757' }}>
          ⚠️ {refreshError}
        </div>
      )}
      {refreshSuccess && (
        <div style={{ background: 'rgba(124,193,112,0.1)', border: '1px solid var(--pmo-green)', borderRadius: '8px', padding: '0.6rem 1rem', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--pmo-green)' }}>
          ✅ Claude data refreshed
        </div>
      )}

      {/* Provider Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.5rem', marginTop: '1rem' }}>

        {/* Claude */}
        {claude ? (
          <ProviderCard
            title="Claude Pro"
            subtitle="Anthropic Admin API · auto-refresh"
            usedTokens={claudeUsed}
            limitTokens={claudeLimit}
            costCents={claude.estimated_cost_cents || 0}
            lastUpdated={claude.last_updated}
          >
            <div className="cost-detail-item">
              <label>Output Tokens</label>
              <span>{(claude.output_tokens || 0).toLocaleString()}</span>
            </div>
            {(claude.sessions != null) && (
              <div className="cost-detail-item" style={{ marginTop: '0.25rem', paddingTop: '0.5rem', borderTop: '1px solid var(--border-subtle)' }}>
                <label>Sessions · Commits · PRs</label>
                <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>
                  {claude.sessions} · {claude.commits || 0} · {claude.pull_requests || 0}
                </span>
              </div>
            )}
            {claude.last_updated && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--pmo-slate)' }}>
                Last refreshed: {formatDateTime(claude.last_updated)}
              </div>
            )}
          </ProviderCard>
        ) : (
          <div className="card cost-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', justifyContent: 'center', alignItems: 'center', minHeight: '180px', opacity: 0.7 }}>
            <h3 className="cost-card-title">Claude Pro</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--pmo-grey)', textAlign: 'center' }}>
              No data yet
            </p>
            <p style={{ fontSize: '0.8rem', color: 'var(--pmo-slate)', textAlign: 'center' }}>
              Click <strong style={{ color: 'var(--pmo-gold)' }}>Refresh Claude</strong> to pull live data, or deploy the Cloud Function first.
            </p>
          </div>
        )}

        {/* Gemini */}
        {gemini ? (
          <ProviderCard
            title="Gemini Pro"
            subtitle="Manual entry · Google AI Studio"
            usedTokens={geminiUsed}
            limitTokens={geminiLimit}
            costCents={gemini.estimated_cost_cents || 0}
            lastUpdated={gemini.last_updated}
            isManual
          >
            <div className="cost-detail-item">
              <label>Output Tokens</label>
              <span>{(gemini.output_tokens || 0).toLocaleString()}</span>
            </div>
          </ProviderCard>
        ) : (
          <NoDataCard title="Gemini Pro" subtitle="Manual entry · Google AI Studio" onManualEntry={() => setManualOpen(true)} />
        )}

        {/* Antigravity */}
        {antigravity ? (
          <ProviderCard
            title="Antigravity"
            subtitle="Manual entry · supplemental quota"
            usedTokens={agUsed}
            limitTokens={agLimit}
            costCents={antigravity.estimated_cost_cents || 0}
            lastUpdated={antigravity.last_updated}
            isManual
          >
            <div className="cost-detail-item">
              <label>Claude tokens</label>
              <span>{((antigravity.claude_input_tokens || 0) + (antigravity.claude_output_tokens || 0)).toLocaleString()}</span>
            </div>
            <div className="cost-detail-item">
              <label>Gemini tokens</label>
              <span>{((antigravity.gemini_input_tokens || 0) + (antigravity.gemini_output_tokens || 0)).toLocaleString()}</span>
            </div>
          </ProviderCard>
        ) : (
          <NoDataCard title="Antigravity" subtitle="Manual entry · supplemental quota" onManualEntry={() => setManualOpen(true)} />
        )}
      </div>

      {/* Manual Entry Panel */}
      <ManualEntryPanel
        isOpen={manualOpen}
        onClose={() => setManualOpen(false)}
        onSaved={fetchChartData}
      />

      {/* 7-day Chart */}
      <div className="card" style={{ marginTop: '2rem', border: '1px solid var(--border-subtle)', padding: '1.5rem' }}>
        <h3 style={{ marginBottom: '1rem' }}>Token Usage — Last 7 Days</h3>
        {!hasChartData || distinctDaysWithData < 2 ? (
          <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--pmo-slate)', fontSize: '0.9rem' }}>
            {!hasChartData
              ? 'Historical data will appear here after 2+ days of use.'
              : 'Not enough data yet — check back tomorrow for chart history.'}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="date"
                tickFormatter={(v) => formatDate(v)}
                tick={{ fill: 'var(--pmo-slate)', fontSize: 11, fontFamily: 'Verdana, sans-serif' }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
                tick={{ fill: 'var(--pmo-slate)', fontSize: 11, fontFamily: 'Verdana, sans-serif' }}
                axisLine={{ stroke: 'var(--border-subtle)' }}
                tickLine={false}
              />
              <Tooltip content={<ChartTooltip />} />
              <Legend
                wrapperStyle={{ fontSize: '0.8rem', fontFamily: 'Verdana, sans-serif', paddingTop: '0.5rem' }}
              />
              <Line
                type="monotone"
                dataKey="claudeTokens"
                name="Claude"
                stroke="var(--pmo-green)"
                strokeWidth={2}
                dot={{ fill: 'var(--pmo-green)', r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="geminiTokens"
                name="Gemini"
                stroke="var(--pmo-gold)"
                strokeWidth={2}
                dot={{ fill: 'var(--pmo-gold)', r: 3 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="antigravityTokens"
                name="Antigravity"
                stroke="var(--agy-lime)"
                strokeWidth={2}
                dot={{ fill: 'var(--agy-lime)', r: 3 }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Spend tip */}
      <div className="card" style={{ marginTop: '1.5rem', borderLeft: '4px solid var(--pmo-gold)' }}>
        <h3 style={{ color: 'var(--pmo-gold)', marginBottom: '0.5rem' }}>💡 Spend Optimisation</h3>
        <p style={{ fontSize: '0.9rem', opacity: 0.8, margin: 0 }}>
          Daily resets at 00:00 UTC. Claude data is pulled from the Anthropic Analytics API (~1h delay) via Cloud Function.
          Gemini and Antigravity use manual entry for MVP. To minimise costs, use <code>claude commit</code> sparingly for small changes.
        </p>
      </div>
    </div>
  );
}
