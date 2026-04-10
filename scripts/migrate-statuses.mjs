import admin from 'firebase-admin';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const SA_PATH = path.join(__dirname, 'sa-hub-3pmo.json');

if (!fs.existsSync(SA_PATH)) {
  console.error(`❌ Service account not found at ${SA_PATH}`);
  process.exit(1);
}

const serviceAccount = require(SA_PATH);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'hub-3pmo',
});

const db = admin.firestore();

const MAPPING = {
  'Open': 'Captured',
  'Active': 'Comp',
  'In Progress': 'Comp',
  'Fixing': 'Comp',
  'Testing': 'SIT',
  'UAT': 'UAT',
  'Done': 'Done',
  'Resolved': 'Done',
  'Closed': 'Done',
  'Blocked': 'Blocked',
  'Parked': 'Blocked'
};

/**
 * Migration Strategy:
 * 1. Fetch all documents in 'issues' collection.
 * 2. For each document, if current status is in MAPPING, update to new status.
 * 3. Log results.
 */

async function migrate() {
  console.log('🚀 Starting Issue Status Migration...');
  const snapshot = await db.collection('issues').get();
  
  if (snapshot.empty) {
    console.log('No issues found. Exiting.');
    return;
  }

  let updatedCount = 0;
  let batch = db.batch();
  let opCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const oldStatus = data.status;
    const newStatus = MAPPING[oldStatus];

    if (newStatus && newStatus !== oldStatus) {
      console.log(`[${doc.id}] ${oldStatus} -> ${newStatus}`);
      batch.update(doc.ref, { 
        status: newStatus,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: 'migration-lifecycle-alignment'
      });
      updatedCount++;
      opCount++;

      // Firestore batches are limited to 500 operations
      if (opCount >= 400) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  console.log(`\n✅ Migration Complete. Updated ${updatedCount} issues.`);
}

migrate().catch(err => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
