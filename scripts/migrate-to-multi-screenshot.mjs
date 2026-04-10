import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Use the service account found in the project
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'sa-hub-3pmo.json')));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function migrateScreenshots() {
  console.log('🚀 Starting Multi-Screenshot Migration...');
  
  const issuesRef = db.collection('issues');
  const snapshot = await issuesRef.get();
  
  let migratedCount = 0;
  let skippedCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const { screenshot_url, screenshot_name, screenshots = [] } = data;

    // If there's a legacy URL and it's not already in the array
    if (screenshot_url && !screenshots.some(s => s.url === screenshot_url)) {
      console.log(`📦 Migrating issue: ${doc.id} (${data.title || 'Untitled'})`);
      
      const newScreenshot = {
        url: screenshot_url,
        name: screenshot_name || 'screenshot.png',
        timestamp: Date.now()
      };

      const updatedScreenshots = [...screenshots, newScreenshot];

      await doc.ref.update({
        screenshots: updatedScreenshots,
        // Remove legacy fields
        screenshot_url: admin.firestore.FieldValue.delete(),
        screenshot_name: admin.firestore.FieldValue.delete(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: 'migration-multi-screenshot'
      });
      migratedCount++;
    } else if (screenshot_url && screenshots.some(s => s.url === screenshot_url)) {
      // Just clean up legacy fields if already in array
      console.log(`🧹 Cleaning legacy fields for already migrated issue: ${doc.id}`);
      await doc.ref.update({
        screenshot_url: admin.firestore.FieldValue.delete(),
        screenshot_name: admin.firestore.FieldValue.delete()
      });
      skippedCount++;
    } else {
      skippedCount++;
    }
  }

  console.log('\n✅ Migration Complete!');
  console.log(`📊 Migrated: ${migratedCount}`);
  console.log(`📊 Skipped/Cleaned: ${skippedCount}`);
}

migrateScreenshots().catch(err => {
  console.error('❌ Migration Failed:', err);
  process.exit(1);
});
