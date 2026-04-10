import admin from 'firebase-admin';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const require    = createRequire(import.meta.url);

const SA_PATH = path.join(__dirname, 'sa-hub-3pmo.json');

console.log('--- Firestore Data Repair Started ---');

try {
  const serviceAccount = require(SA_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'hub-3pmo'
  });

  const db = admin.firestore();
  const issuesRef = db.collection('issues');
  const snapshot = await issuesRef.get();

  console.log(`Found ${snapshot.size} issues to check.`);
  let updatedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const updates = {};

    // 1. Normalize project_slug for issue-tracker variants
    if (data.project_slug === 'issue tracker' || data.project_slug === 'Issue Tracker') {
      updates.project_slug = 'issue-tracker';
    }

    // 2. Backfill created_at if missing
    if (!data.created_at) {
      if (data.logged_date) {
        // Fallback to logged_date string (at midnight)
        updates.created_at = admin.firestore.Timestamp.fromDate(new Date(data.logged_date));
      } else {
        // Fallback to internal document create time
        updates.created_at = doc.createTime;
      }
    }

    // 3. Backfill updated_at if missing
    if (!data.updated_at) {
      updates.updated_at = doc.updateTime;
    }

    // 4. Remove redundant internal 'id' field
    if (Object.prototype.hasOwnProperty.call(data, 'id')) {
      updates.id = admin.firestore.FieldValue.delete();
    }

    if (Object.keys(updates).length > 0) {
      await doc.ref.update(updates);
      updatedCount++;
    }
  }

  console.log(`--- Sync Complete ---`);
  console.log(`Successfully repaired ${updatedCount} documents.`);
  process.exit(0);

} catch (error) {
  console.error('❌ Repair failed:', error.message);
  process.exit(1);
}
