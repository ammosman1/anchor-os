// public/firebase-messaging-sw.js
// Firebase Cloud Messaging service worker — must be served from the root path.
// Handles background push notifications when the app is closed or backgrounded.

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyBtjkMS5cGRnaQJ35XfeZA7pbRxcO03y_I",
  authDomain:        "anchor-os-473c3.firebaseapp.com",
  projectId:         "anchor-os-473c3",
  storageBucket:     "anchor-os-473c3.firebasestorage.app",
  messagingSenderId: "358877114332",
  appId:             "1:358877114332:web:51e3398946fc33067ae919",
});

const messaging = firebase.messaging();

// Background message handler — shows notification when app is not focused
messaging.onBackgroundMessage((payload) => {
  const { title, body } = payload.notification || {};
  if (!title) return;

  self.registration.showNotification(title, {
    body: body || '',
    icon:  '/logo192.png',
    badge: '/logo192.png',
    data:  payload.data || {},
  });
});

// Notification click handler — opens or focuses the app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.link || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
