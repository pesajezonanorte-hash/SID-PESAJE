# Firebase Cloud Functions Setup — FCM Push Notifications

This guide explains how to set up Cloud Functions for handling appointment status changes and sending push notifications.

## Prerequisites

- Firebase CLI installed: `npm install -g firebase-tools`
- Google Cloud Account with Firebase enabled
- Node.js 16+ (for Cloud Functions)

## Step 1: Initialize Firebase Functions Project

Create a separate directory for your functions (recommended):

```bash
# Navigate to your project root
cd ~/Projects

# Create a new directory for functions
mkdir sidpesaje-functions
cd sidpesaje-functions

# Initialize Firebase functions
firebase login
firebase init functions --project sidpesaje
```

During initialization:
- Choose **JavaScript** when asked about language
- Choose **Yes** when asked about ESLint
- Choose **Yes** when asked about installing dependencies

## Step 2: Install Dependencies

```bash
cd functions
npm install
```

## Step 3: Update `functions/src/index.js`

Replace the entire contents of `functions/src/index.js` with:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();

/**
 * Trigger: appointment/request status change
 * Sends push notification to assigned admin
 */
exports.sendAppointmentNotification = functions.firestore
  .document('requests/{docId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    // Only notify on status change
    if (!after.status || before.status === after.status) {
      return null;
    }

    // Only send for these status changes
    const notificationStatuses = ['approved', 'cancelled', 'rescheduled'];
    if (!notificationStatuses.includes(after.status)) {
      return null;
    }

    try {
      // Check if push notifications are enabled globally
      const settingsDoc = await db.doc('app_settings/communications').get();
      if (!settingsDoc.exists || !settingsDoc.data()?.pushNotificationsEnabled) {
        console.log('[FCM] Push notifications disabled in settings');
        return null;
      }

      // Get admin email (who should receive the notification)
      const adminId = after.adminId || after.assignedTo;
      if (!adminId) {
        console.log('[FCM] No admin assigned to appointment');
        return null;
      }

      // Get admin's FCM tokens
      const userDoc = await db.doc(`users/${adminId}`).get();
      const tokens = userDoc.data()?.fcmTokens || [];

      if (tokens.length === 0) {
        console.log(`[FCM] No tokens found for admin ${adminId}`);
        return null;
      }

      // Build notification message
      const statusLabels = {
        approved: '✓ Aprobada',
        cancelled: '✗ Cancelada',
        rescheduled: '→ Reagendada'
      };

      const notificationTitle = `Cita ${statusLabels[after.status] || after.status}`;
      const clientName = after.clientName || 'Cliente';
      const appointmentDate = after.date || after.fecha || 'Sin fecha';
      const notificationBody = `${clientName} - ${appointmentDate}`;

      const message = {
        notification: {
          title: notificationTitle,
          body: notificationBody
        },
        data: {
          appointmentId: context.params.docId,
          status: after.status,
          clientName: clientName,
          type: 'appointment',
          timestamp: Date.now().toString()
        },
        fcmOptions: {
          analyticsLabel: `appointment_${after.status}`
        }
      };

      // Send to all tokens
      const response = await messaging.sendEachForMulticast({
        tokens: tokens,
        notification: message.notification,
        data: message.data,
        fcmOptions: message.fcmOptions
      });

      console.log(`[FCM] Sent to ${response.successCount}/${tokens.length} devices`);

      // Clean up invalid tokens
      if (response.failureCount > 0) {
        const invalidTokens = [];

        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const error = resp.error;
            const errorCode = error?.code;

            // These error codes indicate invalid/unregistered tokens
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered' ||
              errorCode === 'messaging/mismatched-credential'
            ) {
              invalidTokens.push(tokens[idx]);
            }
          }
        });

        // Remove invalid tokens from Firestore
        if (invalidTokens.length > 0) {
          await db.doc(`users/${adminId}`).update({
            fcmTokens: admin.firestore.FieldValue.arrayRemove(...invalidTokens)
          });
          console.log(`[FCM] Removed ${invalidTokens.length} invalid tokens`);
        }
      }

      return { success: true, sent: response.successCount };
    } catch (error) {
      console.error('[FCM] Error sending notification:', error);
      throw error;
    }
  });

/**
 * HTTP Trigger: Send test notification (for admin testing)
 * Requires authentication via Firebase ID token
 */
exports.sendTestNotification = functions.https.onRequest(async (req, res) => {
  // Set CORS headers
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  try {
    if (!req.body.uid) {
      return res.status(400).json({ error: 'uid required in request body' });
    }

    // Get user's FCM tokens
    const userDoc = await db.doc(`users/${req.body.uid}`).get();
    const tokens = userDoc.data()?.fcmTokens || [];

    if (tokens.length === 0) {
      return res.status(400).json({
        error: 'No FCM tokens found',
        message: 'User has not enabled notifications or no tokens are registered'
      });
    }

    // Build test message
    const message = {
      notification: {
        title: '🧪 Notificación de Prueba',
        body: 'Si ves esto, tus notificaciones están funcionando correctamente.'
      },
      data: {
        type: 'test',
        timestamp: Date.now().toString()
      }
    };

    // Send to all tokens
    const response = await messaging.sendEachForMulticast({
      tokens: tokens,
      notification: message.notification,
      data: message.data
    });

    console.log(`[FCM Test] Sent to ${response.successCount}/${tokens.length} devices`);

    return res.json({
      success: response.successCount > 0,
      sent: response.successCount,
      failed: response.failureCount,
      message: `Sent to ${response.successCount} device(s)`
    });
  } catch (error) {
    console.error('[FCM Test]', error);
    return res.status(500).json({
      error: 'Failed to send test notification',
      message: error.message
    });
  }
});

