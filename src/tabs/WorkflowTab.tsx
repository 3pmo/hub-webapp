import { useState } from 'react';
import StatusTab from './StatusTab';

export default function WorkflowTab() {
  const [subTab, setSubTab] = useState<'status' | 'diagram'>('status');

  return (
    <div className="workflow-tab">
      <div className="tab-section-header" style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
        <div className="filter-group">
          <button 
            className={`filter-btn ${subTab === 'status' ? 'active' : ''}`}
            onClick={() => setSubTab('status')}
          >
            📊 Status Dashboard
          </button>
          <button 
            className={`filter-btn ${subTab === 'diagram' ? 'active' : ''}`}
            onClick={() => setSubTab('diagram')}
          >
            🗺 Workflow Diagram
          </button>
        </div>
      </div>
      
      {subTab === 'status' ? (
        <StatusTab />
      ) : (
        <div className="workflow-frame-wrap" style={{ marginTop: '1rem', height: '100%', flex: 1 }}>
          <iframe
            src="/workflow-diagram.html"
            title="Workflow Diagram"
            className="workflow-iframe"
            style={{ width: '100%', height: 'calc(100vh - 150px)', border: 'none', borderRadius: '8px' }}
            allowFullScreen
          />
        </div>
      )}
    </div>
  );
}
