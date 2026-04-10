import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pwd = process.cwd();
const keyPath = join(pwd, 'scripts', 'sa-hub-3pmo.json');

const db = getFirestore(initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8')))
}));

async function run() {
  const issuesSnap = await db.collection('issues').get();
  const batch = db.batch();
  let count = 0;

  issuesSnap.docs.forEach(doc => {
    const data = doc.data();
    let updates = {};
    let needsUpdate = false;

    if (!data.created_by) {
      updates.created_by = 'system';
      needsUpdate = true;
    }

    if (!data.created_at) {
      updates.created_at = data.updated_at || FieldValue.serverTimestamp();
      needsUpdate = true;
    }

    if (needsUpdate) {
      console.log(`Fixing record [${doc.id}]: ${data.title}`);
      batch.update(doc.ref, updates);
      count++;
    }
  });

  if (count > 0) {
    await batch.commit();
    console.log(`Successfully fixed ${count} records.`);
  } else {
    console.log('No broken records found.');
  }
}

run().catch(console.error);
