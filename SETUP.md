# Anchor — Setup & Deployment Guide

## What You Have
A complete React app with:
- Firebase auth (Google sign-in)
- Firestore database (real-time sync)
- Anthropic AI integration (Sonnet 4.6)
- PWA manifest (install as app)
- Vercel serverless API (secure AI calls)
- 9 fully built screens

---

## Step 1 — Firebase Setup (15 min)

1. Go to https://console.firebase.google.com
2. Click **Create a project** → name it "anchor-os"
3. Disable Google Analytics (not needed)

**Enable Authentication:**
- Left sidebar → Build → Authentication
- Click **Get started**
- Sign-in providers → Google → Enable → Save

**Create Firestore database:**
- Left sidebar → Build → Firestore Database
- Click **Create database**
- Choose **Start in production mode**
- Pick your region (us-central1 is fine)

**Get your config:**
- Project Settings (gear icon) → General → scroll to "Your apps"
- Click **</>** (web app) → register app → name it "anchor"
- Copy the firebaseConfig object — you'll need this next

**Firestore security rules:**
- Firestore → Rules tab → replace with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
Click **Publish**.

---

## Step 2 — Configure the App (5 min)

Open `src/lib/firebase.js` and replace the placeholder config:

```js
const firebaseConfig = {
  apiKey:            "paste from Firebase",
  authDomain:        "paste from Firebase",
  projectId:         "paste from Firebase",
  storageBucket:     "paste from Firebase",
  messagingSenderId: "paste from Firebase",
  appId:             "paste from Firebase",
};
```

---

## Step 3 — Anthropic API Key (5 min)

1. Go to https://console.anthropic.com
2. Create account / sign in
3. API Keys → Create Key → copy it
4. You'll add this to Vercel in Step 5 (never put it in the code)

For local development:
- Copy `.env.local.example` → rename to `.env.local`
- Paste your key as `REACT_APP_ANTHROPIC_KEY=sk-ant-...`

---

## Step 4 — GitHub (5 min)

1. Create a new repo at https://github.com (name: anchor-os)
2. In your project folder, run:

```bash
git init
git add .
git commit -m "Initial Anchor build"
git remote add origin https://github.com/YOUR_USERNAME/anchor-os.git
git push -u origin main
```

---

## Step 5 — Vercel Deployment (10 min)

1. Go to https://vercel.com → sign in with GitHub
2. Click **New Project** → import your `anchor-os` repo
3. Framework: **Create React App** (auto-detected)
4. **Environment Variables** — add these:

| Key | Value |
|-----|-------|
| ANTHROPIC_API_KEY | sk-ant-your-key-here |

5. Click **Deploy**
6. Vercel gives you a URL like `anchor-os.vercel.app` — that's your app

**Add Firebase auth domain:**
- Back in Firebase → Authentication → Settings → Authorized domains
- Add your Vercel URL (anchor-os.vercel.app)

---

## Step 6 — Install as App (2 min)

**On iPhone (Safari):**
- Open your Vercel URL in Safari
- Tap the Share button → "Add to Home Screen"
- Name it "Anchor" → Add
- Now it lives on your home screen like a native app

**On Android (Chrome):**
- Open your Vercel URL in Chrome
- Chrome will prompt "Add to Home Screen" automatically
- Or: three-dot menu → "Add to Home Screen"

**On Mac/Desktop (Chrome):**
- Open your Vercel URL
- Address bar → install icon (right side) → Install

---

## Local Development

```bash
# Install dependencies
npm install

# Start local dev server
npm start

# Build for production
npm run build
```

App runs at http://localhost:3000

---

## Future Updates

Any time you change code:
```bash
git add .
git commit -m "describe what you changed"
git push
```
Vercel auto-deploys on every push. Live in ~60 seconds.

---

## File Structure

```
anchor/
├── api/
│   └── chat.js              ← Vercel serverless function (AI calls)
├── public/
│   ├── index.html
│   └── manifest.json        ← PWA config
├── src/
│   ├── App.js               ← Routing + auth guards
│   ├── index.js             ← Entry point
│   ├── context/
│   │   ├── AuthContext.js   ← User auth state
│   │   └── DataContext.js   ← App data (projects, tasks, etc.)
│   ├── lib/
│   │   ├── ai.js            ← All AI calls (Anthropic)
│   │   ├── db.js            ← All Firebase/Firestore operations
│   │   ├── firebase.js      ← Firebase config ← EDIT THIS
│   │   └── tokens.js        ← Design system
│   └── components/
│       ├── layout/
│       │   └── AppLayout.js ← Sidebar + mobile nav
│       ├── ui/
│       │   └── index.js     ← Reusable UI components
│       └── screens/
│           ├── AuthScreen.js
│           ├── OnboardingScreen.js
│           ├── HomeScreen.js
│           ├── ProjectsScreen.js
│           ├── BrainDumpScreen.js
│           ├── AdvisorScreen.js
│           └── OtherScreens.js  ← Debt, Review, Decisions, Ideas, Life
├── .env.local.example       ← Copy → .env.local with your keys
├── .gitignore
└── package.json
```

---

## Screens Built

| Screen | Route | Status |
|--------|-------|--------|
| Auth | / (logged out) | ✅ |
| Onboarding | / (first run) | ✅ |
| Home / Command Center | / | ✅ |
| Projects | /projects | ✅ |
| Brain Dump | /brain-dump | ✅ |
| AI Advisor | /advisor | ✅ |
| Weekly Review | /review | ✅ |
| Decisions | /decisions | ✅ |
| Ideas | /ideas | ✅ |
| Debt Tracker | /debt | ✅ |
| Life OS | /life | ✅ |

---

## Questions or Issues

Common problems:
- **Google sign-in fails** → make sure your domain is added in Firebase Auth → Authorized domains
- **AI not responding** → check ANTHROPIC_API_KEY in Vercel environment variables
- **Data not saving** → check Firestore security rules are published
