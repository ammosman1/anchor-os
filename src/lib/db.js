// src/lib/db.js
// All Firestore read/write operations

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, getDocs, onSnapshot, query, orderBy, limit, where,
  serverTimestamp, arrayUnion,
} from 'firebase/firestore';
import { db } from './firebase';

// ─── User Profile ─────────────────────────────────────────────────────────────
export const saveProfile = (uid, data) =>
  setDoc(doc(db, 'users', uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });

export const getProfile = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid));
  return snap.exists() ? snap.data() : null;
};

export const subscribeProfile = (uid, cb) =>
  onSnapshot(doc(db, 'users', uid), snap => cb(snap.exists() ? snap.data() : null));

// ─── AI Cache ─────────────────────────────────────────────────────────────────
// Stores AI responses with timestamps — only regenerate if stale (>24h)
export const saveAICache = (uid, key, text) =>
  setDoc(doc(db, 'users', uid, 'aiCache', key), {
    text,
    cachedAt: serverTimestamp(),
    cachedAtMs: Date.now(),
  });

export const getAICache = async (uid, key, maxAgeHours = 24) => {
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'aiCache', key));
    if (!snap.exists()) return null;
    const data = snap.data();
    const ageMs = Date.now() - (data.cachedAtMs || 0);
    const maxMs = maxAgeHours * 60 * 60 * 1000;
    if (ageMs > maxMs) return null; // stale
    return data.text;
  } catch {
    return null;
  }
};

export const clearAICache = async (uid, key) => {
  try { await deleteDoc(doc(db, 'users', uid, 'aiCache', key)); } catch {}
};

