import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  type User,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  OperationType,
  auth,
  db,
  googleProvider,
  handleFirestoreError,
} from '../firebase.ts';

export type AllowedLine =
  | 'All'
  | 'Line A'
  | 'Line B'
  | 'Body Shop'
  | 'Paint & Coating'
  | 'Powertrain'
  | 'Final Assembly';

export interface WorkspacePreference {
  uid: string;
  defaultLine: AllowedLine;
  alertThreshold: number;
  preferredChannelCapacity: number;
  preferredBatchSize: number;
  updatedAt?: Date;
}

export interface SavedSnapshot {
  id: string;
  uid: string;
  title: string;
  notes: string;
  machineId: string;
  productionLine: AllowedLine;
  fleetEfficiency: number;
  optimalMachines: number;
  attentionMachines: number;
  totalEvents: number;
  status: 'open' | 'reviewed' | 'resolved';
  createdAtMs: number;
}

interface FirebaseContextValue {
  user: User | null;
  authReady: boolean;
  authBusy: boolean;
  authError: string | null;
  preferences: WorkspacePreference | null;
  savedSnapshots: SavedSnapshot[];
  cloudChecklistMap: Record<string, boolean>;
  signInWithGoogle: () => Promise<void>;
  signOutUser: () => Promise<void>;
  savePreferences: (prefs: Omit<WorkspacePreference, 'uid' | 'updatedAt'>) => Promise<void>;
  saveSnapshot: (input: {
    title: string;
    notes: string;
    machineId: string;
    productionLine: AllowedLine;
    fleetEfficiency: number;
    optimalMachines: number;
    attentionMachines: number;
    totalEvents: number;
  }) => Promise<void>;
  advanceSnapshotStatus: (snapshotId: string, nextStatus: 'reviewed' | 'resolved') => Promise<void>;
  deleteSnapshot: (snapshotId: string) => Promise<void>;
  syncChecklistItem: (itemId: string, completed: boolean) => Promise<void>;
}

const FirebaseContext = createContext<FirebaseContextValue | null>(null);

function sanitizeId(raw: string, fallback: string, maxLen = 64): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9_\-]/g, '-').slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

