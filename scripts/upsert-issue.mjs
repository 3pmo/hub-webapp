/**
 * upsert-issue.mjs
 * Redesigned to use Firestore REST API (no firebase-admin dependency).
 * Add or update a single issue document in Firestore (hub-3pmo / issues).
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
const projectArg = args.find(a => a.startsWith('--project='));
const fileArg = args.find(a => a.startsWith('--file='));
const filePath = fileArg ? fileArg.split('=').slice(1).join('=') : null;

if (!listArg && !filePath) {
  console.error('Usage: node upsert-issue.mjs --file=./issue-data.json');
  console.error('       node upsert-issue.mjs --list --project={slug}');
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
  const projectSlug = projectArg ? projectArg.split('=').slice(1).join('=') : null;
  if (!projectSlug) {
    console.error('Usage: node upsert-issue.mjs --list --project={slug}');
    process.exit(1);
  }
  
  await listIssues(projectSlug);
  process.exit(0);
}

const resolvedPath = path.resolve(filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

// ── Load data ────────────────────────────────────────────────────────────────
const issueData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));
const { id, ...fields } = issueData;

if (!id && (!fields.project_slug || !fields.type || !fields.title)) {
  console.error('Error: new issues must include project_slug, type, and title');
  process.exit(1);
}

// ── Functions ────────────────────────────────────────────────────────────────

async function listIssues(slug) {
  console.log(`\nFetching issues for project: ${slug}...`);
  
  // REST runQuery payload
  const query = {
    structuredQuery: {
      from: [{ collectionId: 'issues' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'project_slug' },
          op: 'EQUAL',
          value: { stringValue: slug }
        }
      }
    }
  };

  try {
    const results = await firestoreRequest(PROJECT_ID, 'POST', ':runQuery', query, token);
    
    const issues = results
      .filter(r => r.document)
      .map(r => {
        const doc = r.document;
        const id = doc.name.split('/').pop();
        return { id, ...fromFirestoreFields(doc.fields) };
      })
      .filter(doc => !['Done', 'Closed', 'Parked'].includes(doc.status));

    issues.sort((a, b) => (a.priority || 'P3').localeCompare(b.priority || 'P3'));

    if (issues.length === 0) {
      console.log('No open issues found.');
    } else {
      console.log(JSON.stringify(issues, null, 2));
    }
  } catch (err) {
    console.error('Failed to list issues:', err.message);
  }
}

// ── Main Script ─────────────────────────────────────────────────────────────

const now = new Date();
const toTimestamp = (value) => {
  if (!value) return null;
  if (value === '__now__') return now;
  return new Date(value);
};

const dateFields = ['created_at', 'updated_at', 'logged_date'];
const processed = { ...fields, updated_at: now, updated_by: 'GeminiCLI' };

for (const f of dateFields) {
  if (f in processed) {
    processed[f] = toTimestamp(processed[f]);
  }
}

let docId = id;
if (docId) {
  // Check if it exists and preserve created_at if not provided
  try {
    const existing = await firestoreRequest(PROJECT_ID, 'GET', `issues/${docId}`, null, token);
    if (existing && !processed.created_at) {
      const data = fromFirestoreFields(existing.fields);
      processed.created_at = data.created_at ? new Date(data.created_at) : now;
    }
  } catch (err) {
    if (!processed.created_at) processed.created_at = now;
  }
} else {
  // Generate random ID or let firestore handle it (REST POST issues)
  processed.created_at = processed.created_at || now;
}

// Defaults for new issues
if (!docId || processed.created_at === now) {
  if (!processed.status) processed.status = 'New';
  if (!processed.priority) processed.priority = 'P2';
  if (!processed.test_unit) processed.test_unit = '⬜';
  if (!processed.test_sit) processed.test_sit = '⬜';
  if (!processed.test_uat) processed.test_uat = '⬜';
}

// ── Write ────────────────────────────────────────────────────────────────────
try {
  let result;
  if (docId) {
    // PATCH to specific document
    const payload = { fields: toFirestoreFields(processed) };
    result = await firestoreRequest(PROJECT_ID, 'PATCH', `issues/${docId}`, payload, token);
  } else {
    // POST to collection (create new)
    const payload = { fields: toFirestoreFields(processed) };
    result = await firestoreRequest(PROJECT_ID, 'POST', 'issues', payload, token);
    docId = result.name.split('/').pop();
  }
  
  console.log(`\n✅ Issue "${docId}" written to Firestore hub-3pmo/issues`);
} catch (err) {
  console.error('Failed to write issue:', err.message);
  process.exit(1);
}
