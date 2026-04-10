# PROTOCOL: Firestore Data Integrity & Accountability

**Target Collection**: `issues`
**Project**: `hub-3pmo`

## 1. The Sparse Update Requirement
**All AI Agents** (Antigravity, ClaudeCLI, ClaudeCowork, etc.) MUST use "Sparse Updates" when modifying existing issue records.

- **DO NOT** rewrite the entire document object.
- **DO** only send the specific key-value pairs that are being changed.
- **RATIONALE**: This prevents the accidental wiping of fields that an agent might not have in its local context or state (e.g., custom attributes, legacy descriptions, or internal metadata).

## 2. Mandatory History Logging
Every write operation to the `issues` collection MUST be accompanied by a log entry in the `issue_history` collection.

- **Collection Name**: `issue_history`
- **Required Fields**:
  - `issue_id`: The DocumentID of the modified issue.
  - `timestamp`: Server-side timestamp of the log.
  - `updated_by`: The identity of the agent/user (from the approved list).
  - `changes`: A map of `{ field: { old, new } }` for every modified field.

## 3. Approved AI Identities
When updating the `updated_by` or `created_by` fields, use one of the following:
- `Antigravity`
- `ClaudeCLI`
- `ClaudeCowork`
- `user` (for human UI actions)

## 4. x4 Test Field Protection
The verification fields (`test_compile`, `test_dod`, `test_sit`, `test_uat`) are critical project milestones.
- **AI Restriction**: AI Agents are prohibited from setting `test_uat` to `✅`. This field is reserved for User Acceptance.
- **Integrity**: Any changes to these fields MUST be logged with `old` and `new` values to detect accidental reverts.

## 5. Implementation Standard
To minimize implementation errors, use the centralized service layer:
- **Location**: `src/services/issue-service.ts`
- All UI and script-based modifications should call this service.