export const FirebaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [preferences, setPreferences] = useState<WorkspacePreference | null>(null);
  const [savedSnapshots, setSavedSnapshots] = useState<SavedSnapshot[]>([]);
  const [cloudChecklistMap, setCloudChecklistMap] = useState<Record<string, boolean>>({});

  // Ensure user profile doc exists in Firestore
  const ensureUserProfile = useCallback(async (u: User) => {
    const userPath = `users/${u.uid}`;
    const userRef = doc(db, 'users', u.uid);
    const displayName = (u.displayName || u.email?.split('@')[0] || 'Plant Operator').slice(0, 80);
    const email = (u.email || 'operator@local').slice(0, 120);
    const photoURL = (u.photoURL || '').slice(0, 500);

    try {
      const snap = await getDoc(userRef);
      if (!snap.exists()) {
        await setDoc(userRef, {
          uid: u.uid,
          displayName,
          email,
          photoURL,
          role: 'operator',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const existing = snap.data();
        if (
          existing.displayName !== displayName ||
          existing.email !== email ||
          (existing.photoURL || '') !== photoURL
        ) {
          await updateDoc(userRef, {
            displayName,
            email,
            photoURL,
            updatedAt: serverTimestamp(),
          });
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, userPath);
    }
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);

      if (!nextUser) {
        setPreferences(null);
        setSavedSnapshots([]);
        setCloudChecklistMap({});
        return;
      }

      if (nextUser.emailVerified) {
        try {
          await ensureUserProfile(nextUser);
        } catch (err) {
          console.error('Failed to sync operator profile:', err);
        }
      }
    });

    return () => unsubscribe();
  }, [ensureUserProfile]);

  // Attach Firestore listeners only when auth is ready and user is signed in
  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) return;

    const prefPath = `users/${user.uid}/preferences/workspace`;
    const unsubPref = onSnapshot(
      doc(db, 'users', user.uid, 'preferences', 'workspace'),
      (snap) => {
        if (!snap.exists()) {
          setPreferences(null);
          return;
        }
        const d = snap.data();
        setPreferences({
          uid: d.uid,
          defaultLine: d.defaultLine,
          alertThreshold: d.alertThreshold,
          preferredChannelCapacity: d.preferredChannelCapacity,
          preferredBatchSize: d.preferredBatchSize,
          updatedAt: d.updatedAt instanceof Timestamp ? d.updatedAt.toDate() : undefined,
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, prefPath);
      }
    );

    const snapsPath = `users/${user.uid}/savedSnapshots`;
    const snapsQuery = query(collection(db, snapsPath), where('uid', '==', user.uid));
    const unsubSnaps = onSnapshot(
      snapsQuery,
      (snapshot) => {
        const rows: SavedSnapshot[] = snapshot.docs.map((docSnap) => {
          const d = docSnap.data();
          const createdAtMs =
            d.createdAt instanceof Timestamp ? d.createdAt.toMillis() : Date.now();
          return {
            id: docSnap.id,
            uid: d.uid,
            title: d.title,
            notes: d.notes,
            machineId: d.machineId,
            productionLine: d.productionLine,
            fleetEfficiency: d.fleetEfficiency,
            optimalMachines: d.optimalMachines,
            attentionMachines: d.attentionMachines,
            totalEvents: d.totalEvents,
            status: d.status,
            createdAtMs,
          };
        });
        rows.sort((a, b) => b.createdAtMs - a.createdAtMs);
        setSavedSnapshots(rows);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, snapsPath);
      }
    );

    const checklistPath = `users/${user.uid}/checklistStates`;
    const checklistQuery = query(collection(db, checklistPath), where('uid', '==', user.uid));
    const unsubChecklist = onSnapshot(
      checklistQuery,
      (snapshot) => {
        const nextMap: Record<string, boolean> = {};
        snapshot.docs.forEach((docSnap) => {
          const d = docSnap.data();
          nextMap[docSnap.id] = Boolean(d.completed);
        });
        setCloudChecklistMap(nextMap);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, checklistPath);
      }
    );

    return () => {
      unsubPref();
      unsubSnaps();
      unsubChecklist();
    };
  }, [authReady, user]);

  const signInWithGoogle = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Google sign-in failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const signOutUser = async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signOut(auth);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign-out failed');
    } finally {
      setAuthBusy(false);
    }
  };

  const savePreferences = async (prefs: Omit<WorkspacePreference, 'uid' | 'updatedAt'>) => {
    if (!user) return;
    await ensureUserProfile(user);
    const path = `users/${user.uid}/preferences/workspace`;
    const ref = doc(db, 'users', user.uid, 'preferences', 'workspace');

    const allowedLines: AllowedLine[] = [
      'All',
      'Line A',
      'Line B',
      'Body Shop',
      'Paint & Coating',
      'Powertrain',
      'Final Assembly',
    ];
    const payload = {
      uid: user.uid,
      defaultLine: (allowedLines.includes(prefs.defaultLine) ? prefs.defaultLine : 'All') as AllowedLine,
      alertThreshold: Math.max(50, Math.min(99, Number(prefs.alertThreshold) || 90)),
      preferredChannelCapacity: Math.max(50, Math.min(10000, Number(prefs.preferredChannelCapacity) || 1000)),
      preferredBatchSize: Math.max(1, Math.min(50, Number(prefs.preferredBatchSize) || 6)),
      updatedAt: serverTimestamp(),
    };

    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        await updateDoc(ref, {
          defaultLine: payload.defaultLine,
          alertThreshold: payload.alertThreshold,
          preferredChannelCapacity: payload.preferredChannelCapacity,
          preferredBatchSize: payload.preferredBatchSize,
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, payload);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const saveSnapshot: FirebaseContextValue['saveSnapshot'] = async (input) => {
    if (!user) return;
    await ensureUserProfile(user);
    const snapshotId = sanitizeId(`snap-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, `snap-${Date.now()}`);
    const path = `users/${user.uid}/savedSnapshots/${snapshotId}`;

    const cleanTitle = input.title.trim().slice(0, 100) || 'Plant Efficiency Snapshot';
    const cleanNotes = input.notes.trim().slice(0, 600);
    const cleanMachineId = sanitizeId(input.machineId, 'All', 16);
    const allowedLines: AllowedLine[] = [
      'All',
      'Line A',
      'Line B',
      'Body Shop',
      'Paint & Coating',
      'Powertrain',
      'Final Assembly',
    ];
    const cleanLine = (allowedLines.includes(input.productionLine)
      ? input.productionLine
      : 'All') as AllowedLine;

    try {
      await setDoc(doc(db, 'users', user.uid, 'savedSnapshots', snapshotId), {
        uid: user.uid,
        title: cleanTitle,
        notes: cleanNotes,
        machineId: cleanMachineId,
        productionLine: cleanLine,
        fleetEfficiency: Math.max(0, Math.min(100, Number(input.fleetEfficiency) || 0)),
        optimalMachines: Math.max(0, Math.min(100, Math.round(input.optimalMachines))),
        attentionMachines: Math.max(0, Math.min(100, Math.round(input.attentionMachines))),
        totalEvents: Math.max(0, Math.round(input.totalEvents)),
        status: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, path);
    }
  };

  const advanceSnapshotStatus = async (snapshotId: string, nextStatus: 'reviewed' | 'resolved') => {
    if (!user) return;
    const cleanId = sanitizeId(snapshotId, '', 128);
    if (!cleanId) return;
    const path = `users/${user.uid}/savedSnapshots/${cleanId}`;
    try {
      await updateDoc(doc(db, 'users', user.uid, 'savedSnapshots', cleanId), {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const deleteSnapshot = async (snapshotId: string) => {
    if (!user) return;
    const cleanId = sanitizeId(snapshotId, '', 128);
    if (!cleanId) return;
    const path = `users/${user.uid}/savedSnapshots/${cleanId}`;
    try {
      await deleteDoc(doc(db, 'users', user.uid, 'savedSnapshots', cleanId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  };

  const syncChecklistItem = async (itemId: string, completed: boolean) => {
    if (!user) return;
    await ensureUserProfile(user);
    const cleanItemId = sanitizeId(itemId, '', 64);
    if (!cleanItemId) return;
    const path = `users/${user.uid}/checklistStates/${cleanItemId}`;
    const ref = doc(db, 'users', user.uid, 'checklistStates', cleanItemId);

    try {
      const existing = await getDoc(ref);
      if (existing.exists()) {
        await updateDoc(ref, {
          completed: Boolean(completed),
          updatedAt: serverTimestamp(),
        });
      } else {
        await setDoc(ref, {
          uid: user.uid,
          itemId: cleanItemId,
          completed: Boolean(completed),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  return (
    <FirebaseContext.Provider
      value={{
        user,
        authReady,
        authBusy,
        authError,
        preferences,
        savedSnapshots,
        cloudChecklistMap,
        signInWithGoogle,
        signOutUser,
        savePreferences,
        saveSnapshot,
        advanceSnapshotStatus,
        deleteSnapshot,
        syncChecklistItem,
      }}
    >
      {children}
    </FirebaseContext.Provider>
  );
};

export function useFirebase(): FirebaseContextValue {
  const ctx = useContext(FirebaseContext);
  if (!ctx) {
    throw new Error('useFirebase must be used inside a FirebaseProvider');
  }
  return ctx;
}
