/**
 * upsert-project.mjs
 * Add or update a single project document in Firestore (hub-3pmo / projects).
 * Called by AI tools (via user running from Windows terminal) when creating or
 * updating a project entry — replaces the old project-registry.md write pattern.
 *
 * Usage:
 *   node scripts/upsert-project.mjs --file=./project-data.json
 *
 * The JSON file should contain any subset of the project schema fields.
 * Required: slug  (used as the Firestore document ID)
 * All other fields are merged — existing fields not in the JSON are preserved.
 *
 * Service account: scripts/sa-hub-3pmo.json
 * Firestore project: hub-3pmo  |  Collection: projects
 */

import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const require    = createRequire(import.meta.url);

const SA_PATH = path.join(__dirname, 'sa-hub-3pmo.json');

// ── Parse args ───────────────────────────────────────────────────────────────
const args    = process.argv.slice(2);
const fileArg = args.find(a => a.startsWith('--file='));
const filePath = fileArg ? fileArg.split('=').slice(1).join('=') : null;

if (!filePath) {
  console.error('Usage: node scripts/upsert-project.mjs --file=./project-data.json');
  process.exit(1);
}

const resolvedPath = path.resolve(filePath);
if (!fs.existsSync(resolvedPath)) {
  console.error(`File not found: ${resolvedPath}`);
  process.exit(1);
}

// ── Load data ────────────────────────────────────────────────────────────────
const projectData = JSON.parse(fs.readFileSync(resolvedPath, 'utf-8'));

if (!projectData.slug) {
  console.error('Error: project data must include a "slug" field (used as Firestore document ID)');
  process.exit(1);
}

const { slug, ...fields } = projectData;

// ── Connect ──────────────────────────────────────────────────────────────────
if (!fs.existsSync(SA_PATH)) {
  console.error(`Service account not found at ${SA_PATH}`);
  process.exit(1);
}

const serviceAccount = require(SA_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId:  'hub-3pmo',
});

const firestore = admin.firestore();

// ── Timestamps ───────────────────────────────────────────────────────────────
const now = admin.firestore.Timestamp.now();
const toTimestamp = (value) => {
  if (!value) return null;
  if (value === '__now__') return now;
  return admin.firestore.Timestamp.fromDate(new Date(value));
};

// Convert any date string fields to Timestamps
const dateFields = ['created_at', 'last_active', 'updated_at'];
const processed = { ...fields, updated_at: now };

for (const f of dateFields) {
  if (f in processed) {
    processed[f] = toTimestamp(processed[f]);
  }
}

// Set created_at only if creating new (merge won't overwrite existing)
// We check this by doing a get first if created_at not supplied
if (!processed.created_at) {
  const existing = await firestore.collection('projects').doc(slug).get();
  if (!existing.exists) {
    processed.created_at = now;
    console.log(`  → New document — setting created_at to now`);
  }
}

// ── Write ────────────────────────────────────────────────────────────────────
console.log(`\nUpserting project: ${slug}`);
console.log('Fields:', JSON.stringify(
  { ...processed, updated_at: '(now)', created_at: processed.created_at ? '(timestamp)' : '(existing)' },
  null, 2
));

await firestore.collection('projects').doc(slug).set(processed, { merge: true });

console.log(`\n✅ Project "${slug}" written to Firestore hub-3pmo/projects`);
console.log('\nNext: run  node scripts/sync-registry.mjs  then commit + push to update the status page.');
