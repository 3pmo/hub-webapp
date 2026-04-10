/**
 * sync-registry.mjs
 * Syncs the project registry from Firestore (hub-3pmo / projects collection)
 * to _System/projects.json for tool use.
 * 
 * Migrated to Firestore REST API (no firebase-admin dependency).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  getAccessToken, 
  fromFirestoreFields, 
  firestoreRequest 
} from './firestore-rest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Path resolution ──────────────────────────────────────────────────────────
const SA_PATHS = [
  path.join(__dirname, '../firestore-service-account.json'), // _System/scripts location
  path.join(__dirname, 'sa-hub-3pmo.json'),                  // 3pmo-hub/scripts location
];
const SA_PATH = SA_PATHS.find(p => fs.existsSync(p));
const PROJECT_ID = 'hub-3pmo';
const OUTPUT_PATH  = path.join(__dirname, '../projects.json');
const META_PATH    = path.join(__dirname, '../sync-meta.json');

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format date values to YYYY-MM-DD
 */
function toDateStr(value) {
  if (!value) return null;
  // Firestore REST returns ISO strings for timestamps
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value).slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch (e) {
    return String(value).slice(0, 10);
  }
}

/**
 * Map Firestore document fields to the internal project object
 */
function mapProject(doc) {
  const slug = doc.name.split('/').pop();
  const d = fromFirestoreFields(doc.fields);
  
  const bugs = d.backlog_bugs ?? 0;
  const enh  = d.backlog_enhancements ?? 0;
  const backlog = `🐛 ${bugs} Bug${bugs !== 1 ? 's' : ''} | 🚀 ${enh} Enhancement${enh !== 1 ? 's' : ''}`;

  // NEWLINE PERSISTENCE: Firestore REST returns raw strings with preserved \n.
  // JSON.stringify will escape them as \n which is desired for the JSON cache.

  return {
    slug:        slug,
    name:        d.name        ?? slug,
    status:      d.status      ?? null,
    description: d.description ?? null,
    current_ai:  d.current_ai  ?? null,
    last_active: toDateStr(d.last_active),
    github:      d.github_repo  ?? null,
    drive:       d.drive_path  ?? null,
    local:       d.local_path  ?? null,
    deploy:      d.deploy_method ?? null,
    backlog,
    active_item: d.notes       ?? null,
    parent_project_id: d.parent_project_id ?? null,
    tags:        d.tags        ?? [],
    category:    d.category    ?? null,
    updated_at:  d.updated_at  ?? null,
  };
}

/**
 * Canonical sort order for projects
 */
function sortProjects(projects) {
  const order = { standing: 0, active: 1, tab: 2 };
  return [...projects].sort((a, b) => {
    const ao = order[a.category] ?? 9;
    const bo = order[b.category] ?? 9;
    if (ao !== bo) return ao - bo;
    return (a.name ?? '').localeCompare(b.name ?? '');
  });
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Syncing project registry from Firestore REST API...');

  try {
    if (!fs.existsSync(SA_PATH)) {
      throw new Error(`Service account not found at ${SA_PATH}`);
    }

    const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'));
    const token = await getAccessToken(serviceAccount);

    // Fetch all projects from collection
    const results = await firestoreRequest(PROJECT_ID, 'GET', 'projects', null, token);

    if (!results || !results.documents) {
      console.warn('⚠️  Firestore returned 0 documents — writing empty projects.json');
      fs.writeFileSync(OUTPUT_PATH, '[]');
    } else {
      const projects = sortProjects(results.documents.map(mapProject));
      
      // DATA HARDENING: verify total size before writing
      const jsonContent = JSON.stringify(projects, null, 2);
      if (jsonContent.length > 5 * 1024 * 1024) { // 5MB sanity check
         console.warn('⚠️  Registry cache exceeds 5MB! Check for data bloat.');
      }

      fs.writeFileSync(OUTPUT_PATH, jsonContent);
      console.log(`✅ Synced ${projects.length} projects from Firestore to _System/projects.json`);
    }

    fs.writeFileSync(META_PATH, JSON.stringify({ 
      last_sync: new Date().toISOString(),
      sync_method: 'REST'
    }, null, 2));

  } catch (err) {
    console.error('❌ Failed to sync registry from Firestore:', err.message);
    process.exit(1);
  }
}

main();
