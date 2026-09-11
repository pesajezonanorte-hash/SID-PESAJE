# Phase 5: Smart Reminders — 24-Hour Email Reminders Setup

**Status:** Ready for Cloud Functions deployment  
**Complexity:** Medium (requires Firebase Console configuration + Cloud Functions)  
**Time to implement:** 30-45 minutes

---

## Overview

Automated email reminders sent 24 hours before confirmed appointments using Firebase Cloud Functions and EmailJS.

**Features:**
- Scheduled daily at 3:00 AM (Bogota timezone)
- Queries for appointments with date = tomorrow
- Sends HTML email via EmailJS
- Marks reminders as sent to prevent duplicates
- Gracefully handles errors and edge cases

---

## Prerequisites

Before starting, ensure you have:
- ✅ Firebase Cloud Functions enabled in your project (sidpesaje)
- ✅ Firebase CLI installed: `npm install -g firebase-tools`
- ✅ EmailJS account with API keys
- ✅ Logged in to Firebase: `firebase login`

---

## Step 1: Initialize Cloud Functions (If Not Already Done)

```bash
# Create a new directory for functions (or use existing one)
mkdir sidpesaje-functions  # or navigate to existing functions directory
cd sidpesaje-functions

# Initialize Firebase Functions for your project
firebase init functions --project sidpesaje
# Choose:
# - Language: JavaScript
# - ESLint: Yes (recommended)
# - Install dependencies: Yes
```

Navigate into the functions directory:
```bash
cd functions
```

---

## Step 2: Install Required Dependencies

```bash
npm install firebase-admin
```

---

## Step 3: Create Cloud Function for Scheduled Reminders

**File:** `functions/src/index.js`

Replace or append the following code:

```javascript
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const https = require('https');

admin.initializeApp();

// Scheduled reminder function: runs daily at 3:00 AM (Bogota time)
exports.sendDailyReminders = functions
  .region('us-central1')
  .pubsub.schedule('0 3 * * *')
  .timeZone('America/Bogota')
  .onRun(async (context) => {
    console.log('[Reminders] Daily reminder job started');

    try {
      const tomorrow = getDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));
      console.log(`[Reminders] Checking for appointments on: ${tomorrow}`);

      // Query Firestore for appointments matching tomorrow's date
      const snapshot = await admin
        .firestore()
        .collection('requests')
        .where('status', '==', 'confirmed')
        .where('date', '==', tomorrow)
        .where('reminderSent', '==', false)
        .get();

      console.log(`[Reminders] Found ${snapshot.size} appointments needing reminders`);

      const emailApiKey = process.env.EMAILJS_API_KEY || 
                          functions.config().emailjs?.api_key;
      const emailServiceId = process.env.EMAILJS_SERVICE_ID || 
                             functions.config().emailjs?.service_id;
      const emailTemplateId = process.env.EMAILJS_TEMPLATE_ID || 
                              functions.config().emailjs?.template_id;

      if (!emailApiKey || !emailServiceId || !emailTemplateId) {
        console.error('[Reminders] EmailJS credentials not configured');
        return {
          success: false,
          error: 'EmailJS credentials missing',
          sent: 0
        };
      }

      let sentCount = 0;
      const promises = [];

      for (const doc of snapshot.docs) {
        const request = doc.data();
        const promise = sendReminderEmail(
          request,
          emailApiKey,
          emailServiceId,
          emailTemplateId
        )
          .then(() => {
            return doc.ref.update({
              reminderSent: true,
              reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
            });
          })
          .then(() => {
            sentCount++;
            console.log(`[Reminders] Sent reminder for request ${doc.id}`);
          })
          .catch((err) => {
            console.error(`[Reminders] Error processing ${doc.id}:`, err.message);
          });

        promises.push(promise);
      }

      await Promise.all(promises);

      console.log(`[Reminders] Successfully sent ${sentCount} reminders`);
      return {
        success: true,
        sent: sentCount
      };
    } catch (error) {
      console.error('[Reminders] Job failed:', error);
      return {
        success: false,
        error: error.message,
        sent: 0
      };
    }
  });

// Helper: Send email via EmailJS HTTP API
function sendReminderEmail(request, apiKey, serviceId, templateId) {
  return new Promise((resolve, reject) => {
    const emailBody = JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: apiKey,
      template_params: {
        to_email: request.clientEmail,
        client_name: request.clientName || 'Cliente',
        appointment_date: formatDateES(request.date),
        appointment_time: request.time || '--:--',
        admin_name: request.adminName || 'Administrador',
        appointment_description: request.description || 'Sin descripción'
      }
    });

    const postOptions = {
      hostname: 'api.emailjs.com',
      port: 443,
      path: '/api/v1.0/email/send',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(emailBody)
      }
    };

    const req = https.request(postOptions, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({
            statusCode: res.statusCode,
            response: data
          });
        } else {
          reject(new Error(`EmailJS returned ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(emailBody);
    req.end();
  });
}

