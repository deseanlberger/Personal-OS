# Google OAuth setup — Calendar push + Gmail receipt scanner

Both features need the same Google Cloud OAuth client, just different refresh tokens (one per scope). This is a **one-time** ~15 min setup on your Mac.

## What you'll get when done
- **Calendar push** — your weekly blocks + assigned tasks push to Google Calendar so phone notifications work
- **Gmail scanner** — daily cron searches your inbox for receipt-shaped emails and drops them in `/finance` Pending Review

---

## Step 1 — Create a Google Cloud project

1. Open https://console.cloud.google.com/projectcreate
2. Project name: `Personal OS` (or whatever)
3. Click **Create**, wait ~10 sec, then make sure it's selected in the project picker at the top

## Step 2 — Enable both APIs

1. https://console.cloud.google.com/apis/library
2. Search "Google Calendar API" → click → **Enable**
3. Back to library, search "Gmail API" → click → **Enable**

## Step 3 — Configure the OAuth consent screen

1. https://console.cloud.google.com/apis/credentials/consent
2. User Type: **External** → **Create**
3. App name: `Personal OS`
4. User support email: your gmail
5. Developer contact: your gmail
6. **Save and continue** through scopes (skip), test users (add your gmail), summary → **Back to dashboard**

## Step 4 — Create the OAuth client

1. https://console.cloud.google.com/apis/credentials
2. **+ Create Credentials** → **OAuth client ID**
3. Application type: **Desktop app**
4. Name: `Personal OS CLI`
5. **Create** → **Download JSON** → save to your Mac

## Step 5 — Generate the refresh tokens

The fastest way is the OAuth 2.0 Playground. Two refresh tokens needed — one for Calendar, one for Gmail.

### Calendar refresh token

1. Open https://developers.google.com/oauthplayground/
2. Top-right gear icon → check **Use your own OAuth credentials**
3. Paste your **Client ID** and **Client Secret** from the JSON file
4. **Close**
5. Step 1: in the scopes box paste: `https://www.googleapis.com/auth/calendar`
6. **Authorize APIs** → choose your gmail → **Continue** through the "Google hasn't verified" warning (Advanced → Go to Personal OS)
7. Step 2: **Exchange authorization code for tokens**
8. Copy the **Refresh token** value — this is your `GOOGLE_REFRESH_TOKEN`

### Gmail refresh token

Same site, same OAuth credentials still loaded.

1. Step 1: clear the scopes box, paste: `https://www.googleapis.com/auth/gmail.readonly`
2. **Authorize APIs** → re-auth your gmail
3. Step 2: **Exchange authorization code for tokens**
4. Copy the **Refresh token** — this is your `GOOGLE_GMAIL_REFRESH_TOKEN`

## Step 6 — Add to Vercel

1. https://vercel.com/deseanlberger-4994s-projects/personal-os/settings/environment-variables
2. Add four vars (all three environments: Production, Preview, Development):

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from your OAuth client JSON |
| `GOOGLE_CLIENT_SECRET` | from your OAuth client JSON |
| `GOOGLE_REFRESH_TOKEN` | Calendar refresh token from Step 5 |
| `GOOGLE_GMAIL_REFRESH_TOKEN` | Gmail refresh token from Step 5 |

3. Hit **Save**
4. **Deployments** tab → tap **⋯** on the latest production deploy → **Redeploy**

## Step 7 — Confirm both work

After redeploy:

```bash
# Test Gmail scanner — should return scanned/found/inserted counts
curl -X POST "https://personal-os-woad.vercel.app/api/finance/gmail-scan?hours=24" \
  -H "x-api-secret: $API_SECRET"
```

After this, the Vercel cron runs the Gmail scan daily at midnight PT and drops receipts into your `/finance` Pending Review queue automatically.

Calendar push works similarly — once the env vars are in, the existing recalc engine will sync block assignments to Google Calendar. (If a specific push endpoint isn't wired yet, ping me and I'll build it.)

---

## Troubleshooting

**"Token has been expired or revoked"** — refresh tokens from the OAuth Playground expire after 7 days if your app is in "Testing" mode. Either:
- Publish your OAuth app (Consent screen → **Publish app**) — token stays valid forever
- Or re-run Step 5 every week

**"Access blocked: Personal OS has not completed the Google verification process"** — your gmail isn't on the test users list. Add it: Consent screen → **Audience** → **+ Add users**.

**Gmail scan returns 0 receipts** — the search query in `lib/finance/gmailScan.ts` looks for `subject:receipt OR subject:invoice OR subject:order` etc. If your receipts have unusual subjects, edit the query.
