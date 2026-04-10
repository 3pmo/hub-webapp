import { 
  firestore,
  storage 
} from './firebase'; // Fixed path
import { 
  ref, 
  uploadBytes, 
  getDownloadURL 
} from 'firebase/storage';
import { 
  doc, 
  updateDoc, 
  addDoc, 
  collection, 
  serverTimestamp, 
  getDoc,
  getDocs,
  where,
  query,
  orderBy
} from 'firebase/firestore';

export interface Issue {
  id: string;
  title: string;
  description: string;
  project_slug: string;
  status: string;
  priority: string;
  type: 'bug' | 'enhancement';
  test_compile: string;
  test_dod: string;
  test_sit: string;
  test_uat: string;
  screenshots?: { url: string; name: string; timestamp: number }[];
  screenshot_url?: string;  // Keep for backward compat until migration
  screenshot_name?: string; // Keep for backward compat until migration
  created_at?: any;
  created_by?: string;
  updated_at?: any;
  updated_by?: string;
}

export type AIIdentity = 'Antigravity' | 'ClaudeCLI' | 'ClaudeCowork' | 'user';

class IssueService {
  private collectionName = 'issues';
  private historyCollectionName = 'issue_history';

  /**
   * Perform a surgical (sparse) update on an issue and log the history.
   */
  async updateIssue(
    issueId: string, 
    newData: Partial<Issue>, 
    updatedBy: AIIdentity = 'user'
  ): Promise<void> {
    const docRef = doc(firestore, this.collectionName, issueId);
    
    // 1. Fetch current data for diffing
    const snap = await getDoc(docRef);
    if (!snap.exists()) throw new Error('Issue not found');
    const oldData = snap.data() as Issue;

    // 2. Compute changes
    const changes: Record<string, { old: any; new: any }> = {};
    const updatePayload: Record<string, any> = {
      updated_at: serverTimestamp(),
      updated_by: updatedBy
    };

    // Only include fields that have actually changed
    for (const key in newData) {
      const newVal = (newData as any)[key];
      const oldVal = (oldData as any)[key];

      if (JSON.stringify(newVal) !== JSON.stringify(oldVal)) {
        // AI GATE ENFORCEMENT: Block AI from ticking test_uat
        if (key === 'test_uat' && newVal === '✅' && updatedBy !== 'user') {
          throw new Error('🚧 MANUAL UAT GATE: Only the human user can mark UAT as passed.');
        }
        
        changes[key] = { old: oldVal || null, new: newVal };
        updatePayload[key] = newVal;
      }
    }

    // 3. If no changes, skip logging and extra update
    if (Object.keys(changes).length === 0) return;

    // 4. Write History Log FIRST (Atomic-like order)
    await addDoc(collection(firestore, this.historyCollectionName), {
      issue_id: issueId,
      timestamp: serverTimestamp(),
      updated_by: updatedBy,
      changes
    });

    // 5. Apply Sparse Update
    await updateDoc(docRef, updatePayload);
  }

  /**
   * Fetch history records for an issue.
   */
  async getHistory(issueId: string): Promise<any[]> {
    const q = query(
      collection(firestore, this.historyCollectionName),
      where('issue_id', '==', issueId),
      orderBy('timestamp', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  }

  /**
   * Create a new issue.
   */
  async createIssue(data: Omit<Issue, 'id'>, createdBy: AIIdentity = 'user'): Promise<string> {
    const docRef = await addDoc(collection(firestore, this.collectionName), {
      ...data,
      created_at: serverTimestamp(),
      created_by: createdBy,
      updated_at: serverTimestamp(),
      updated_by: createdBy,
      logged_date: new Date().toISOString().split('T')[0]
    });
    return docRef.id;
  }

  /**
   * Upload a screenshot for a specific issue.
   */
  async uploadScreenshot(issueId: string, file: File): Promise<{ url: string; name: string; timestamp: number }> {
    const timestamp = Date.now();
    const fileName = `${timestamp}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    const storageRef = ref(storage, `issues/${issueId}/screenshots/${fileName}`);
    
    await uploadBytes(storageRef, file);
    const downloadUrl = await getDownloadURL(storageRef);
    
    return {
      url: downloadUrl,
      name: file.name,
      timestamp
    };
  }
}

export const issueService = new IssueService();