// ─── Projects ─────────────────────────────────────────────────────────────────
export const addProject = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'projects'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateProject = (uid, projectId, data) =>
  updateDoc(doc(db, 'users', uid, 'projects', projectId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteProject = (uid, projectId) =>
  deleteDoc(doc(db, 'users', uid, 'projects', projectId));

export const subscribeProjects = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'projects'), orderBy('updatedAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Tasks ────────────────────────────────────────────────────────────────────
export const addTask = async (uid, data) => {
  // If projectId not set but project name is, try to find the project
  let finalData = { ...data };
  if (!finalData.projectId && finalData.project && finalData.project !== 'Inbox') {
    // projectId will be set by caller if known, otherwise stays null
  }
  const ref = await addDoc(collection(db, 'users', uid, 'tasks'), {
    ...finalData,
    done: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref;
};

export const updateTask = (uid, taskId, data) =>
  updateDoc(doc(db, 'users', uid, 'tasks', taskId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteTask = (uid, taskId) =>
  deleteDoc(doc(db, 'users', uid, 'tasks', taskId));

export const subscribeTasks = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'tasks'), orderBy('createdAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Brain Dumps ──────────────────────────────────────────────────────────────
export const saveBrainDump = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'brainDumps'), {
    ...data,
    createdAt: serverTimestamp(),
  });

export const updateBrainDump = (uid, dumpId, data) =>
  updateDoc(doc(db, 'users', uid, 'brainDumps', dumpId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const subscribeBrainDumps = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'brainDumps'), orderBy('createdAt', 'desc'), limit(30)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Ideas ────────────────────────────────────────────────────────────────────
export const addIdea = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'ideas'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateIdea = (uid, ideaId, data) =>
  updateDoc(doc(db, 'users', uid, 'ideas', ideaId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const subscribeIdeas = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'ideas'), orderBy('createdAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Debt Accounts ────────────────────────────────────────────────────────────
export const addDebtAccount = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'debtAccounts'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateDebtAccount = (uid, accountId, data) =>
  updateDoc(doc(db, 'users', uid, 'debtAccounts', accountId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteDebtAccount = (uid, accountId) =>
  deleteDoc(doc(db, 'users', uid, 'debtAccounts', accountId));

export const subscribeDebtAccounts = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'debtAccounts'), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Advisor Chats ────────────────────────────────────────────────────────────
export const saveAdvisorChat = (uid, sessionId, messages) =>
  setDoc(doc(db, 'users', uid, 'advisorChats', sessionId), {
    messages,
    updatedAt: serverTimestamp(),
  });

export const getAdvisorChat = async (uid, sessionId) => {
  const snap = await getDoc(doc(db, 'users', uid, 'advisorChats', sessionId));
  return snap.exists() ? snap.data() : null;
};

export const subscribeAdvisorChats = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'advisorChats'), orderBy('updatedAt', 'desc'), limit(30)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Plaid Items ──────────────────────────────────────────────────────────────
export const savePlaidItem = (uid, itemId, data) =>
  setDoc(doc(db, 'users', uid, 'plaidItems', itemId), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const deletePlaidItem = (uid, itemId) =>
  deleteDoc(doc(db, 'users', uid, 'plaidItems', itemId));

export const subscribePlaidItems = (uid, cb) =>
  onSnapshot(
    collection(db, 'users', uid, 'plaidItems'),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Asset Accounts ───────────────────────────────────────────────────────────
export const addAssetAccount = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'assetAccounts'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateAssetAccount = (uid, accountId, data) =>
  updateDoc(doc(db, 'users', uid, 'assetAccounts', accountId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteAssetAccount = (uid, accountId) =>
  deleteDoc(doc(db, 'users', uid, 'assetAccounts', accountId));

export const subscribeAssetAccounts = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'assetAccounts'), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// Appends a balance snapshot to a debt account's history array (for progress tracking)
export const addDebtBalanceSnapshot = (uid, accountId, balance) =>
  updateDoc(doc(db, 'users', uid, 'debtAccounts', accountId), {
    balanceHistory: arrayUnion({ date: new Date().toISOString().split('T')[0], balance }),
    updatedAt: serverTimestamp(),
  });

// ─── Manual Cash Flow ─────────────────────────────────────────────────────────
export const saveManualCashFlow = (uid, data) =>
  setDoc(doc(db, 'users', uid, 'cashFlow', 'manual'), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const subscribeManualCashFlow = (uid, cb) =>
  onSnapshot(
    doc(db, 'users', uid, 'cashFlow', 'manual'),
    snap => cb(snap.exists() ? snap.data() : null)
  );

// ─── Calendar Integration ─────────────────────────────────────────────────────
export const saveCalendarTokens = (uid, data) =>
  setDoc(doc(db, 'users', uid, 'integrations', 'googleCalendar'), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const getCalendarTokens = async (uid) => {
  const snap = await getDoc(doc(db, 'users', uid, 'integrations', 'googleCalendar'));
  return snap.exists() ? snap.data() : null;
};

export const subscribeCalendarIntegration = (uid, cb) =>
  onSnapshot(
    doc(db, 'users', uid, 'integrations', 'googleCalendar'),
    snap => cb(snap.exists() ? snap.data() : null)
  );

export const disconnectCalendar = (uid) =>
  deleteDoc(doc(db, 'users', uid, 'integrations', 'googleCalendar'));

// ─── Goals ────────────────────────────────────────────────────────────────────
export const addGoal = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'goals'), {
    ...data,
    likelihoodScore: null,
    likelihoodTrend: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateGoal = (uid, goalId, data) =>
  updateDoc(doc(db, 'users', uid, 'goals', goalId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteGoal = (uid, goalId) =>
  deleteDoc(doc(db, 'users', uid, 'goals', goalId));

export const subscribeGoals = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'goals'), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Weekly Reviews ───────────────────────────────────────────────────────────
export const saveWeeklyReview = (uid, weekKey, data) =>
  setDoc(doc(db, 'users', uid, 'weeklyReviews', weekKey), {
    ...data,
    savedAt: serverTimestamp(),
  });

export const getWeeklyReview = async (uid, weekKey) => {
  const snap = await getDoc(doc(db, 'users', uid, 'weeklyReviews', weekKey));
  return snap.exists() ? snap.data() : null;
};

export const subscribeWeeklyReviews = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'weeklyReviews'), orderBy('savedAt', 'desc'), limit(12)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Daily Reviews (morning / EOD) ───────────────────────────────────────────
// Stored in a sub-collection to avoid growing the user profile document.
// Key is "type_date" e.g. "morning_2026-05-17" — idempotent re-saves are safe.
export const saveDailyReview = (uid, data) =>
  setDoc(doc(db, 'users', uid, 'dailyReviews', `${data.type}_${data.date}`), {
    ...data,
    savedAt: serverTimestamp(),
  });

export const subscribeDailyReviews = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'dailyReviews'), orderBy('date', 'desc'), limit(60)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Work Schedule Blocks (WF import) ────────────────────────────────────────
// Each block tracks one imported GCal event so we can delete/replace on re-import.
export const addWorkScheduleBlock = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'workScheduleBlocks'), {
    ...data,
    importedAt: serverTimestamp(),
  });

export const getWorkScheduleBlocksInRange = async (uid, rangeStart, rangeEnd) => {
  const snap = await getDocs(
    query(
      collection(db, 'users', uid, 'workScheduleBlocks'),
      where('date', '>=', rangeStart),
      where('date', '<=', rangeEnd),
    )
  );
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
};

export const deleteWorkScheduleBlock = (uid, blockId) =>
  deleteDoc(doc(db, 'users', uid, 'workScheduleBlocks', blockId));

// ─── Habits ───────────────────────────────────────────────────────────────────
export const addHabit = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'habits'), {
    ...data,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateHabit = (uid, habitId, data) =>
  updateDoc(doc(db, 'users', uid, 'habits', habitId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteHabit = (uid, habitId) =>
  deleteDoc(doc(db, 'users', uid, 'habits', habitId));

export const subscribeHabits = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'habits'), orderBy('createdAt', 'asc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// habitLog ID is `${habitId}_${date}` — deterministic so setDoc is idempotent
export const setHabitLog = (uid, habitId, date, done) =>
  setDoc(doc(db, 'users', uid, 'habitLogs', `${habitId}_${date}`), {
    habitId, date, done, updatedAt: serverTimestamp(),
  });

export const subscribeHabitLogs = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'habitLogs'), orderBy('date', 'desc'), limit(500)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Notes ────────────────────────────────────────────────────────────────────
export const addNote = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'notes'), {
    ...data,
    pinned: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateNote = (uid, noteId, data) =>
  updateDoc(doc(db, 'users', uid, 'notes', noteId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteNote = (uid, noteId) =>
  deleteDoc(doc(db, 'users', uid, 'notes', noteId));

export const subscribeNotes = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'notes'), orderBy('updatedAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Documents ────────────────────────────────────────────────────────────────
export const addDocument = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'documents'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateDocument = (uid, docId, data) =>
  updateDoc(doc(db, 'users', uid, 'documents', docId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const deleteDocument = (uid, docId) =>
  deleteDoc(doc(db, 'users', uid, 'documents', docId));

export const subscribeDocuments = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'documents'), orderBy('createdAt', 'desc')),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );
