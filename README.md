# 🏓 DinkHub

DinkHub is a web-based **pickleball tournament management system** with three role-based portals: an **Admin** dashboard, a **Referee** scoring app, and an **Operator** broadcast view. It runs entirely in the browser, uses **Firebase** for authentication and real-time data, and the referee view can be installed as a **Progressive Web App (PWA)**.

---

## ✨ Features

- **Role-based login**: a single sign-in page sends each user to the right portal (admin, referee or operator).
- **Admin dashboard**: manage accounts, tournaments, games, courts, standings and playoffs, with a trash for deleted items.
- **Referee app**: view assigned tournaments and games and enter live scores.
- **Operator / broadcast view**: follow live scores, standings and playoff brackets in real time.
- **Real-time sync**: scores and standings update instantly through Firebase Realtime Database.
- **Installable PWA**: a pop-up on the login page invites users to install the app (see [PWA behavior](#-pwa-behavior)).
- **Offline-friendly shell**: a service worker caches the app shell so the referee app opens quickly, even on a weak connection.

---

## 👥 Roles

| Role | Landing page | Purpose |
| --- | --- | --- |
| **Admin** | `admin/dashboard.html` | Full control of tournaments, games, accounts and playoffs |
| **Referee** | `referee/referee.html` | Live scoring for assigned games |
| **Operator** | `operator/operator.html` | Broadcast / live display of scores and brackets |

Admin and operator accounts are meant to be used in a **normal web browser**. If they open the installed app, they see a pop-up asking them to log in through their browser instead.

---

## 🧱 Tech Stack

- **HTML, CSS and JavaScript** (no build step)
- **[Tailwind CSS](https://tailwindcss.com/)** via CDN
- **[Font Awesome](https://fontawesome.com/)** icons
- **[Firebase](https://firebase.google.com/)** (Authentication, Realtime Database, Analytics), SDK v10.14.1
- **PWA**: web app manifest and service worker
- **[Vercel](https://vercel.com/)** for hosting

---

## 📁 Project Structure

```
DinkHub/
├── index.html              # Login page + PWA install pop-up
├── admin/
│   └── dashboard.html      # Admin portal
├── operator/
│   └── operator.html       # Operator / broadcast portal
├── referee/
│   └── referee.html        # Referee scoring app
├── icons/                  # PWA and favicon icons
├── firebase-config.js      # Firebase project settings
├── manifest.webmanifest    # PWA manifest
├── sw.js                   # Service worker (offline caching)
├── pwa.js                  # Shared PWA helpers
└── vercel.json             # Vercel config (clean URLs)
```

---

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/nathemonts03/DinkHub.git
cd DinkHub
```

### 2. Set up Firebase

1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication → Email/Password**.
3. Create a **Realtime Database**.
4. Open `firebase-config.js` and fill in your project's settings:

```js
window.APP_CONFIG = {
  firebase: {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
    projectId: "YOUR_PROJECT",
    storageBucket: "YOUR_PROJECT.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID",
    measurementId: "YOUR_MEASUREMENT_ID",
  },
  // The only account allowed to sign in as admin
  adminUid: "YOUR_ADMIN_FIREBASE_UID",
  // Where the admin lands after signing in
  adminRedirect: "./admin/dashboard.html",
};
```

5. Create your admin user in **Authentication** and paste that user's **UID** into `adminUid`.

> **Note:** Firebase web config values are not secrets, but your data is only as safe as your **Realtime Database security rules**. Restrict read/write access by role before going live.

### 3. Run locally

The app is static, so any local web server works:

```bash
# Python
python -m http.server 8000

# or Node
npx serve .
```

Then open `http://localhost:8000`.

> Service workers and install prompts only work on **HTTPS** or `localhost`.

---

## 🌐 Deployment (Vercel)

1. Push the project to GitHub.
2. Import the repository in [Vercel](https://vercel.com/new).
3. Leave the build settings empty (it is a static site) and click **Deploy**.

`vercel.json` enables clean URLs, so `/referee/referee.html` also works as `/referee/referee`:

```json
{
  "cleanUrls": true
}
```

After deploying, add your Vercel domain to **Firebase → Authentication → Settings → Authorized domains**, or sign-in will fail.

---

## 📱 PWA Behavior

- The **login page** shows an **"Install the DinkHub app"** pop-up:
  - **Chrome / Edge / Android:** the **Install** button opens the browser's install prompt.
  - **iPhone / iPad (Safari):** it shows the *Share → Add to Home Screen* steps.
  - **Other browsers:** it shows manual install instructions.
  - **Not now** hides it for 1 day. Add `?pwa=1` to the URL to show it again while testing.
- The installed app starts on the **referee page**.
- **Admin and operator** users who open the installed app see a pop-up with an **Open in web browser** button.
- The service worker never caches the admin or operator pages, and never caches Firebase data or login calls.

To force an update on devices that already cached the app, bump `VERSION` in `sw.js`.

---

## 🔒 Security Notes

- Only the Firebase UID set as `adminUid` can sign in as admin.
- Referee and operator access is decided by the account's `role` and `status` stored in the database. Only **active** accounts can sign in.
- Write strict **Realtime Database rules** so each role can only read and write what it needs.

---

## 🤝 Contributing

1. Fork the repo
2. Create a branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push: `git push origin feature/my-feature`
5. Open a Pull Request

---

## 📄 License

Add a license of your choice (for example MIT) in a `LICENSE` file.

---

<p align="center">Made with 🏓 for the pickleball community</p>