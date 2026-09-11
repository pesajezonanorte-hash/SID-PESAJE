# Firebase Cloud Messaging — Testing Guide

Complete end-to-end testing checklist for push notification functionality.

## Prerequisites

- ✅ VAPID public key configured in `js/fcm-service.js` (see FCM_VAPID_KEY_SETUP.md)
- ✅ Cloud Functions deployed with private key set (see CLOUD_FUNCTIONS_SETUP.md)
- ✅ `app_settings/communications.pushNotificationsEnabled = true` in Firestore
- ✅ Service worker registered at `/firebase-messaging-sw.js`

## Phase 1: Frontend Setup Test (5 minutes)

### Test 1.1: Service Worker Registration

**Steps:**
1. Open browser DevTools (F12)
2. Go to **Application** tab → **Service Workers**
3. Sign in as admin
4. Navigate to **Configuración**
5. Check that `/firebase-messaging-sw.js` appears in the Service Workers list

**Expected Result:**
- ✅ Service worker shows as "activated and running"
- ✅ Scope is `/` or your domain
- ✅ No errors in console

**If Failed:**
- Check browser console for errors
- Verify `/firebase-messaging-sw.js` exists at project root
- Check browser supports service workers (most modern browsers do)

---

### Test 1.2: Permission Request

**Steps:**
1. In **Configuración** page, find **Notificaciones Push** section
2. Click the toggle: "Habilitar notificaciones push"
3. Browser should prompt: "Allow [domain] to show notifications?"

**Expected Result:**
- ✅ Browser notification permission dialog appears
- ✅ You can click "Allow" or "Block"

**If Failed:**
- Check browser notification settings (may be pre-blocked)
- Try in a different browser
- Check browser console for FCM initialization errors

---

### Test 1.3: Token Registration

**Steps:**
1. Click "Allow" on the permission dialog
2. Wait 2-3 seconds
3. Open browser DevTools → **Application** → **Local Storage**
4. Search for key starting with: `notif-tutorial-` (this is tutorial state, not FCM)
5. Open DevTools → **Application** → **IndexedDB** (if using Firebase)

**Or check directly in Firestore:**
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project: **sidpesaje**
3. Go to **Firestore Database**
4. Navigate to: `users/{your-uid}`
5. Look for `fcmTokens` array field

**Expected Result:**
- ✅ `fcmTokens` array appears in user document
- ✅ Array contains at least one token (150+ character string)
- ✅ `fcmTokensUpdatedAt` timestamp field is recent

**If Failed:**
- Check browser console for FCM errors
- Verify Firestore security rules allow writes to `users/{uid}`
- Check `js/fcm-service.js` for import errors
- Verify Firebase config in `js/firebase-config.js` is correct

---

## Phase 2: Test Notifications (Browser)

### Test 2.1: In-App Toast Notification

**Steps:**
1. In **Notificaciones Push** section, click button: "Enviar notificación de prueba"
2. Keep browser focused (foreground)
3. Wait 2-3 seconds

**Expected Result:**
- ✅ A toast notification appears in bottom-right corner
- ✅ Toast shows title: "Notificación de Prueba"
- ✅ Toast shows body text about notifications working
- ✅ Toast disappears after ~6 seconds or on click
- ✅ Status message shows: "✓ Notificación enviada"

**If Failed:**
- Check browser console for JavaScript errors
- Verify Cloud Functions endpoint is reachable: `/api/send-test-notification`
- Check Network tab to see if request succeeded (200 status)
- Verify user has `fcmTokens` in Firestore

---

### Test 2.2: Background Notification (Browser Not Focused)

**Steps:**
1. With push notifications enabled, switch away from browser
2. Go to another application or desktop
3. Open browser DevTools in separate window
4. In the separate DevTools, go to **Console** tab
5. Navigate back to the tab (keep DevTools open to watch logs)
6. Click "Enviar notificación de prueba"

**Expected Result:**
- ✅ Operating system notification appears (top-right on Windows, top on Mac)
- ✅ Notification shows: "🧪 Notificación de Prueba"
- ✅ Browser console shows: `[Firebase Messaging] Background message received`

