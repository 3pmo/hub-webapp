import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

try {
  initializeApp({ projectId: 'hub-3pmo' });
  const db = getFirestore();
  const snapshot = await db.collection('issues').limit(1).get();
  console.log('Success! Found', snapshot.size, 'documents.');
} catch (error) {
  console.error('Failed to access Firestore:', error.message);
  process.exit(1);
}
