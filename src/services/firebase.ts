import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

// hub-3pmo — canonical project (migrated 2026-03-24)
// ROLLBACK: revert to thought-organizer-79aff config below if needed
// Old config: { projectId: "thought-organizer-79aff", databaseURL: "https://thought-organizer-79aff-default-rtdb.europe-west1.firebasedatabase.app", ... }
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: "hub-3pmo.firebaseapp.com",
  databaseURL: "https://hub-3pmo-default-rtdb.firebaseio.com",
  projectId: "hub-3pmo",
  storageBucket: "hub-3pmo.firebasestorage.app",
  messagingSenderId: "173074866711",
  appId: "1:173074866711:web:0a4512d32e57e73e2c3252",
};

const app = initializeApp(firebaseConfig);
export const db         = getDatabase(app);
export const firestore  = getFirestore(app);
export const auth       = getAuth(app);
export const functions  = getFunctions(app);
export default app;
