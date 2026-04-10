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

async function getIssues() {
  const snapshot = await db.collection('issues').where('status', 'not-in', ['Done', 'Parked']).get();
  const issues = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  
  // Filter for issue-tracker project issues
  const filtered = issues.filter(i => {
    const slug = (i.project_slug || '').replace(/\s+/g, '-').toLowerCase();
    return slug === 'issue-tracker' || slug === '3pmo-hub'; // 3pmo-hub is the same app
  });
  
  console.log(JSON.stringify(filtered, null, 2));
}
getIssues();
