import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(readFileSync(join(__dirname, 'sa-hub-3pmo.json')));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function auditIntegrity() {
  console.log('--- Starting Issue Integrity Audit ---');
  const issuesSnapshot = await db.collection('issues').get();
  
  const findings = {
    total: issuesSnapshot.size,
    thin: [], // Records with suspiciously little content
    broken_tests: [], // Invalid x4 test markers
    missing_dod: [], // Records missing DoD entirely
    anomalies: []
  };

  const validTests = ['⬜', '✅', '❌', '🚧', 'N/A'];

  issuesSnapshot.forEach(doc => {
    const data = doc.data();
    const id = doc.id;

    // 1. Check for "Thinning" (Suspiciously short description or title)
    if (!data.title || data.title.trim().length < 3) {
      findings.thin.push({ id, field: 'title', value: data.title });
    }
    if (!data.description || data.description.trim().length < 5) {
      // Descriptions can be short, but let's flag extremely short ones
      findings.thin.push({ id, field: 'description', length: data.description?.length || 0 });
    }

    // 2. Audit x4 Test Fields
    const tests = ['test_compile', 'test_dod', 'test_sit', 'test_uat'];
    tests.forEach(testField => {
      const val = data[testField];
      if (!val || !validTests.includes(val)) {
        findings.broken_tests.push({ id, field: testField, value: val });
      }
    });

    // 3. DoD Items
    if (!data.dod_items || !Array.isArray(data.dod_items)) {
      findings.missing_dod.push(id);
    }

    // 4. Mandatory Identity/Audit
    if (!data.project_slug) {
      findings.anomalies.push({ id, error: 'Missing project_slug' });
    }
  });

  console.log(`\nAudit Complete: ${findings.total} records checked.`);
  console.log(`- Suspiciously Thin: ${findings.thin.length}`);
  console.log(`- Broken Test Markers: ${findings.broken_tests.length}`);
  console.log(`- Missing DoD Array: ${findings.missing_dod.length}`);
  console.log(`- General Anomalies: ${findings.anomalies.length}`);

  if (findings.thin.length > 0 || findings.broken_tests.length > 0 || findings.anomalies.length > 0) {
    console.log('\n--- Detailed Findings ---');
    console.log(JSON.stringify(findings, null, 2));
  } else {
    console.log('\n✅ NO INTEGRITY ISSUES DETECTED.');
  }
}

auditIntegrity().catch(console.error);
