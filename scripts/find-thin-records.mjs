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

async function findThinRecords() {
  const snapshot = await db.collection('issues').get();
  const thin = [];

  snapshot.forEach(doc => {
    const data = doc.data();
    if (!data.title || data.title.trim().length < 3) {
       thin.push({
         id: doc.id,
         project_slug: data.project_slug || 'unknown',
         createTime: doc.createTime.toDate(),
         fields: Object.keys(data)
       });
    }
  });

  console.log(JSON.stringify(thin, null, 2));
  process.exit(0);
}

findThinRecords().catch(console.error);
