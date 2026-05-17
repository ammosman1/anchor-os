// api/_firebase-admin.js
// Shared Firebase Admin SDK initializer for all Vercel serverless functions.
// Set FIREBASE_SERVICE_ACCOUNT env var in Vercel with the service account JSON string.

import admin from 'firebase-admin';

let initialized = false;

export function getAdminApp() {
  if (initialized) return admin.app();

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!serviceAccount) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT environment variable not set');
  }

  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(serviceAccount)),
    projectId: 'anchor-os-473c3',
  });

  initialized = true;
  return admin.app();
}

export function getAdminDb() {
  getAdminApp();
  return admin.firestore();
}

export function getAdminMessaging() {
  getAdminApp();
  return admin.messaging();
}