**If Failed:**
- Check system notification settings (may be disabled)
- Check browser notification permission (should be "Allow")
- Verify service worker received the message (check in DevTools)

---

### Test 2.3: Notification Click Navigation

**Steps:**
1. Receive a background notification (Test 2.2)
2. Click the notification
3. Observe what happens

**Expected Result:**
- ✅ Notification disappears
- ✅ Browser window/tab comes to focus
- ✅ If a specific `appointmentId` was in the data, should navigate there

**If Failed:**
- Notification click may not work if browser not fully updated
- Check service worker code in `/firebase-messaging-sw.js`
- Verify notification has `appointmentId` in data field

---

## Phase 3: Real Appointment Status Changes

### Test 3.1: Appointment Approved

**Steps:**
1. With admin logged in and push enabled:
2. Create a test appointment (or find pending one)
3. Change status to "Approved"
4. Save changes

**Expected Result:**
- ✅ Cloud Function triggers (check Firebase logs)
- ✅ If browser in foreground: toast notification appears
- ✅ If browser in background: system notification appears
- ✅ Notification shows client name and date

**Check Cloud Functions Logs:**
```bash
firebase functions:log
```

Should show:
```
[FCM] Sent to 1/1 devices
```

**If Failed:**
- Check `app_settings/communications.pushNotificationsEnabled` is `true`
- Verify user has tokens in `fcmTokens` array
- Check Cloud Functions logs for errors
- Ensure Cloud Functions has private VAPID key set

---

### Test 3.2: Appointment Cancelled

**Steps:**
1. Find an appointment with "Approved" status
2. Change to "Cancelled"
3. Save

**Expected Result:**
- ✅ Notification received: "Cita ✗ Cancelada"
- ✅ Shows client name and date

---

### Test 3.3: Appointment Rescheduled

**Steps:**
1. Find an appointment
2. Change status to "Rescheduled" (if available) or reschedule the date/time
3. Save

**Expected Result:**
- ✅ Notification received: "Cita → Reagendada"

---

## Phase 4: Multiple Devices Test

### Test 4.1: Token Refresh on New Login

**Steps:**
1. Open browser in **private/incognito mode**
2. Sign in as same admin user
3. Enable push notifications
4. Check Firestore for `users/{uid}/fcmTokens`

**Expected Result:**
- ✅ `fcmTokens` array now has 2 entries (one from each browser/tab)
- ✅ `fcmTokensUpdatedAt` is recent
- ✅ Test notification can be sent to either token

---

### Test 4.2: Invalid Token Cleanup

**Steps:**
1. Get one of the FCM tokens from Firestore
2. Delete it manually from the array
3. Leave just a fake invalid token: `"invalid-token-12345"`
4. Click "Enviar notificación de prueba"

**Expected Result:**
- ✅ Cloud Functions attempts to send
- ✅ Invalid token causes failure
- ✅ Cloud Functions detects error and removes invalid token
- ✅ Next test notification works (if valid token exists)

**Check logs:**
```
[FCM] Removed 1 invalid tokens
```

---

## Phase 5: Error Scenarios

### Test 5.1: Push Disabled Globally

**Steps:**
1. In Firestore Console:
   - Go to `app_settings` → `communications`
   - Set `pushNotificationsEnabled: false`
   - Save

2. Create/update an appointment
3. Change status to "approved"

**Expected Result:**
- ✅ No notification is sent
- ✅ Cloud Functions logs show: `[FCM] Push notifications disabled`

---

### Test 5.2: No Tokens Registered

**Steps:**
1. Open DevTools → Application → Firestore
2. Find `users/{uid}` document
3. Delete the `fcmTokens` array field
4. Try test notification

**Expected Result:**
- ✅ Status shows: "✗ No tokens found"
- ✅ Cloud Functions logs: `[FCM] No tokens found`

---

### Test 5.3: Browser Notification Permission Denied

**Steps:**
1. In browser settings, find notification permissions
2. Set notification permission for your domain to "Block"
3. Try to enable push notifications

