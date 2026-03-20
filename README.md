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

## 🔥 Firebase Setup Guide

### Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project"
3. Enter project name and continue
4. Disable Google Analytics (optional)
5. Click "Create project"

### Step 2: Add Web App

1. In project overview, click "Web" icon (`</>`)
2. Enter app nickname
3. Click "Register app"
4. Copy the config object to `js/firebase-config.js`

### Step 3: Setup Firestore Database

1. Go to "Firestore Database" in left menu
2. Click "Create Database"
3. Choose "Start in production mode"
4. Select a location close to you
5. Click "Enable"

### Step 4: Configure Security Rules

Go to "Rules" tab in Firestore and paste:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /contact-submissions/{id} {
      allow create: if request.resource.data.name is string
                   && request.resource.data.name.size() > 1
                   && request.resource.data.name.size() < 100
                   && request.resource.data.email is string
                   && request.resource.data.email.matches('^[^@]+@[^@]+\\.[^@]+$')
                   && request.resource.data.message is string
                   && request.resource.data.message.size() > 9
                   && request.resource.data.message.size() < 5001;
      allow read, write: if false;
    }
  }
}
```

Click "Publish"

---

## 🌐 Deployment Options

### GitHub Pages (Free)

1. Create a GitHub repository
2. Upload all files
3. Go to Settings > Pages
4. Select "Deploy from branch"
5. Choose `main` branch
6. Your site will be at `https://username.github.io/repo-name`

### Netlify (Free)

1. Go to [Netlify](https://netlify.com)
2. Drag and drop your project folder
3. Done! Your site is live instantly

### Firebase Hosting (Free)

```bash
# Install Firebase CLI
npm install -g firebase-tools

# Login
firebase login

# Initialize
firebase init hosting

# Deploy
firebase deploy
```

### Vercel (Free)

1. Go to [Vercel](https://vercel.com)
2. Import your project
3. Deploy automatically

---

## 🎨 Customization

### Change Colors

Edit `css/styles.css`:

```css
/* Dark Mode Colors */
[data-theme="dark"] {
  --color-accent-primary: #c9a227;  /* Gold */
  --color-bg-primary: #0a0a0b;      /* Background */
  --color-text-primary: #e8e4dc;    /* Text */
}

/* Light Mode Colors */
[data-theme="light"] {
  --color-accent-primary: #8b6914;  /* Bronze */
  --color-bg-primary: #f5f0e8;      /* Paper */
  --color-text-primary: #2c2416;    /* Ink */
}
```

### Update Projects

Edit `index.html`, find the `projects-grid` section:

```html
<article class="project-card">
    <div class="card-content">
        <span class="card-number">Project 01</span>
        <h3 class="card-title">Your Project</h3>
        <p class="card-description">Your description...</p>
        <div class="tech-stack">
            <span class="tech-tag">React</span>
            <span class="tech-tag">Node.js</span>
        </div>
    </div>
</article>
```

### Update Skills

Edit `index.html`, find the `cabinet` section:

```html
<article class="index-card">
    <div class="card-tab">Category</div>
    <div class="card-header">
        <div class="card-icon">⚙</div>
        <h3 class="card-title">Skill Category</h3>
    </div>
    <ul class="skill-list">
        <li class="skill-item">Skill 1</li>
        <li class="skill-item">Skill 2</li>
    </ul>
    <div class="proficiency-bar">
        <div class="proficiency-fill" style="width: 90%"></div>
    </div>
</article>
```

### Update Social Links

Edit `index.html`, find the `social-links` section:

```html
<a href="https://github.com/yourusername" class="social-link">
<a href="https://linkedin.com/in/yourusername" class="social-link">
```

---

## 📦 Dependencies (CDN Loaded)

No npm install needed! All dependencies are loaded from CDN:

| Library | Version | Purpose |
|---------|---------|---------|
| Three.js | r128 | 3D graphics |
| Firebase SDK | 10.7.0 | Backend services |
| Google Fonts | - | Playfair Display, JetBrains Mono, Inter |

---

## 🔧 Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

---

## 📝 License

MIT License - feel free to use for personal or commercial projects.

---

## 🙏 Credits

- [Three.js](https://threejs.org/) - 3D library
- [Google Fonts](https://fonts.google.com/) - Typography
- [Firebase](https://firebase.google.com/) - Backend services

---

**Made with ❤️ and a passion for elegant code**
