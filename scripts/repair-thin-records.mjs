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

async function repairThinRecords() {
  console.log('--- Starting Thin Records Repair ---');
  const snapshot = await db.collection('issues').get();
  const batch = db.batch();
  let repairCount = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    if (!data.title || data.title.trim().length < 3) {
      const docRef = db.collection('issues').doc(doc.id);
      
      const createTimeStr = doc.createTime ? doc.createTime.toDate().toISOString() : 'Unknown';
      const originalProjectSlug = data.project_slug || 'improve-workflow';
      
      const updatePayload = {
        title: `Audit Restoration (${doc.id})`,
        description: `This record was found to be incomplete during the stabilization audit. Restored to maintain integrity.\nOriginal Creation: ${createTimeStr}`,
        status: 'Parked',
        priority: 'P4',
        type: data.type || 'enhancement',
        project_slug: originalProjectSlug,
        updated_by: 'Antigravity (Audit Repair)',
        updated_at: FieldValue.serverTimestamp()
      };

      // Ensure creation fields exist
      if (!data.created_by) updatePayload.created_by = 'Antigravity (Audit Repair)';
      if (!data.created_at) updatePayload.created_at = doc.createTime || FieldValue.serverTimestamp();
      
      // Ensure test fields exist so it passes rules when updated via UI
      if (!data.test_compile) updatePayload.test_compile = 'N/A';
      if (!data.test_dod) updatePayload.test_dod = 'N/A';
      if (!data.test_sit) updatePayload.test_sit = 'N/A';
      if (!data.test_uat) updatePayload.test_uat = 'N/A';
      
      // DoD array
      if (!data.dod_items) updatePayload.dod_items = [];
      if (!data.logged_date) updatePayload.logged_date = createTimeStr.split('T')[0];

      batch.update(docRef, updatePayload);
      repairCount++;
      console.log(`Prepared repair for doc: ${doc.id}`);
    }
  });

  if (repairCount > 0) {
    console.log(`Commiting repairs for ${repairCount} documents...`);
    await batch.commit();
    console.log('Repair commit successful.');
  } else {
    console.log('No thin records found requiring repair.');
  }
}

repairThinRecords().catch(console.error);
