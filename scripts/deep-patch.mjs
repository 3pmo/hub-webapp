import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'sa-hub-3pmo.json'), 'utf8'));

initializeApp({
  credential: cert(serviceAccount)
});

const db = getFirestore();

async function deepPatch() {
  const batch = db.batch();
  
  // 1. empty description
  batch.update(db.collection('issues').doc('visibility-fix-p0'), {
      description: 'Audit Restoration: legacy record had no description.'
  });

  // 2. broken test markers
  batch.update(db.collection('issues').doc('XJqSnZixDuASrHd9tpre'), {
      test_compile: '🚧',
      test_sit: '🚧'
  });
  
  batch.update(db.collection('issues').doc('mbk8yhXeDXbgu4MXet2n'), {
      test_compile: '✅',
      test_sit: '✅'
  });

  await batch.commit();
  console.log('Final deep patch applied.');
}

deepPatch().catch(console.error);
