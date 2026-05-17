// src/lib/notifications.js
// FCM push notification helpers for the client.
// Call requestNotificationPermission() once (e.g., from ProfileScreen or onboarding).
// The FCM token is saved to Firestore so the server can send pushes.

import { getMessaging, getToken, onMessage } from 'firebase/messaging';
import app from './firebase';
import { saveProfile } from './db';

// VAPID key from Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = process.env.REACT_APP_FIREBASE_VAPID_KEY || '';

let messagingInstance = null;

function getMessagingInstance() {
  if (!messagingInstance) {
    messagingInstance = getMessaging(app);
  }
  return messagingInstance;
}

// Request notification permission and save FCM token to Firestore.
// Returns: 'granted' | 'denied' | 'unsupported' | 'error'
export async function requestNotificationPermission(uid) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return 'unsupported';
  }

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';

    // Register service worker if not already registered
    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

    const messaging = getMessagingInstance();
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });

    if (!token) return 'error';

    // Save token to Firestore so cron routes can send pushes
    await saveProfile(uid, { fcmToken: token, notificationsEnabled: true });

    return 'granted';
  } catch (err) {
    console.error('FCM token error:', err);
    return 'error';
  }
}

// Listen for foreground messages (app is open).
// onMessageReceived(payload) is called with the notification payload.
// Returns an unsubscribe function.
export function listenForMessages(onMessageReceived) {
  if (!('Notification' in window)) return () => {};

  try {
    const messaging = getMessagingInstance();
    return onMessage(messaging, (payload) => {
      onMessageReceived(payload);
    });
  } catch {
    return () => {};
  }
}

// Disable notifications — clears the FCM token from Firestore.
export async function disableNotifications(uid) {
  await saveProfile(uid, { fcmToken: null, notificationsEnabled: false });
}
