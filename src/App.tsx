import { useState, useEffect } from 'react';
import './App.css';
import { formatDateTime } from './utils/formatDate';
import StatusTab from './tabs/StatusTab';
import WorkflowTab from './tabs/WorkflowTab';
import OrganizerTab from './tabs/OrganizerTab';
import PairwiseTab from './tabs/PairwiseTab';
import ToDoTab from './tabs/ToDoTab';
import BrandTab from './tabs/BrandTab';
import ArchitectureTab from './tabs/ArchitectureTab';
import CostTrackerTab from './tabs/CostTrackerTab';
import syncMeta from './assets/sync-meta.json';

// Tabs match the old sub-tabs but are now all in the sidebar
type Tab = 'status' | 'workflow' | 'organizer' | 'pairwise' | 'todo' | 'brand' | 'architecture' | 'cost';

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>('status');
  const [isPrintable, setIsPrintable] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    if (isPrintable) document.documentElement.classList.add('theme-printable');
    else document.documentElement.classList.remove('theme-printable');
  }, [isPrintable]);

  const getTabTitle = (tab: Tab) => {
    switch (tab) {
      case 'status': return 'Project Status';
      case 'workflow': return 'Ecosystem Workflow';
      case 'organizer': return 'Thought Organizer';
      case 'pairwise': return 'Pairwise Analysis';
      case 'todo': return 'To-Do List';
      case 'brand': return 'Brand Guidelines';
      case 'architecture': return 'System Architecture';
      case 'cost': return 'Cost Tracker';
    }
  };

  return (
    <div className="app-container">
      {/* ── Left Sidebar ── */}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <div className="brand-area">
          <img src="/3PMO_Logo.png" alt="3PMO Logo" className="logo-img"
            onError={e => { e.currentTarget.style.display = 'none'; }} />
          <h1 className="wordmark">
            <span className="wordmark-3">3</span>
            <span className="wordmark-pmo">PMO</span>
          </h1>
        </div>

        <nav className="nav-menu">
          <div className="nav-group-title">Control</div>
          <button className={`nav-link ${activeTab === 'status' ? 'active' : ''}`} onClick={() => setActiveTab('status')}>
            📊 Status
          </button>
          <button className={`nav-link ${activeTab === 'workflow' ? 'active' : ''}`} onClick={() => setActiveTab('workflow')}>
            🗺 Workflow
          </button>
          <button className={`nav-link ${activeTab === 'brand' ? 'active' : ''}`} onClick={() => setActiveTab('brand')}>
            🎨 Brand
          </button>
          <button className={`nav-link ${activeTab === 'architecture' ? 'active' : ''}`} onClick={() => setActiveTab('architecture')}>
            🏗 Architecture
          </button>
          <button className={`nav-link ${activeTab === 'cost' ? 'active' : ''}`} onClick={() => setActiveTab('cost')}>
            💰 Cost Tracker
          </button>

          <div className="nav-group-title">Thoughts</div>
          <button className={`nav-link ${activeTab === 'organizer' ? 'active' : ''}`} onClick={() => setActiveTab('organizer')}>
            🧠 Organizer
          </button>
          <button className={`nav-link ${activeTab === 'pairwise' ? 'active' : ''}`} onClick={() => setActiveTab('pairwise')}>
            ⚖ Pairwise
          </button>
          <button className={`nav-link ${activeTab === 'todo' ? 'active' : ''}`} onClick={() => setActiveTab('todo')}>
            ✅ To-Do
          </button>
        </nav>
      </aside>
      <div className={`sidebar-overlay${sidebarOpen ? ' visible' : ''}`} onClick={() => setSidebarOpen(false)} />

      {/* ── Main Content ── */}
      <main className="main-content">
        <header className="header">
          <button className="hamburger-btn" onClick={() => setSidebarOpen(s => !s)} aria-label="Toggle menu">☰</button>
          <h2 className="header-title">{getTabTitle(activeTab)}</h2>
          <div className="header-actions">
            <button className="theme-toggle-btn" onClick={() => setIsPrintable(!isPrintable)}>
              {isPrintable ? '🌙 Dark Mode' : '📄 Printable Theme'}
            </button>
          </div>
        </header>

        <div className="app-content-wrapper">
          <div className="tab-panel" key={activeTab}>
            {activeTab === 'status' && <StatusTab />}
            {activeTab === 'workflow' && <WorkflowTab />}
            {activeTab === 'organizer' && <OrganizerTab />}
            {activeTab === 'pairwise' && <PairwiseTab />}
            {activeTab === 'todo' && <ToDoTab />}
            {activeTab === 'brand' && <BrandTab />}
            {activeTab === 'architecture' && <ArchitectureTab />}
            {activeTab === 'cost' && <CostTrackerTab />}
          </div>
        </div>
        <footer className="app-footer" style={{ borderTop: '1px solid var(--border-subtle)', padding: '1rem 2rem', color: 'var(--pmo-gold)', textAlign: 'center', fontSize: '0.85rem' }}>
          Last synced: {formatDateTime(syncMeta.last_sync)} · To refresh, run <code>npm run build</code> locally, commit, and push.
        </footer>
      </main>
    </div>
  );
}