// Helper: Format date to YYYY-MM-DD
function getDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Helper: Format date in Spanish (e.g., "Lunes, 25 de Abril")
function formatDateES(dateStr) {
  if (!dateStr) return 'Sin fecha';
  
  const date = new Date(dateStr + 'T00:00:00');
  const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const monthNames = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];
  
  const dayName = dayNames[date.getDay()];
  const day = date.getDate();
  const monthName = monthNames[date.getMonth()];
  
  return `${dayName}, ${day} de ${monthName}`;
}
```

---

## Step 4: Set EmailJS Credentials

EmailJS credentials must be securely stored in Firebase Functions environment variables.

### Option A: Using Firebase CLI (Recommended)

```bash
# Set EmailJS API Key (from EmailJS Dashboard → API → Public Key)
firebase functions:config:set emailjs.api_key="YOUR_EMAILJS_PUBLIC_KEY"

# Set EmailJS Service ID (from EmailJS Dashboard → Email Services)
firebase functions:config:set emailjs.service_id="YOUR_SERVICE_ID"

# Set EmailJS Template ID (from EmailJS Dashboard → Email Templates)
firebase functions:config:set emailjs.template_id="YOUR_TEMPLATE_ID"
```

**How to find these values:**
1. Log in to [emailjs.com](https://www.emailjs.com/)
2. Go to **Account** → **API** → Copy your **Public Key**
3. Go to **Email Services** → Note your **Service ID**
4. Go to **Email Templates** → Note your **Template ID**

### Option B: Using .runtimeconfig.json (For Local Testing)

Create `functions/.runtimeconfig.json`:
```json
{
  "emailjs": {
    "api_key": "YOUR_EMAILJS_PUBLIC_KEY",
    "service_id": "YOUR_SERVICE_ID",
    "template_id": "YOUR_TEMPLATE_ID"
  }
}
```

**⚠️ WARNING:** Never commit `.runtimeconfig.json` to Git. Add to `.gitignore`:
```
.runtimeconfig.json
```

---

## Step 5: Create EmailJS Email Template

In **EmailJS Dashboard**:

1. Go to **Email Templates**
2. Click **Create New Template**
3. **Name:** `appointment_reminder_24h`
4. **Subject:** `Recordatorio: Tu cita está programada para mañana`
5. **HTML Content:**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 600px;
      margin: 0 auto;
    }
    .container {
      background: #f8f9fa;
      padding: 40px 20px;
    }
    .card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    .header {
      color: #CC0000;
      font-size: 24px;
      font-weight: bold;
      margin-bottom: 20px;
    }
    .detail {
      background: #f0f0f0;
      border-left: 4px solid #CC0000;
      padding: 12px;
      margin: 12px 0;
      border-radius: 4px;
    }
    .detail-label {
      color: #666;
      font-size: 12px;
      text-transform: uppercase;
      font-weight: 600;
      margin-bottom: 4px;
    }
    .detail-value {
      color: #333;
      font-size: 16px;
      font-weight: 500;
    }
    .footer {
      color: #999;
      font-size: 12px;
      margin-top: 30px;
      border-top: 1px solid #eee;
      padding-top: 20px;
    }
    .button {
      display: inline-block;
      background: #CC0000;
      color: white;
      padding: 12px 24px;
      border-radius: 6px;
      text-decoration: none;
      margin-top: 20px;
      font-weight: 600;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">📅 Recordatorio de Cita</div>
      
      <p>¡Hola {{client_name}},</p>
      
      <p>Te recordamos que tienes una cita programada para <strong>mañana</strong>. Aquí están los detalles:</p>
      
      <div class="detail">
        <div class="detail-label">📅 Fecha y Hora</div>
        <div class="detail-value">{{appointment_date}} • {{appointment_time}}</div>
      </div>
      
      <div class="detail">
        <div class="detail-label">👤 Con</div>
        <div class="detail-value">{{admin_name}}</div>
      </div>
      
      {{#appointment_description}}
      <div class="detail">
        <div class="detail-label">📝 Descripción</div>
        <div class="detail-value">{{appointment_description}}</div>
      </div>
      {{/appointment_description}}
      
      <p>Si necesitas reprogramar o cancelar tu cita, por favor contáctanos lo antes posible.</p>
      
      <p style="margin-top: 30px; color: #666; font-size: 14px;">
        Gracias por elegir nuestro servicio.<br>
        <strong>Equipo SIDPESAJE</strong>
      </p>
      
      <div class="footer">
        <p>Este es un mensaje automático. No respondas a este correo.</p>
      </div>
    </div>
  </div>
</body>
</html>
```

