import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'sa-hub-3pmo.json'), 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function repairAnomalies() {
  const anomaliesToFix = [
    'EpW4j99JXxeBq9wTbioG',
    'Go46jpFOTbO9CNSA9Zyp',
    'NEnEkav59tcNZFAY0gSQ',
    'O36gLP6qHkf0mwmFm69Z',
    'hPuWFiG5uBMT09U522Yw',
    'izKy8l0PPvsrYmVfXQwC',
    'visibility-fix-p0'
  ];
  
  const batch = db.batch();
  
  for (const docId of anomaliesToFix) {
      const docRef = db.collection('issues').doc(docId);
      const docSnap = await docRef.get();
      if (!docSnap.exists) continue;
      
      const data = docSnap.data();
      const payload = {};
      
      if (!data.dod_items) payload.dod_items = [];
      if (!data.project_slug) payload.project_slug = 'improve-workflow';
      if (data.test_uat === undefined) payload.test_uat = 'N/A';
      if (data.test_sit === undefined) payload.test_sit = 'N/A';
      if (data.test_compile === undefined) payload.test_compile = 'N/A';
      if (data.test_dod === undefined) payload.test_dod = 'N/A';
      
      if (Object.keys(payload).length > 0) {
          batch.update(docRef, payload);
          console.log(`Repaired anomaly: ${docId}`, payload);
      }
  }

  await batch.commit();
  console.log('All anomalies fixed.');
}

repairAnomalies().catch(console.error);
