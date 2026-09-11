# Firebase Cloud Messaging — VAPID Key Setup

To enable push notifications, you need a VAPID key pair. This guide explains how to generate and configure them.

## What is VAPID?

VAPID (Voluntary Application Server Identification) is a security feature that allows push services to verify that requests come from your application server. It consists of:
- **Public Key**: Shared with the client (browser), embedded in your app
- **Private Key**: Kept secret on your server, used in Cloud Functions

## Step 1: Get VAPID Keys from Firebase Console

### Option A: Generate in Firebase Console (Easiest)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **sidpesaje**
3. Navigate to **Project Settings** (gear icon)
4. Go to **Cloud Messaging** tab
5. Under **Web Push certificates** section, click **Generate Key Pair**
6. A key pair will be automatically generated
7. Copy the **Server API Key** (this is your public key)

### Option B: Use Firebase SDK to Generate

```bash
# Install firebase-tools
npm install -g firebase-tools

# Generate keys via CLI
firebase setup:web
```

## Step 2: Update Frontend Code

Place your **public VAPID key** in `js/fcm-service.js`:

```javascript
// Find this line (around line 7):
const VAPID_PUBLIC_KEY = 'BJqc7EQZLRy1UvLuQ_MpH5EZJkd0WT8QLkXwKkWQzNSKxJ5t1zl2MpFXBZBhZ1z3G-Z1E_-0z3SJ2xK5XqKzVHo';

// Replace with your actual public key from Firebase Console:
const VAPID_PUBLIC_KEY = 'YOUR_PUBLIC_KEY_HERE';
```

### How to find your public key in Firebase Console:

1. **Project Settings** → **Cloud Messaging** tab
2. Look for **Web Push certificates** section
3. You'll see your **Server API Key** listed
4. That Server API Key IS your VAPID public key
5. Copy the entire string (it's long, usually 150+ characters)

## Step 3: Configure Private Key in Cloud Functions

The **private key** is used in Cloud Functions to send notifications. You have two options:

### Option A: Environment Configuration (Recommended)

```bash
# Set the private key as an environment variable
firebase functions:config:set vapid.private_key="YOUR_PRIVATE_KEY_HERE"

# Or in .env.local
VAPID_PRIVATE_KEY="YOUR_PRIVATE_KEY_HERE"
```

Then in `functions/src/index.js`, use it:

```javascript
const privateKey = process.env.VAPID_PRIVATE_KEY || 
  functions.config().vapid?.private_key;
```

### Option B: Direct in firebase.json

Edit `firebase.json`:

```json
{
  "functions": {
    "source": "functions",
    "runtime": "node16",
    "environmentVariables": {
      "VAPID_PRIVATE_KEY": "YOUR_PRIVATE_KEY_HERE"
    }
  }
}
```

## Step 4: Where to Find Both Keys

In Firebase Console **Project Settings** → **Cloud Messaging** tab:

```
┌─────────────────────────────────────────────────┐
│ Web Push Certificates                           │
├─────────────────────────────────────────────────┤
│                                                 │
│ Server API Key: (THIS IS PUBLIC VAPID KEY)     │
│ BJqc7EQZLRy1UvLuQ_MpH5EZJkd0WT8Q...           │
│                                                 │
│ [Generate Key Pair]                             │
│ [Delete]                                        │
│                                                 │
├─────────────────────────────────────────────────┤
│ Key pair details (if expanded):                 │
│ - Server API Key (same as above)               │
│ - Private Key (for Cloud Functions)            │
│ - Auth Secret                                  │
└─────────────────────────────────────────────────┘
```

## Common Key Formats

Your public key typically looks like:
```
BJqc7EQZLRy1UvLuQ_MpH5EZJkd0WT8QLkXwKkWQzNSKxJ5t1zl2MpFXBZBhZ1z3G-Z1E_-0z3SJ2xK5XqKzVHo
```

Your private key typically looks like:
```
private key: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAAOCA....\n-----END PRIVATE KEY-----\n"
```

## Step 5: Verify Setup

Once you've placed the keys, test it:

1. **Admin enables push notifications**:
   - Log in as admin
   - Go to Configuración > Notificaciones Push
   - Enable "Habilitar notificaciones push"
   - Click "Enviar notificación de prueba"

2. **Expected result**:
   - You should see "✓ Notificación enviada" message
   - Check your browser for incoming notification

3. **Check logs**:
   ```bash
   firebase functions:log
   ```
   Should show something like:
   ```
   [FCM] Token obtained: BJqc7EQZLRy1UvLuQ_MpH5...
   [FCM] Token saved to Firestore
   [FCM Test] Sent to 1/1 devices
   ```

## Troubleshooting

### "Invalid VAPID key" error
- Check that public key is correctly copied
- Ensure no extra spaces or quotes
- Verify key is from Firebase Console Cloud Messaging tab
- Check `js/fcm-service.js` line 7

### "Unauthorized" error in Cloud Functions
- Private key may be missing or incorrect
- Check `firebase functions:config:get`
- Verify private key matches the public key pair
- Re-generate keys if uncertain

### Can't find keys in Firebase Console
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click your project: **sidpesaje**
3. Click gear icon → **Project Settings**
4. Scroll to **Cloud Messaging** tab
5. Look for **Web Push Certificates** section
6. If empty, click **Generate Key Pair**

## Security Notes

⚠️ **IMPORTANT:**
- **Public Key**: Safe to share, embed in frontend code
- **Private Key**: NEVER commit to Git, keep secret
- Use environment variables for private keys
- Rotate keys periodically (Firebase makes it easy)
- If compromised, delete key pair and generate new one

## After Setup

Once both keys are configured:

1. ✅ Admins can enable push notifications
2. ✅ Browsers will request notification permission
3. ✅ FCM tokens will be stored in Firestore
4. ✅ Cloud Functions will send notifications on appointment changes
5. ✅ Users will receive instant notifications

---

**Next Step:** Deploy Cloud Functions with the private key configured

See: [CLOUD_FUNCTIONS_SETUP.md](CLOUD_FUNCTIONS_SETUP.md)
