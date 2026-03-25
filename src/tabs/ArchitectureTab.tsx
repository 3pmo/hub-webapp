export default function ArchitectureTab() {
  return (
    <div className="architecture-tab">
      <div className="tab-section-header">
        <p className="tab-section-desc">
          Technical blueprint of the 3PMO-Hub React ecosystem and its integration with Firebase and Google APIs.
        </p>
      </div>

      <div className="diagram-container card" style={{ overflow: 'hidden', textAlign: 'center' }}>
        <h4 style={{ color: 'var(--pmo-slate)', marginBottom: '1rem' }}>System Architecture Diagram</h4>
        <img
          src="/3pmo-hub-architecture-diagram.png"
          alt="3PMO-Hub System Architecture"
          style={{ maxWidth: '100%', height: 'auto', display: 'block', margin: '0 auto' }}
          onError={(e) => {
            e.currentTarget.style.display = 'none';
          }}
        />
        <div className="diagram-fallback" style={{ fontSize: '0.8rem', color: 'var(--pmo-grey)', marginTop: '1rem' }}>
          Architecture: ⚛️ React/Vite SPA ↔ ☁️ Firebase RTDB ↔ 🌐 Google Tasks API
        </div>
      </div>

      <div className="card mt-4" style={{ marginTop: '2rem' }}>
        <h3>Key Components</h3>
        <ul className="brand-specs" style={{ listStyle: 'none', padding: 0, fontSize: '0.9rem', lineHeight: '1.6' }}>
          <li>🟢 <strong>Frontend:</strong> React 19 + Vite (SPA Architecture)</li>
          <li>🔥 <strong>Backend:</strong> Firebase (Hosting, Auth, Realtime DB)</li>
          <li>🔄 <strong>Sync:</strong> Local Registry → GitHub Actions → Production</li>
          <li>📊 <strong>Identity:</strong> Google OAuth 2.0 (Single Sign-On)</li>
        </ul>
      </div>
    </div>
  );
}
