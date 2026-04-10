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

  const markers = [];

  for (const doc of snapshot.docs) {
    const data = doc.data();
    // Logic for markers: No title OR No description OR ID matches known marker patterns
    const isMarker = !data.title || !data.description || 
                     doc.id.includes('fix') || doc.id.includes('check') || doc.id.includes('test');

    if (isMarker) {
      const safeDate = (val) => {
        if (!val) return 'N/A';
        if (typeof val.toDate === 'function') return val.toDate().toISOString();
        if (val instanceof Date) return val.toISOString();
        return String(val);
      };

      markers.push({
        id: doc.id,
        title: data.title || '(EMPTY)',
        description: data.description ? (data.description.substring(0, 50) + '...') : '(EMPTY)',
        status: data.status || 'N/A',
        project_slug: data.project_slug || 'N/A',
        created_at: safeDate(data.created_at),
        updated_at: safeDate(data.updated_at)
      });
    }
  }

  console.log(JSON.stringify(markers, null, 2));
  process.exit(0);

} catch (error) {
  console.error('❌ Audit failed:', error.message);
  process.exit(1);
}
