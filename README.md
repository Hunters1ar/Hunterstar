# 🎭 Poetic Retro Portfolio - Static Version

A stunning, completely static portfolio website featuring a 3D chess piece hero, dark academia aesthetic, and Firebase-powered contact form. No server required!

![Portfolio Preview](preview.png)

---

## ✨ Features

### 🎨 Design
- **Dark Academia Aesthetic** - Deep charcoals, faded gold accents, vintage paper textures
- **Light/Dark Mode** - Smooth theme toggle with localStorage persistence
- **Responsive** - Works perfectly on all devices
- **Vintage Effects** - Grain texture overlay + vignette

### 🎮 3D Hero Element
- **Procedural Chess King** - Built with Three.js, no external models needed
- **Dynamic Materials** - Obsidian (dark mode) / Ivory (light mode)
- **Orbiting Particles** - 150 glowing data nodes
- **Scroll Animation** - Chess piece disassembles as you scroll

### 🔥 Firebase Integration
- **Contact Form** - Messages stored in Firestore
- **No Server Required** - 100% static, can be hosted anywhere
- **Security Rules** - Built-in validation and rate limiting

---

## 📁 File Structure

```
portfolio-static/
├── index.html              # Main HTML file
├── css/
│   └── styles.css          # All styles (pure CSS)
├── js/
│   ├── main.js             # Theme toggle, animations, form handler
│   ├── three-scene.js      # Three.js 3D chess piece
│   └── firebase-config.js  # Firebase configuration
├── assets/                 # Images, fonts (optional)
└── README.md
```

---

## 🚀 Quick Start

### 1. Download & Extract

Download the project files and extract them to your desired location.

### 2. Open Locally

Simply open `index.html` in your browser:
- Double-click the file, or
- Use a local server:

```bash
# Using Python
python -m http.server 8000

# Using Node.js
npx serve

# Using PHP
php -S localhost:8000
```

### 3. Configure Firebase (Optional but Recommended)

Edit `js/firebase-config.js`:

```javascript
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};
```

---
**Made with ❤️ and a passion for elegant code**
