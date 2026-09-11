# FCM Push Notifications — Quick Start (30 minutes)

Complete setup from zero to working push notifications in 3 steps.

## Step 1: Get VAPID Public Key (5 minutes)

```
1. Go to: https://console.firebase.google.com/
2. Project: sidpesaje
3. Settings (gear) → Cloud Messaging tab
4. Look for "Web Push Certificates" → Copy "Server API Key"
5. Open: js/fcm-service.js
6. Line ~20: Replace placeholder with your public key
   const VAPID_PUBLIC_KEY = 'YOUR_COPIED_KEY_HERE';
7. Save file
```

**Done!** Frontend is now configured.

---

## Step 2: Deploy Cloud Functions (15 minutes)

```bash
# Create functions directory
cd ~/Projects  # or anywhere
mkdir sidpesaje-functions
cd sidpesaje-functions

# Initialize Firebase Functions
firebase login
firebase init functions --project sidpesaje
  → JavaScript? Yes
  → ESLint? Yes
  → Install dependencies? Yes

# Go into functions folder
cd functions

# Replace functions/src/index.js with code from:
# → CLOUD_FUNCTIONS_SETUP.md (entire Step 4B)

# Also get your PRIVATE key from Firebase Console:
# Settings → Cloud Messaging → Web Push Certificates → Key pair details
firebase functions:config:set vapid.private_key="YOUR_PRIVATE_KEY_HERE"

# Deploy
npm run deploy
```

**Watch for success message:** `✔ functions: ... function deployed`

---

## Step 3: Test It Works (10 minutes)

```
1. Open your app in browser
2. Sign in as admin
3. Go to Configuración (settings)
4. Find section: "🔔 Notificaciones Push del Navegador"
5. Toggle: "Habilitar notificaciones push"
6. Browser will ask permission → Click "Allow"
7. Wait 2-3 seconds
8. Click button: "🧪 Enviar notificación de prueba"
9. Status should show: "✓ Notificación enviada"
10. Look for toast notification in bottom-right
```

**Success!** 🎉 Push notifications are working!

---

## Verify in Firestore

To confirm tokens saved:

```
1. Firebase Console → Firestore
2. Collection: users
3. Document: Your admin UID
4. Field: fcmTokens (should be array with one string)
5. Field: fcmTokensUpdatedAt (should be recent timestamp)
```

---

## Test Real Notifications

```
1. From Configuración, click test button again
2. The toast notification should appear
3. Now change an appointment status:
   - Find any appointment
   - Change status to "Approved"
   - Save
4. You should receive notification: "Cita ✓ Aprobada"
```

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Permission dialog won't show | Browser may have blocked notifications. Check browser privacy settings. |
| No toast appears | Check browser console (F12) for errors. |
| Token doesn't save | Check Firestore permissions. Should allow writes to `users/{uid}`. |
| Cloud Functions won't deploy | Ensure Firebase CLI is logged in: `firebase login` |
| Functions log shows errors | Check that private VAPID key is set: `firebase functions:config:get` |

**More help?** See FCM_TESTING_GUIDE.md

---

## What You Just Built

✅ Admins can enable push notifications  
✅ Browser requests permission (secure)  
✅ FCM tokens stored in Firestore (one per device)  
✅ When appointments change → instant notification  
✅ Works even when browser tab closed  
✅ Multiple devices supported  
✅ Invalid tokens auto-cleaned  
✅ Global on/off switch in settings  

---

## Keep Going?

- See **FCM_TESTING_GUIDE.md** for detailed testing
- See **FCM_IMPLEMENTATION_SUMMARY.md** for architecture
- See **FCM_VAPID_KEY_SETUP.md** for key management details
- See **CLOUD_FUNCTIONS_SETUP.md** for advanced Cloud Functions setup

---

**That's it! Push notifications are live!** 🚀