/**
 * Scheduled Function: Clean up invalid/old FCM tokens (daily)
 * Removes tokens that haven't been used in 30 days
 */
exports.cleanupOldTokens = functions.pubsub
  .schedule('every day 03:00')
  .timeZone('America/Bogota')
  .onRun(async (context) => {
    try {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);

      // Get all users with tokens
      const usersSnapshot = await db
        .collection('users')
        .where('fcmTokens', '!=', [])
        .get();

      let cleaned = 0;

      for (const userDoc of usersSnapshot.docs) {
        const data = userDoc.data();
        const tokens = data.fcmTokens || [];
        const updatedAt = data.fcmTokensUpdatedAt?.toMillis() || Date.now();

        // Remove if tokens haven't been refreshed in 30 days
        if (updatedAt < thirtyDaysAgo && tokens.length > 0) {
          await userDoc.ref.update({
            fcmTokens: []
          });
          cleaned++;
          console.log(`[FCM Cleanup] Cleared old tokens for user ${userDoc.id}`);
        }
      }

      console.log(`[FCM Cleanup] Cleaned ${cleaned} users`);
      return null;
    } catch (error) {
      console.error('[FCM Cleanup]', error);
      throw error;
    }
  });
```

## Step 4: Deploy Functions

From the `functions` directory:

```bash
# Deploy all functions
npm run deploy

# Or deploy a specific function
firebase deploy --only functions:sendAppointmentNotification
```

## Step 5: Configure Firestore Security Rules

Update your Firestore rules to allow the Cloud Functions to update user documents:

```javascript
// In Firestore Console > Rules

rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow Cloud Functions to update user tokens
    match /users/{userId} {
      allow read: if request.auth.uid == userId;
      allow update: if request.auth.uid == userId || request.auth.uid == null;
      allow write: if request.auth.uid == userId;
    }

    // Allow app to read/write communication settings
    match /app_settings/{settingsId} {
      allow read: if request.auth.uid != null;
      allow write: if hasRole(request.auth.uid, 'admin');
    }

    // Appointment/request collection
    match /requests/{docId} {
      allow read: if request.auth.uid != null;
      allow write: if request.auth.uid != null;
    }

    // Helper function
    function hasRole(uid, role) {
      return get(/databases/$(database)/documents/users/$(uid))
        .data.role == role;
    }
  }
}
```

## Step 6: Test the Setup

1. **Sign in as admin** in your web app
2. **Enable push notifications** in Configuración > Notificaciones Push
3. **Send test notification**: Click "Enviar notificación de prueba"
4. **Check notifications**: You should receive a test notification

### Debug via Firebase Console:

```bash
# View Cloud Functions logs
firebase functions:log

# View specific function logs
firebase functions:log --only sendAppointmentNotification
```

## Troubleshooting

### "No tokens found" error
- Ensure admin has enabled push notifications and browser permission is granted
- Check that `users/{uid}/fcmTokens` array exists in Firestore
- Check browser console for any FCM errors

### "Invalid registration token" error
- Tokens may have expired (24+ hours, browser closed, etc.)
- Cloud Functions will automatically clean up invalid tokens
- User can disable and re-enable notifications to refresh

### Function deployment fails
```bash
# Check Firebase project setup
firebase projects:list

# Verify correct project is selected
firebase use sidpesaje

# Check Node.js version (must be 16+)
node --version
```

### Notifications not received
1. Check Firestore `app_settings/communications.pushNotificationsEnabled` is `true`
2. Verify user document has `fcmTokens` array with entries
3. Check browser console for FCM/service worker errors
4. Check Cloud Functions logs: `firebase functions:log`

## Environment Variables (Optional)

To add environment variables for sensitive data:

```bash
# Set environment variable
firebase functions:config:set vapid.private_key="YOUR_PRIVATE_KEY"

# Access in functions
const privateKey = functions.config().vapid?.private_key;
```

## Next Steps

1. ✅ Frontend FCM is implemented
2. ✅ Cloud Functions deployed
3. ✅ Test notifications working
4. → Monitor push notification stats
5. → Add notification analytics
6. → Consider scheduled notification cleanup

## Support Resources

- [Firebase Cloud Functions Docs](https://firebase.google.com/docs/functions)
- [Firebase Cloud Messaging Docs](https://firebase.google.com/docs/cloud-messaging)
- [Firestore Triggers](https://firebase.google.com/docs/functions/firestore-events)

---

**Status:** Cloud Functions ready for deployment
