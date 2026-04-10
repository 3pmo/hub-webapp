import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pwd = process.cwd();
const keyPath = join(pwd, 'scripts', 'sa-hub-3pmo.json');
const db = getFirestore(initializeApp({
  credential: cert(JSON.parse(readFileSync(keyPath, 'utf8')))
}));

async function migrate() {
  const snapshot = await db.collection('issues').where('status', '==', 'Open').get();
  console.log(`Found ${snapshot.size} issues with status 'Open'`);
  const batch = db.batch();
  snapshot.docs.forEach(doc => {
    batch.update(doc.ref, { status: 'Active' });
  });
  await batch.commit();
  console.log('Migration complete');
}
migrate();
