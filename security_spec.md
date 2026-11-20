# Firestore Security Specification

## 1. Data Invariants
1. **Owner-Only PII Isolation**: A `users/{userId}` document contains PII (`email`) and may only be read (`get`), created, or updated by the verified authenticated user whose `request.auth.uid == userId`. Collection `list` on `/users` is denied.
2. **Self-Assigned Role Prevention**: During `UserProfile` creation, `role` must strictly equal `'operator'`, and `role`, `uid`, and `createdAt` are immutable on update.
3. **Subcollection Ownership**: Documents under `/users/{userId}/preferences/{prefId}`, `/users/{userId}/savedSnapshots/{snapshotId}`, and `/users/{userId}/checklistStates/{itemId}` require `exists(/databases/$(database)/documents/users/$(userId))`, `request.auth.uid == userId`, `request.auth.token.email_verified == true`, and `incoming().uid == request.auth.uid`.
4. **Temporal & Structural Integrity**: All `createdAt` and `updatedAt` fields must equal `request.time`. All creates enforce `keys().hasAll(...) && keys().hasOnly(...)`; all updates enforce `affectedKeys().hasOnly(...)`.
5. **Terminal State Locking**: Once a `SavedSnapshot` transitions to `status == 'resolved'`, further updates are rejected.

## 2. Adversarial "Dirty Dozen" Payloads (Expected: PERMISSION_DENIED)
1. **Unauthenticated Read**: `GET /users/u1` with `auth == null` -> DENIED.
2. **Cross-User PII Read**: `GET /users/u1` signed in as `u2` -> DENIED.
3. **Unverified Email Write**: `CREATE /users/u2` with `email_verified == false` -> DENIED.
4. **Privilege Escalation on Create**: `CREATE /users/u1` with `{ ..., role: "admin" }` -> DENIED.
5. **Shadow Ghost Field**: `CREATE /users/u1/savedSnapshots/snap1` with extra field `isApproved: true` -> DENIED.
6. **Client Timestamp Forgery**: `CREATE /users/u1/savedSnapshots/snap1` with `createdAt: "2020-01-01T00:00:00Z"` instead of `request.time` -> DENIED.
7. **Identity Spoofing in Subcollection**: `CREATE /users/u1/savedSnapshots/snap1` with `uid: "u2"` while signed in as `u1` -> DENIED.
8. **ID Poisoning (>128 chars or invalid chars)**: `CREATE /users/u1/savedSnapshots/invalid..id!` -> DENIED.
9. **String Size Exhaustion**: `CREATE /users/u1/savedSnapshots/snap1` with 2000-char `notes` -> DENIED.
10. **Immutable Field Tampering**: `UPDATE /users/u1/savedSnapshots/snap1` changing `createdAt` or `uid` -> DENIED.
11. **Terminal State Mutation**: `UPDATE /users/u1/savedSnapshots/snap1` when `existing().status == 'resolved'` -> DENIED.
12. **Blanket List Query**: `LIST /users` or `LIST /users/u1/savedSnapshots` signed in as `u2` -> DENIED.
