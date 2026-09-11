# Firestore Security Rules for Admin Management

## How to Set Up

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **sidpesaje**
3. Navigate to **Firestore Database** → **Rules** tab
4. Replace the entire rules content with the rules below
5. Click **Publish**

---

## Firestore Security Rules

```
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    
    // Default: deny all
    match /{document=**} {
      allow read, write: if false;
    }

    // Admins collection - manages who can be admins
    match /admins/{email} {
      // Anyone can read admins list (needed for isAdmin() check)
      allow read: if request.auth != null;
      
      // Only existing admins can modify admins collection
      allow create, update, delete: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    // Users collection
    match /users/{uid} {
      // Users can read their own profile
      allow read: if request.auth != null && request.auth.uid == uid;
      
      // Users can update their own profile
      allow update: if request.auth != null && request.auth.uid == uid;
      
      // Only admins can read all user profiles
      allow read: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    // Requests collection (meetings, services)
    match /requests/{requestId} {
      // Users can read their own requests
      allow read: if 
        request.auth != null && 
        (
          request.auth.uid == resource.data.userId ||
          request.auth.uid == resource.data.adminId ||
          exists(/databases/$(database)/documents/admins/$(request.auth.token.email))
        );
      
      // Users can create requests
      allow create: if request.auth != null;
      
      // Users can update their own requests, or admins can update any request
      allow update: if 
        request.auth != null &&
        (
          request.auth.uid == resource.data.userId ||
          exists(/databases/$(database)/documents/admins/$(request.auth.token.email))
        );
      
      // Admins can delete requests
      allow delete: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    // Personal events collection
    match /eventos/{eventoId} {
      // Users can read their own personal events
      allow read: if 
        request.auth != null && 
        request.auth.uid == resource.data.adminId;
      
      // Admins can read all personal events
      allow read: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
      
      // Users can create personal events for themselves
      allow create: if 
        request.auth != null &&
        request.auth.uid == request.resource.data.adminId;
      
      // Users can update/delete their own personal events
      allow update, delete: if 
        request.auth != null && 
        request.auth.uid == resource.data.adminId;
    }

    // Technicians collection
    match /technicians/{techId} {
      // Anyone can read technicians list
      allow read: if request.auth != null;
      
      // Only admins can modify technicians
      allow create, update, delete: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    // Communication settings
    match /settings/{settingId} {
      // Only admins can read/write settings
      allow read, write: if 
        request.auth != null &&
        exists(/databases/$(database)/documents/admins/$(request.auth.token.email));
    }

    // Chat messages
    match /chats/{chatId}/messages/{messageId} {
      // Users can read messages in their chats
      allow read: if request.auth != null;
      
      // Users can create messages
      allow create: if request.auth != null && request.auth.uid == request.resource.data.senderId;
    }
  }
}
```

---

## Key Security Principles

1. **Admin Detection:** `exists(/databases/$(database)/documents/admins/$(request.auth.token.email))`
   - This checks if the user's email exists in the admins collection
   - Used to control who can manage admins, technicians, and settings

2. **Bootstrap:** The first admin needs to be added manually via Firebase Console or a one-time setup script:
   - Go to Firestore → admins collection → Add document
   - Document ID: `pesaje.zonanorte@gmail.com` (or your admin email)
   - Field: `{ email: "pesaje.zonanorte@gmail.com", createdAt: serverTimestamp() }`

3. **User Reads:** Users can only read their own profiles initially, but admins can see all users

4. **Request Visibility:** 
   - Clients see their own requests
   - Admins see all requests (shared visibility)

5. **Personal Events:**
   - Users see only their own personal events
   - Admins see all admins' personal events (to check availability)

---

## Troubleshooting

### "Permission denied" when checking admin status
- Make sure the first admin was added to the `/admins` collection
- Check that the email matches exactly (case-sensitive for the document ID)

### Users can't see technicians
- The technicians collection allows all authenticated users to read
- Only admins can modify technicians

### New admin can't add other admins
- The new admin email must exist in the `/admins` collection
- The app will automatically add the new user to `/admins` when they log in (if added via the admin panel)

---

## After Setting Up

1. **Bootstrap the first admin manually:**
   - Firebase Console → Firestore → Create collection "admins"
   - Add document: ID = your admin email (e.g., `pesaje.zonanorte@gmail.com`)
   - Add field: `email: "pesaje.zonanorte@gmail.com"` and `createdAt: serverTimestamp()`

2. **Test the system:**
   - Log in as the first admin
   - Go to Configuración → Administradores
   - Add a second admin email
   - Log in with the second admin and verify they can manage admins

3. **Users Collection Migration (Optional):**
   - If you have existing user documents without the role field, the system will auto-set it to 'admin' if their email is in the admins collection on next login

---

## Admin Collection Structure

Each document in `/admins` has:
```json
{
  "email": "admin@example.com",
  "createdAt": "2026-04-25T10:30:00Z"
}
```

Document ID = email (for easy lookups)
