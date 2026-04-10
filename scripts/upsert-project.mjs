/**
 * upsert-project.mjs
 * Redesigned to use Firestore REST API (no firebase-admin dependency).
 * Add or update a single project document in Firestore (hub-3pmo / projects).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { 
  getAccessToken, 
  toFirestoreFields, 
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

// ── Parse args ───────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const listArg = args.find(a => a === '--list');
const fileArg = args.find(a => a.startsWith('--file='));
const filePath = fileArg ? fileArg.split('=').slice(1).join('=') : null;

if (!listArg && !filePath) {
  console.error('Usage: node upsert-project.mjs --file=./project-data.json');
  console.error('       node upsert-project.mjs --list');
  process.exit(1);
}

// ── Connect ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(SA_PATH)) {
  console.error(`Service account not found at ${SA_PATH}`);
  process.exit(1);
}

const serviceAccount = JSON.parse(fs.readFileSync(SA_PATH, 'utf-8'));
const token = await getAccessToken(serviceAccount);

// ── Handle Commands ─────────────────────────────────────────────────────────
if (listArg) {
  await listProjects();
  process.exit(0);
}

const resolvedPath = path.resolve(filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

// ── Functions ────────────────────────────────────────────────────────────────

async function listProjects() {
  console.log(`\nFetching projects from hub-3pmo...`);
  
  try {
    const results = await firestoreRequest(PROJECT_ID, 'GET', 'projects', null, token);
    
    if (!results || !results.documents) {
      console.log('No projects found.');
      return;
    }

    const projects = results.documents
      .map(doc => {
        const slug = doc.name.split('/').pop();
        return { slug, ...fromFirestoreFields(doc.fields) };
      })
      .filter(p => p.status !== 'Closed' && p.status !== 'Parked');

    // Sort by name
    projects.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    console.log(JSON.stringify(projects, null, 2));
    console.log(`\nFound ${projects.length} active projects.`);
  } catch (err) {
    console.error('Failed to list projects:', err.message);
  }
}

// ── Load data ────────────────────────────────────────────────────────────────
const projectData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));

if (!projectData.slug) {
  console.error('Error: project data must include a "slug" field (used as Firestore document ID)');
  process.exit(1);
}

const { slug, ...fields } = projectData;

// ── Main Script ─────────────────────────────────────────────────────────────

const now = new Date();
const toTimestamp = (value) => {
  if (!value) return null;
  if (value === '__now__') return now;
  return new Date(value);
};

const dateFields = ['created_at', 'last_active', 'updated_at'];
const processed = { ...fields, updated_at: now, updated_by: 'GeminiCLI' };

for (const f of dateFields) {
  if (f in processed) {
    processed[f] = toTimestamp(processed[f]);
  }
}

// Check if it exists to preserve created_at
try {
  const existing = await firestoreRequest(PROJECT_ID, 'GET', `projects/${slug}`, null, token);
  if (existing && !processed.created_at) {
    const data = fromFirestoreFields(existing.fields);
    processed.created_at = data.created_at ? new Date(data.created_at) : now;
  }
} catch (err) {
  if (!processed.created_at) processed.created_at = now;
}

// ── Write ────────────────────────────────────────────────────────────────────
console.log(`\nUpserting project: ${slug}`);

try {
  const payload = { fields: toFirestoreFields(processed) };
  await firestoreRequest(PROJECT_ID, 'PATCH', `projects/${slug}`, payload, token);
  
  console.log(`\n✅ Project "${slug}" written to Firestore hub-3pmo/projects`);
  console.log('\nNext: run  node sync-registry.mjs  to update the projects.json cache (optional for CLI).');
} catch (err) {
  console.error('Failed to write project:', err.message);
  process.exit(1);
}
