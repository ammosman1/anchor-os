// src/lib/db.js
// All Firestore read/write operations

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc,
  getDoc, onSnapshot, query, orderBy,
  serverTimestamp, limit,
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
export const addTask = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'tasks'), {
    ...data,
    done: false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

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

export const subscribeBrainDumps = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'brainDumps'), orderBy('createdAt', 'desc'), limit(20)),
    snap => cb(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  );

// ─── Decisions ────────────────────────────────────────────────────────────────
export const addDecision = (uid, data) =>
  addDoc(collection(db, 'users', uid, 'decisions'), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

export const updateDecision = (uid, decisionId, data) =>
  updateDoc(doc(db, 'users', uid, 'decisions', decisionId), {
    ...data,
    updatedAt: serverTimestamp(),
  });

export const subscribeDecisions = (uid, cb) =>
  onSnapshot(
    query(collection(db, 'users', uid, 'decisions'), orderBy('createdAt', 'desc')),
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
