# Firestore Data Model: Issues Collection

This document explains the current state of the `issues` collection in the `hub-3pmo` project and the standardized state after the upcoming stabilization changes.

## 1. Schema Definition

| Field Name | Type | Frequency | Description |
| :--- | :--- | :--- | :--- |
| **`title`** | String | **Mandatory** | Short summary of the issue. |
| **`description`** | String | Optional | Detailed context, DOD items, or logs. |
| **`project_slug`** | String | **Mandatory** | Normalized Project ID (e.g., `issue-tracker`). |
| **`status`** | String | Required | `Open`, `In Progress`, `UAT`, `Done`, `Parked`. |
| **`type`** | String | Required | `bug` or `enhancement`. |
| **`priority`** | String | Required | `P0` through `P4`. |
| **`created_at`** | Timestamp | **System-Set** | Immutable timestamp of creation. |
| **`created_by`** | String | **System-Set** | Immutable identity of creator. |
| **`updated_at`** | Timestamp | **System-Set** | Timestamp of last modification. |
| **`updated_by`** | String | **System-Set** | Identity of last modifier (`user`, `Antigravity`, `ClaudeCLI`, etc). |

### Verification Cycle (x4 Test Fields)
These four fields track the progress of an issue through the development and testing cycle:
- `test_compile`: Build/Environment pass (`⬜`, `✅`, `❌`, `🚧`).
- `test_dod`: Definition of Done verification (`⬜`, `✅`, `❌`).
- `test_sit`: System Integration Test / Production verification (`⬜`, `✅`, `❌`).
- `test_uat`: User Acceptance (Will's final approval). **AI is prohibited from marking this ✅.**

---

## 2. Redundancy: `id` vs. `DocumentID`

*   **DocumentID**: The primary identifier in Firestore (e.g., `O0g9KuTq...`). It is global and immutable.
*   **Internal `id` field**: A redundant field inside the document data (e.g., `{ "id": "O0g9KuTq..." }`) found in many legacy records.
*   **The Change**: I am removing the internal `id` fields. The React application now maps the native `DocumentID` to the component's `id` property. This reduces data bloat and prevents "ID mismatch" bugs where the internal ID differs from the database key.

---

## 3. Controls & Security

### AI Update Controls
Firestore Security Rules are configured to prevent sensitive data corruption:
- **`allow create`**: Requires `created_at` and `created_by` to match the current time/user.
- **`allow update`**:
  - **Immutable Fields**: `created_at` and `created_by` CANNOT be changed once set.
  - **Validation**: Ensures that an identity (`updated_by`) is always provided from the approved list.

### Sparse Update Mechanism (New)
To prevent the AI from accidentally overwriting fields it cannot see or doesn't care about, we are shifting to **Sparse Updates**.
- **Before**: `updateDoc(docRef, fullObject)` — Overwrites everything. If `description` was missing from memory, it becomes empty in Firestore.
- **After**: `updateDoc(docRef, { title: "New Title" })` — ONLY updates the title. All other fields (like `dod_items` or legacy notes) are safe.

---

## 4. Audit Log (`issue_logs` collection)

Every time an issue is updated, a separate record is created in `issue_logs`:
```json
{
  "issue_id": "DocumentID",
  "timestamp": "2026-04-08T08:00:00Z",
  "updated_by": "Antigravity",
  "changes": {
    "status": { "old": "Open", "new": "In Progress" },
    "priority": { "old": "P2", "new": "P1" }
  }
}
```
This ensures accountability and allows for manual rollback if the AI makes an incorrect decision.
