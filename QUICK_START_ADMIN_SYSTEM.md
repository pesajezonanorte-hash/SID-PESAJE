# Dynamic Admin System - Quick Start (5 Minutes)

## Step 1: Update Firestore Rules (2 min)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select **sidpesaje** project
3. Go to **Firestore Database** → **Rules** tab
4. **Delete** all existing rules
5. **Copy/Paste** this entire rules block:

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    match /admins/{email} {
      allow read: if request.auth != null;
      allow create, update, delete: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    match /users/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow update: if request.auth != null && request.auth.uid == uid;
      allow read: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    match /requests/{requestId} {
      allow read: if 
        request.auth != null && 
        (
          request.auth.uid == resource.data.userId ||
          request.auth.uid == resource.data.adminId ||
          exists(/databases/$(database)/documents/admins/$(request.auth.token.email))
        );
      allow create: if request.auth != null;
      allow update: if 
        request.auth != null &&
        (
          request.auth.uid == resource.data.userId ||
          exists(/databases/$(database)/documents/admins/$(request.auth.token.email))
        );
      allow delete: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    match /eventos/{eventoId} {
      allow read: if 
        request.auth != null && 
        (
          request.auth.uid == resource.data.adminId ||
          exists(/databases/$(database)/documents/admins/$(request.auth.token.email))
        );
      allow create: if 
        request.auth != null &&
        request.auth.uid == request.resource.data.adminId;
      allow update, delete: if 
        request.auth != null && 
        request.auth.uid == resource.data.adminId;
    }

    match /technicians/{techId} {
      allow read: if request.auth != null;
      allow create, update, delete: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    match /settings/{settingId} {
      allow read, write: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    match /chats/{chatId}/messages/{messageId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null && request.auth.uid == request.resource.data.senderId;
    }
  }
}
```

6. Click **Publish** and wait for confirmation ✓

---

## Step 2: Initialize First Admin (1 min)

1. Open your app in browser
2. Press **F12** to open Developer Tools
3. Click **Console** tab
4. **Paste** this line (replace email):
   ```javascript
   ADMIN_BOOTSTRAP.init('pesaje.zonanorte@gmail.com')
   ```
5. Press **Enter**
6. Wait for: `✓ Bootstrap complete!`

---

## Step 3: Test (2 min)

1. **Log out** (if logged in)
2. **Log in** with your admin email
3. Go to **Configuración** (in sidebar)
4. Look for **"Administradores"** section
5. **Add** a test email (e.g., `test@example.com`)
6. Click **"Agregar administrador"**
7. See success message? ✓ **DONE!**

---

## Verify It Works

✓ Admin UI appears in Configuración
✓ Can add new admin emails
✓ Can remove admins
✓ New admins can log in and manage other admins

---

## If Something Goes Wrong

| Issue | Fix |
|-------|-----|
| "Admin not found" | Step 2 failed - run `ADMIN_BOOTSTRAP.init()` again |
| "Permission denied" | Firestore rules not published - check Step 1 |
| No "Administradores" section | Make sure you're logged in as admin |
| Can't add admins | Check Firestore rules in Firebase Console |

---

## What Happens Now

- Admins can be added/removed from **Configuración UI**
- No more code changes needed
- New admins auto-sync to Firestore
- Removed admins lose access on next login
- System is production-ready

---

## Next?

- See `ADMIN_SYSTEM_SETUP.md` for detailed guide
- See `IMPLEMENTATION_SUMMARY.md` for technical overview
- See `FIRESTORE_SECURITY_RULES.md` for rule explanations

**That's it! Your admin system is live.** 🎉