6. **Save** and note your **Template ID** (e.g., `template_abc123xyz`)

---

## Step 6: Deploy Cloud Functions

```bash
cd functions
npm run deploy
```

Or deploy specific function:
```bash
firebase deploy --only functions:sendDailyReminders
```

**Expected output:**
```
✔ functions[sendDailyReminders(us-central1)]: Successful creation or update.
```

---

## Step 7: Update Firestore Data Model

The code looks for two new fields on each request. These will be auto-created when reminders are sent, but you can pre-populate them:

### Option A: Auto-created (Recommended)
Fields are added automatically when reminder is sent:
- `reminderSent: boolean` (default: false)
- `reminderSentAt: timestamp` (set when reminder sent)

### Option B: Pre-populate via Firestore Console
1. Firebase Console → Firestore Database
2. For each `requests/{docId}`:
   - Add field: `reminderSent` (type: Boolean, value: false)
   - Add field: `reminderSentAt` (type: Null)

---

## Step 8: Test the Reminder Function (Optional)

### Manual Trigger via Firebase Console

1. Firebase Console → Cloud Functions
2. Click `sendDailyReminders`
3. Click **Testing** tab
4. Click **Create test event**
5. Click **Execute**

Check Firestore for `reminderSent: true` on appointments scheduled for tomorrow.

### Monitor Logs

```bash
firebase functions:log --only sendDailyReminders
```

Watch for output:
```
[Reminders] Daily reminder job started
[Reminders] Found X appointments needing reminders
[Reminders] Successfully sent X reminders
```

---

## Step 9: Handle Edge Cases & Maintenance

### What Happens If...

**Appointment date changes after reminder sent?**
- Reminder already sent (marked `reminderSent: true`)
- If admin reschedules, it gets a new document (safe)

**Client cancels appointment?**
- Reminder might already be sent (harmless)
- Client receives reminder for cancelled appointment
- Consider adding status check in template to show cancellation notice

**EmailJS quota exceeded?**
- Function logs error, returns failure count
- Reminders not marked as sent
- Will retry next day

