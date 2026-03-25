import { useState, useEffect } from 'react';
import { initGoogleAPI, handleAuthClick, fetchTasks } from '../services/googleTasks';
import { formatDate } from '../utils/formatDate';

export default function ToDoTab() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [isApiReady, setIsApiReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    // Initialize Google API and pass callbacks
    initGoogleAPI(
      () => setIsApiReady(true),
      async () => {
        setIsAuthenticated(true);
        const fetchedTasks = await fetchTasks();
        setTasks(fetchedTasks);
      }
    );
  }, []);

  return (
    <div className="todo-tab">
      <p style={{ color: 'var(--text-secondary)' }}>This tab integrates your Google Tasks for centralized task management.</p>
      
      <div className="dashboard" style={{ marginTop: '2rem' }}>
        <div className="card">
          <h3>Google Tasks</h3>
          {!isAuthenticated ? (
            <button 
              onClick={handleAuthClick} 
              disabled={!isApiReady}
              style={{ marginBottom: '1rem', opacity: isApiReady ? 1 : 0.5 }}
            >
              {isApiReady ? 'Sign In with Google' : 'Loading API...'}
            </button>
          ) : (
            <div style={{ color: 'var(--agy-lime)', marginBottom: '1rem' }}>✓ Authenticated</div>
          )}
          
          {tasks.length === 0 ? (
            <p>{isAuthenticated ? "No active tasks found." : "Please authenticate to view tasks."}</p>
          ) : (
            <ul style={{ paddingLeft: '20px' }}>
              {tasks.map(t => (
                <li key={t.id} style={{ marginBottom: '0.5rem' }}>
                  <span style={{ color: 'var(--pmo-green)', fontWeight: 'bold', marginRight: '8px' }}>[{t.listName}]</span>
                  {t.title}
                  {t.due && <div style={{ fontSize: '0.8em', color: 'var(--pmo-gold)' }}>Due: {formatDate(t.due)}</div>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
