// src/lib/firebase.js
// Replace the config object below with your Firebase project config
// Get this from: Firebase Console → Project Settings → Your Apps → Web App

import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

// ─── PASTE YOUR FIREBASE CONFIG HERE ─────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBtjkMS5cGRnaQJ35XfeZA7pbRxcO03y_I",
  authDomain:        "anchor-os-473c3.firebaseapp.com",
  projectId:         "anchor-os-473c3",
  storageBucket:     "anchor-os-473c3.firebasestorage.app",
  messagingSenderId: "358877114332",
  appId:             "1:358877114332:web:51e3398946fc33067ae919",
};
// ─────────────────────────────────────────────────────────────────────────────

const app      = initializeApp(firebaseConfig);
export const auth     = getAuth(app);
export const db       = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

export default app;