**Expected Result:**
- ✅ Checkbox remains unchecked
- ✅ Status shows: "✗ Permiso denegado"
- ✅ No tokens are created

---

## Phase 6: Mobile Testing (if applicable)

### Test 6.1: PWA Installation

**Steps:**
1. Open app on mobile browser
2. Look for "Install" prompt (top-right)
3. Install as PWA (app on home screen)
4. Enable push notifications
5. Exit app completely
6. Have another user trigger appointment change

**Expected Result:**
- ✅ App-style notification appears even though app isn't open
- ✅ Clicking notification opens app and shows appointment

---

## Debugging Checklist

If tests fail, work through this checklist:

### Service Worker Issues
- [ ] `/firebase-messaging-sw.js` exists and loads without 404
- [ ] Service worker registered in DevTools
- [ ] Check browser console for service worker errors
- [ ] Try re-registering: Hard refresh (Ctrl+Shift+R / Cmd+Shift+R)

### Token Issues
- [ ] Permission is "Allow" in browser settings
- [ ] `fcmTokens` array exists in Firestore
- [ ] Token is not empty string
- [ ] VAPID public key is correct in `js/fcm-service.js`

### Cloud Functions Issues
- [ ] Cloud Functions deployed: `firebase deploy --only functions`
- [ ] Private VAPID key is set: `firebase functions:config:get`
- [ ] Check logs: `firebase functions:log`
- [ ] Firestore rules allow reads/writes to `users/{uid}`

### Foreground Message Issues
- [ ] `onMessage` listener set up in `fcm-service.js`
- [ ] Check console for `[FCM] Foreground message received`
- [ ] Verify CSS for toast notification loads

### Background Message Issues
- [ ] Service worker's `onBackgroundMessage` handler in place
- [ ] Notification title/body not null or empty
- [ ] System notification settings allow notifications
- [ ] Try different browsers (some have restrictions)

---

## Console Log Key Messages

Look for these in browser console:

**Good signs:**
```
[FCM] Service worker registered:
[FCM] Token obtained: BJqc7EQZLRy1U...
[FCM] Token saved to Firestore
[FCM] Foreground message received:
[Firebase Messaging] Background message received:
```

**Problem signs:**
```
[FCM] Browser does not support notifications
[FCM] Permission denied by user
[FCM] Service Worker not supported
[FCM] Error requesting permission:
[FCM] Error saving token to Firestore:
```

---

## Test Report Template

```
Date: _______________
Tester: _______________
Browser: _______________
OS: _______________

Phase 1: Frontend Setup
  [ ] 1.1 Service Worker Registered
  [ ] 1.2 Permission Request Works
  [ ] 1.3 Token Registered in Firestore

Phase 2: Test Notifications
  [ ] 2.1 In-App Toast Shows
  [ ] 2.2 Background Notification Shows
  [ ] 2.3 Notification Click Navigation Works

Phase 3: Real Appointments
  [ ] 3.1 Approved Notification Sent
  [ ] 3.2 Cancelled Notification Sent
  [ ] 3.3 Rescheduled Notification Sent

Phase 4: Multiple Devices
  [ ] 4.1 Token Refresh Works
  [ ] 4.2 Invalid Token Cleanup Works

Phase 5: Error Scenarios
  [ ] 5.1 Disabled Push Respected
  [ ] 5.2 No Tokens Handled
  [ ] 5.3 Permission Denied Handled

Issues Found:
_________________________________________
_________________________________________

Overall Status: [ ] PASS [ ] FAIL

Notes:
_________________________________________
_________________________________________
```

---

## Success Criteria

All of the following must pass:

✅ Service worker registers without errors  
✅ FCM tokens saved to Firestore  
✅ Toast notifications appear in-app  
✅ Browser notifications appear in background  
✅ Clicking notification works  
✅ Cloud Functions triggers on status change  
✅ Real appointment changes send notifications  
✅ Multiple tokens work  
✅ Invalid tokens cleaned up  
✅ Error scenarios handled gracefully  

---

**When all tests pass: FCM implementation is production-ready!**
