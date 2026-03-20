# 🐝 Lazy B — Daily AI Companion

Personal daily companion app with live iCloud Calendar sync, AI nudges, task management, and Instagram/Gmail notifications.

---

## Stack
- **Frontend**: Vanilla HTML/CSS/JS (`public/index.html`)
- **Backend**: Node.js + Express (`server/index.js`)
- **Calendar**: iCloud CalDAV via App-Specific Password
- **AI**: Anthropic Claude API (nudges + task generation)
- **Hosting**: Hostinger

---

## Local Setup

### 1. Clone the repo
```bash
git clone https://github.com/rajsinh2191/lazy-b.git
cd lazy-b
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Edit `.env`:
```
ICLOUD_USERNAME=your@icloud.com
ICLOUD_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
ICLOUD_CALENDAR_URL=https://caldav.icloud.com/
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

### 3. Get your App-Specific Password
1. Go to [appleid.apple.com](https://appleid.apple.com)
2. Sign in → **Sign-In and Security** → **App-Specific Passwords**
3. Click **+** → Label it `Lazy B` → Copy the generated password
4. Paste into `ICLOUD_APP_PASSWORD` in your `.env`

### 4. Run locally
```bash
npm run dev
# App runs at http://localhost:3000
```

---

## Deploy to Hostinger

### 1. Upload files
In Hostinger File Manager or via SSH, upload everything **except** `node_modules/`:
```
lazy-b/
├── server/
├── public/
├── package.json
└── .env          ← create this manually on server, never commit it
```

### 2. Install dependencies on server
```bash
cd lazy-b
npm install --production
```

### 3. Set environment variables
Either create `.env` on the server directly, or use Hostinger's **Environment Variables** panel (Hosting → Advanced → Node.js → Environment Variables).

### 4. Configure Node.js app in Hostinger
- **Hostinger Panel → Hosting → Advanced → Node.js**
- Entry point: `server/index.js`
- Node version: 18+
- Click **Restart**

### 5. Domain
Point your subdomain (e.g. `lazyb.yourdomain.com`) to the app in Hostinger DNS settings.

---

## iCloud CalDAV URL (finding yours)

The app auto-uses `https://caldav.icloud.com/` which works for most accounts. If sync fails, find your specific URL:

**On iPhone:**
Settings → [Your Name] → iCloud → Passwords & Accounts → [your account] → Advanced → CalDAV Server

It'll look like: `https://pXX-caldav.icloud.com/`

---

## Git Workflow

```bash
# Initial push
git init
git remote add origin https://github.com/rajsinh2191/lazy-b.git
git add .
git commit -m "feat: initial Lazy B app"
git push -u origin main

# Deploy updates
git add .
git commit -m "fix: description"
git push

# Hostinger auto-deploys on push if GitHub webhook is set up
# Or SSH in and run: git pull && npm install
```

---

## File Structure
```
lazy-b/
├── server/
│   ├── index.js        Express server + API routes
│   └── caldav.js       iCloud CalDAV parser (no external deps)
├── public/
│   └── index.html      Full frontend app
├── .env.example        Environment template
├── .gitignore
├── package.json
└── README.md
```

---

## Features
- 🐝 **Live iCloud sync** — CalDAV REPORT query, no external libraries
- ✦ **AI daily nudges** — Claude-powered, context-aware for Valentina's goals
- ◻ **Smart task manager** — AI task generation via text input
- 📅 **Calendar view** — iCloud events + local events, week navigation
- 📸 **Instagram reminders** — content ideas, posting goals
- ◇ **Wellness tracker** — PCOS-aware daily habits
- ◈ **Microblading tracker** — phase progress, streak tracking