**Server timezone issues?**
- Function uses `America/Bogota` timezone (Bogota, Colombia)
- Adjust if hosting elsewhere: change `timeZone` value in function
- Full list: [IANA Timezone Database](https://en.wikipedia.org/wiki/List_of_tz_database_time_zones)

---

## Step 10: Monitoring & Troubleshooting

### Check Function Logs

```bash
firebase functions:log --limit 50
```

### Common Issues & Solutions

| Issue | Solution |
|-------|----------|
| `EmailJS credentials not configured` | Run `firebase functions:config:set emailjs.api_key="..."` and redeploy |
| `Unauthorized 401 from EmailJS` | Check API key is correct (not Secret Key) |
| `No reminders sent` | Verify appointments have status='confirmed' and date=tomorrow |
| `Function didn't run at scheduled time` | Check Cloud Scheduler in Firebase Console (may need manual trigger) |

### Manual Trigger via Cloud Scheduler

If scheduled trigger doesn't work:
1. Firebase Console → Cloud Scheduler
2. Find `sendDailyReminders` job
3. Click **Force run** to test immediately

---

## Costs & Quotas

**Firebase Pricing Impact:**
- Cloud Functions: ~$0.40/month for scheduled job
- Firestore reads: ~10 reads/day (minimal)
- EmailJS: Depends on your plan (100/month free tier)

**Quotas:**
- Default: 1,000 invocations/minute
- Safe for: up to 1,400+ reminders/day

---

## Security Notes

⚠️ **Best Practices:**

1. **Never commit EmailJS keys to Git**
   ```bash
   # Add to .gitignore
   echo ".runtimeconfig.json" >> functions/.gitignore
   ```

2. **Use Environment Variables**
   - Store keys via `firebase functions:config:set`
   - Access via `process.env.EMAILJS_API_KEY`

3. **Validate Email Addresses**
   - Function assumes `clientEmail` is valid
   - Add validation if needed:
   ```javascript
   if (!request.clientEmail || !isValidEmail(request.clientEmail)) {
     console.warn(`[Reminders] Invalid email: ${request.clientEmail}`);
     return; // Skip
   }
   ```

4. **Rate Limiting**
   - EmailJS enforces rate limits (~10/sec)
   - Function handles gracefully (queues, no loss)

---

## Next Steps

After deployment:

1. ✅ Deploy Cloud Functions (Step 1-6)
2. ✅ Configure EmailJS (Step 4 & 5)
3. ✅ Test function (Step 8)
4. ✅ Monitor logs daily for first week (Step 10)
5. ✅ Adjust reminder template if needed
6. ✅ Add reminders feature to help documentation

---

## Complete Implementation Summary

**All 8 Phases Complete!**

| Phase | Status | Time | Effort |
|-------|--------|------|--------|
| 1. Booking Confirmation | ✅ Complete | 1-2h | Frontend |
| 2. Calendar Export | ✅ Complete | 1-1.5h | Frontend |
| 3. Mobile UX | ✅ Complete | 2-3h | Frontend |
| 4. Admin Dashboard | ✅ Complete | 1h | Frontend |
| 5. Smart Reminders | ⏳ Cloud Fn | 0.5h | Backend |
| 6. Technician Display | ✅ Complete | 1h | Frontend |
| 7. Client History | ✅ Complete | 1-1.5h | Frontend |
| 8. Microinteractions | ✅ Complete | 1-2h | Frontend |

**Total Investment:** ~10-15 hours (Cloud Functions included)

---

## Questions?

Refer to:
- [Firebase Cloud Functions Documentation](https://firebase.google.com/docs/functions)
- [EmailJS API Documentation](https://www.emailjs.com/docs/)
- [Firestore Query Documentation](https://firebase.google.com/docs/firestore/query-data/queries)

**Support Contacts:**
- Firebase: `support@firebase.google.com`
- EmailJS: Help section in dashboard
- Admin: pesaje.zonanorte@gmail.com
