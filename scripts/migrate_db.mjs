/**
 * migrate_db.js — One-off migration script
 *
 * Copies `thoughts/` and `pairwise_analyses/` from the old
 * thought-organizer-79aff Realtime DB into the new hub-3pmo Realtime DB.
 *
 * SAFE TO RUN MULTIPLE TIMES — uses set() not push(), so it is idempotent.
 * The old DB is READ-ONLY in this script — nothing is deleted or modified.
 */

import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

// ── Source (old project — READ ONLY) ──────────────────────────────────────────
const sourceCred = require(path.join(__dirname, 'sa-thought-organizer.json'));
const sourceApp = admin.initializeApp({
  credential: admin.credential.cert(sourceCred),
  databaseURL: 'https://thought-organizer-79aff-default-rtdb.europe-west1.firebasedatabase.app',
}, 'source');

// ── Destination (new project — WRITE) ─────────────────────────────────────────
const destCred = require(path.join(__dirname, 'sa-hub-3pmo.json'));
const destApp = admin.initializeApp({
  credential: admin.credential.cert(destCred),
  databaseURL: 'https://hub-3pmo-default-rtdb.firebaseio.com',
}, 'dest');

const srcDb = admin.database(sourceApp);
const dstDb = admin.database(destApp);

async function migrateNode(srcPath) {
  console.log(`\n📦 Reading source: ${srcPath}`);
  const snap = await srcDb.ref(srcPath).once('value');
  const data = snap.val();

  if (!data) {
    console.log(`  ⚠️  No data found at ${srcPath} — skipping`);
    return;
  }

  const count = typeof data === 'object' ? Object.keys(data).length : 1;
  console.log(`  ✅ Found ${count} record(s)`);
  console.log(`  ✍️  Writing to destination: ${srcPath}`);

  await dstDb.ref(srcPath).set(data);
  console.log(`  ✅ Done — ${srcPath} migrated successfully`);
}

async function main() {
  console.log('🚀 Starting database migration...');
  console.log('   Source: thought-organizer-79aff (READ ONLY — not modified)');
  console.log('   Destination: hub-3pmo-default-rtdb\n');

  try {
    await migrateNode('thoughts');
    await migrateNode('pairwise_analyses');

    console.log('\n🎉 Migration complete!');
    console.log('   ✅ Verify data in the Firebase Console for hub-3pmo');
    console.log('   ✅ Old data in thought-organizer-79aff is untouched (rollback available)');
    console.log('   ✅ Run the app locally (npm run dev) and test before pushing to production');
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error('   Old data in thought-organizer-79aff is untouched — no rollback needed');
    process.exit(1);
  } finally {
    await sourceApp.delete();
    await destApp.delete();
  }
}

main();
