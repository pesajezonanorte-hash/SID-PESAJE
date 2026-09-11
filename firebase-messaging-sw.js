// Service Worker for Firebase Cloud Messaging
// Handles background notifications when the app is not in focus
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging.js');

const firebaseConfig = {
  apiKey: 'AIzaSyAOraPD6LrhNXEqM0ClPEwZwPEWfVG1ZMk',
  authDomain: 'sidpesaje.firebaseapp.com',
  projectId: 'sidpesaje',
  storageBucket: 'sidpesaje.firebasestorage.app',
  messagingSenderId: '449735968404',
  appId: '1:449735968404:web:8d103e1655e7cd76635681',
  measurementId: 'G-5KX8TYL5JX'
};

firebase.initializeApp(firebaseConfig);
const messaging = firebase.messaging();

// Handle background messages when app is not visible
messaging.onBackgroundMessage((payload) => {
  console.log('[Firebase Messaging] Background message received:', payload);

  const notificationTitle = payload.notification?.title || 'Notificación';
  const notificationOptions = {
    body: payload.notification?.body || 'Has recibido una actualización',
    icon: '/icon-192x192.png',
    badge: '/badge-72x72.png',
    tag: payload.data?.appointmentId || 'appointment-notification',
    requireInteraction: false,
    data: payload.data || {}
  };

  self.registration.showNotification(notificationTitle, notificationOptions);
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const appointmentId = event.notification.data?.appointmentId;
  if (appointmentId) {
    event.waitUntil(
      clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
        // Check if app window is already open
        for (let client of clientList) {
          if (client.url === '/' || client.url.includes('index.html')) {
            if ('focus' in client) {
              return client.focus().then(() => {
                // Send message to client to navigate to appointment
                client.postMessage({
                  type: 'APPOINTMENT_CLICKED',
                  appointmentId: appointmentId
                });
              });
            }
          }
        }
        // If no window found, open new one
        if (clients.openWindow) {
          return clients.openWindow(`/?appointmentId=${appointmentId}`);
        }
      })
    );
  }
});
