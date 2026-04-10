// Manual Log-then-Update simulate
import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'scripts', 'sa-hub-3pmo.json')));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function testHistory() {
  console.log('Testing Change Log...');
  const testId = 'visibility-fix-p0'; // Using one of the marker docs
  const docRef = db.collection('issues').doc(testId);
  const snap = await docRef.get();
  const oldData = snap.data();

  const newData = { title: 'Standardized Marker - ' + new Date().toISOString() };
  
  // Manual Log-then-Update simulate
  await db.collection('issue_history').add({
    issue_id: testId,
    timestamp: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: 'Antigravity',
    changes: {
      title: { old: oldData.title || null, new: newData.title }
    }
  });

  await docRef.update({
    ...newData,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: 'Antigravity'
  });

  console.log('Update and Log complete for:', testId);
}

testHistory().catch(console.error);
