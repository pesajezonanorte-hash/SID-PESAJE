# Dynamic Admin Management System - Setup Guide

## Overview

The hardcoded `ADMIN_EMAILS` array has been replaced with a scalable Firestore-based admin management system. Admins can now be added and removed dynamically from the Configuración panel without redeploying the app.

---

## What Changed

### Code Changes
- ✅ **New file:** `js/admin-service.js` - Firestore admin queries and cache management
- ✅ **New file:** `js/admin-bootstrap.js` - One-time setup script for the first admin
- ✅ **Updated:** `js/client-panel.js` - Imports admin-service, removed hardcoded ADMIN_EMAILS
- ✅ **Updated:** `index.html` - Added admin-bootstrap import
- ✅ **New file:** `FIRESTORE_SECURITY_RULES.md` - Security rules to protect the admins collection

### Architecture
```
User Login
    ↓
Check: isAdmin(user.email)
    ↓
    └→ Query Firestore /admins/{email}
        └→ Return true/false (with 5-min cache)
    ↓
Set fallbackRole = 'admin' | 'cliente'
    ↓
ensureUserProfile(user, fallbackRole)
    ↓
Update /users/{uid}.role in Firestore
```

---

## Step 1: Set Up Firestore Security Rules

### Go to Firebase Console

1. Open [Firebase Console](https://console.firebase.google.com/)
2. Select project: **sidpesaje**
3. Navigate to **Firestore Database** → **Rules** tab

### Copy New Rules

Copy the entire rules from `FIRESTORE_SECURITY_RULES.md` and paste into the Rules editor.

**Key security checks:**
- Only authenticated users can access the admins collection
- Anyone can read the admins list (needed for `isAdmin()` checks)
- Only existing admins can add/remove other admins
- Users can only read their own profiles (admins can see all)

### Publish Rules

Click **Publish** and wait for confirmation.

---

## Step 2: Initialize the First Admin

You have two options:

### Option A: Browser Console (Recommended)

1. Open the app in your browser
2. Press **F12** (or **Cmd+Option+I** on Mac) to open Developer Tools
3. Click the **Console** tab
4. Paste this command (replace with your actual admin email):
   ```javascript
   ADMIN_BOOTSTRAP.init('pesaje.zonanorte@gmail.com')
   ```
5. Press **Enter**
6. Wait for the success message: `✓ Bootstrap complete!`

### Option B: Firebase Console

1. Go to **Firebase Console** → **Firestore** → **Collections**
2. Click **+ Start collection**
3. Create collection named: `admins`
4. Click **Auto ID** to generate document ID (or enter email as ID)
5. Add these fields:
   ```
   email:     pesaje.zonanorte@gmail.com
   createdAt: (server timestamp - auto-filled)
   ```
6. Save

---

## Step 3: Test the System

### Test Admin Login

1. Log out (if currently logged in)
2. Log in with the admin email (e.g., `pesaje.zonanorte@gmail.com`)
3. You should see the **Admin Dashboard**
4. Navigate to **Configuración** in the sidebar
5. You should see the new **"Administradores"** section

### Add a Second Admin

1. In the **Administradores** section, enter a new admin email
2. Click **"Agregar administrador"**
3. You should see a success message
4. The new admin appears in the list below

### Verify the New Admin Works

1. Open a new incognito/private window
2. Log in with the new admin email
3. Navigate to **Configuración** → **Administradores**
4. Verify they can also add/remove admins
5. **Success!** ✓

---

## Using the Admin Management UI

### Adding an Admin

1. Go to **Configuración** → **Administradores**
2. Enter the email of the new admin in the input field
3. Click **"Agregar administrador"**
4. The system will:
   - Validate the email format
   - Check if already an admin (prevent duplicates)
   - Add to Firestore `/admins` collection
   - Show success/error feedback

### Removing an Admin

1. In the **Administradores** list, find the admin to remove
2. Click the red **"Eliminar"** button next to their email
3. Confirm the deletion
4. The admin is removed from Firestore
5. They will be demoted to "cliente" on next login

### Notes on Admin Removal

- Removing an admin is **permanent** (requires re-approval via Firestore Console)
- Removed admins lose access to:
  - Admin Dashboard
  - Configuración panel
  - Calendar management
  - Request management
- Their existing requests remain in the system but become read-only

---

## Firestore Collection Structure

### `/admins` Collection

Each document represents one admin:

```json
{
  "email": "admin@example.com",  ← Used as Document ID
  "createdAt": "2026-04-25T10:30:00Z"
}
```

**Query Examples:**
```javascript
// Check if an email is an admin
const adminSnap = await getDocs(
  query(collection(db, 'admins'), where('email', '==', email))
);
const isAdmin = !adminSnap.empty;
```

---

## How It Works

### 1. Admin Detection (isAdmin function)

```javascript
export async function isAdmin(email) {
    // Check cache first (5-minute TTL)
    const cached = ADMIN_CACHE.get(email);
    if (cached && !isExpired(cached)) return cached.value;
    
    // Query Firestore
    const adminDoc = await getAdminByEmail(email);
    const result = !!adminDoc;
    
    // Cache the result
    ADMIN_CACHE.set(email, { value: result, timestamp: Date.now() });
    return result;
}
```

**Performance:**
- First query: Firestore read
- Subsequent calls (within 5 min): Memory cache
- After 5 min: Firestore read again

### 2. Login Flow

```javascript
// In doLogin():
const result = await signInWithPopup(auth, googleProvider);

// Check Firestore for admin status
const fallbackRole = (await isAdmin(result.user.email)) ? 'admin' : 'cliente';

// Create/update user profile with role
await ensureUserProfile(result.user, fallbackRole);

// Get authoritative role from Firestore
const realRole = (await resolveUserRole(result.user)) === 'admin' ? 'admin' : 'cliente';

// Show appropriate dashboard
if (realRole === 'admin') {
    renderAdminDashboard();
} else {
    renderClientDashboard();
}
```

### 3. Adding an Admin

```javascript
// In admin UI:
const email = 'newadmin@example.com';

// Validate email format
if (!email.includes('@')) throw new Error('Email inválido');

// Check if already exists
const existing = await getAdminByEmail(email);
if (existing) throw new Error('Este administrador ya existe');

// Add to Firestore
await setDoc(doc(db, 'admins', email), {
    email,
    createdAt: serverTimestamp()
});

// Clear cache for this email
ADMIN_CACHE.delete(email);

// Show feedback and refresh UI
alert('Administrador agregado exitosamente');
```

---

## Security Model

### Cache Invalidation

When an admin is added or removed, the in-memory cache for that email is cleared. The next `isAdmin()` check will query Firestore fresh.

### Firestore Rules

```
match /admins/{email} {
  // Anyone can read (for isAdmin checks)
  allow read: if request.auth != null;
  
  // Only existing admins can modify
  allow create, update, delete: if 
    request.auth != null &&
    exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
}
```

**This means:**
- ✅ New admins can add other admins
- ❌ Non-admins cannot modify the admins collection
- ✅ Firestore enforces this at the database level (not just client-side)

---

## Troubleshooting

### "Admin not found" errors when logging in

**Cause:** The admins collection doesn't exist or the first admin wasn't added.

**Fix:**
1. Go to Firebase Console → Firestore
2. Create the `admins` collection
3. Add your email as a document
4. Try logging in again

### "Permission denied" when trying to add admins

**Cause:** 
1. Firestore Rules haven't been published
2. Your email isn't in the admins collection yet
3. Rules don't match the provided config

**Fix:**
1. Verify rules were published: Firebase Console → Firestore → Rules
2. Check that your email exists in `/admins` collection
3. Copy/paste the rules exactly from `FIRESTORE_SECURITY_RULES.md`

### Admin list shows but can't add new admins

**Cause:** You might not be in the admins collection yet (edge case).

**Fix:**
1. Log out completely
2. Clear browser cache (Ctrl+Shift+Delete)
3. Log in again
4. Try adding an admin

### Cache not clearing

**Cause:** The cache has a 5-minute TTL. A newly added admin might not be immediately available.

**Fix:**
1. Hard refresh the page (Ctrl+Shift+R)
2. Or wait 5 minutes
3. Or open Developer Tools → Application → Clear cache for that email

---

## Migration from Hardcoded System

If you had users created under the old system:

**Old way:** `ADMIN_EMAILS` hardcoded in code
**New way:** `admins` collection in Firestore

### What happens to existing users?

1. ✅ Existing admin users still have `role: 'admin'` in their `/users/{uid}` profile
2. ✅ They can log in and will use the Firestore-based system
3. ✅ To keep them as admins, add their email to the `/admins` collection
4. ⚠️ If removed from `/admins`, they'll be demoted on next login

### Migration checklist:

- [ ] Set up Firestore security rules
- [ ] Initialize first admin via `ADMIN_BOOTSTRAP.init()`
- [ ] Test admin login
- [ ] Add other admins via Configuración UI
- [ ] Remove users from old `ADMIN_EMAILS` from code
- [ ] (Optional) Keep backup of old ADMIN_EMAILS somewhere for reference

---

## Files Modified

| File | Changes | Purpose |
|------|---------|---------|
| `js/admin-service.js` | **New** | Firestore admin queries + caching |
| `js/admin-bootstrap.js` | **New** | One-time setup helper script |
| `js/client-panel.js` | Import admin-service, removed ADMIN_EMAILS | Use dynamic admin detection |
| `index.html` | Added admin-bootstrap import | Load bootstrap script |
| `FIRESTORE_SECURITY_RULES.md` | **New** | Security rules to protect admins collection |

---

## API Reference

### admin-service.js

```javascript
// Check if email is admin
await isAdmin(email: string): boolean

// Add a new admin
await addAdmin(email: string): Object

// Remove an admin
await removeAdmin(email: string): boolean

// Get all admins
await getAllAdmins(): Array<{email, createdAt}>

// Clear in-memory cache
clearAdminCache(): void
```

### admin-bootstrap.js

```javascript
// Initialize first admin (run in browser console)
ADMIN_BOOTSTRAP.init(email: string)

// Show setup instructions
ADMIN_BOOTSTRAP.instructions()
```

---

## Next Steps

1. ✅ Set up Firestore rules (5 minutes)
2. ✅ Initialize first admin (2 minutes)
3. ✅ Test admin login (5 minutes)
4. ✅ Add other admins (1 minute each)
5. ✅ Monitor security logs in Firebase Console

**Total setup time: ~15 minutes**

---

## Support

For issues or questions:
1. Check the **Troubleshooting** section above
2. Review Firestore rules in Firebase Console
3. Check browser console (F12) for error messages
4. Verify admin email is in `/admins` collection

---

## Production Checklist

- [ ] Firestore rules published and tested
- [ ] First admin initialized
- [ ] At least 2 admins for redundancy
- [ ] Tested admin add/remove workflow
- [ ] Verified non-admin users cannot modify admins
- [ ] Removed old ADMIN_EMAILS references from codebase
- [ ] Documented admin emails with team members
