import admin from 'firebase-admin';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const require    = createRequire(import.meta.url);

const SA_PATH = path.join(__dirname, 'sa-hub-3pmo.json');

try {
  const serviceAccount = require(SA_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: 'hub-3pmo'
  });

  const db = admin.firestore();
  const issuesRef = db.collection('issues');
  const snapshot = await issuesRef.get();

  console.log(`Auditing ${snapshot.size} issues...`);
  const results = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const id = doc.id;
    
    const issuesFound = [];
    if (!data.title) issuesFound.push('missing_title');
    if (!data.description) issuesFound.push('missing_description');
    if (!data.project_slug) issuesFound.push('missing_slug');
    if (!data.created_at) issuesFound.push('missing_created_at');

    if (issuesFound.length > 0) {
      results.push({ id, status: data.status, issuesFound, titlePreview: data.title || 'N/A' });
    }
  }

  if (results.length > 0) {
    console.log('Results (Issues with missing fields):');
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log('No issues with missing fields found (Title, Description, Slug).');
  }
  
  process.exit(0);

} catch (error) {
  console.error('❌ Diagnostic failed:', error.message);
  process.exit(1);
}
