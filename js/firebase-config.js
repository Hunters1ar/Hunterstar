const firebaseConfig = {
    apiKey: "AIzaSyDCmF8y4DXFqABNOuDtz6ytEUqJJcIFlMs",
    authDomain: "portfolio-9b8a5.firebaseapp.com",
    projectId: "portfolio-9b8a5",
    storageBucket: "portfolio-9b8a5.firebasestorage.app",
    messagingSenderId: "181987994223",
    appId: "1:181987994223:web:303a755503ecbd5ddcfb9a",
    measurementId: "G-RR93XNL49Q"
};

const submissionCollectionName = 'my comments';
const contentBoxesCollectionName = 'content_boxes';

let db = null;
let auth = null;
let firebaseInitialized = false;
let authAvailable = false;

try {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps || firebase.apps.length === 0) {
            firebase.initializeApp(firebaseConfig);
        }

        if (typeof firebase.firestore === 'function') {
            db = firebase.firestore();
        }

        if (typeof firebase.auth === 'function') {
            auth = firebase.auth();
            authAvailable = true;
        }

        firebaseInitialized = !!db;
        console.log('Firebase initialized successfully');
    } else {
        console.warn('Firebase SDK not loaded. Contact form will work in demo mode.');
    }
} catch (error) {
    console.error('Firebase initialization error:', error);
}

async function submitToFirebase(formData) {
    if (!firebaseInitialized || !db) {
        console.log('Demo mode - would submit:', formData);
        await new Promise((resolve) => setTimeout(resolve, 1000));
        return {
            success: true,
            message: 'Message received! (Demo mode - configure Firebase for real submissions)'
        };
    }

    try {
        const submission = {
            ...formData,
            comment: formData.message,
            timestamp: firebase.firestore.FieldValue.serverTimestamp(),
            read: false,
            source: 'contact-form'
        };

        const docRef = await db.collection(submissionCollectionName).add(submission);

        console.log('Submission saved with ID:', docRef.id);

        return {
            success: true,
            message: 'Thank you for your message! I\'ll get back to you soon.'
        };
    } catch (error) {
        console.error('Firebase submission error:', error);

        if (error.code === 'permission-denied') {
            return {
                success: false,
                message: 'Unable to submit. Please check Firestore security rules.'
            };
        }

        return {
            success: false,
            message: 'Something went wrong. Please try again later.'
        };
    }
}

function validateFormData(data) {
    if (!data.name || data.name.trim().length < 2) {
        return { valid: false, error: 'Name must be at least 2 characters' };
    }

    if (data.name.length > 100) {
        return { valid: false, error: 'Name must be less than 100 characters' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!data.email || !emailRegex.test(data.email)) {
        return { valid: false, error: 'Please enter a valid email address' };
    }

    if (!data.message || data.message.trim().length < 10) {
        return { valid: false, error: 'Message must be at least 10 characters' };
    }

    if (data.message.length > 5000) {
        return { valid: false, error: 'Message must be less than 5000 characters' };
    }

    return { valid: true };
}

function sanitizeInput(input) {
    if (!input) return '';

    return input
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .trim();
}

function requireAuth() {
    if (!firebaseInitialized || !db) {
        throw new Error('Firebase Firestore is not configured yet.');
    }

    if (!authAvailable || !auth) {
        throw new Error('Firebase Auth SDK is not available on this page.');
    }
}

function normalizeTimestamp(value) {
    if (!value) return null;

    if (typeof value.toDate === 'function') {
        return value.toDate();
    }

    if (value instanceof Date) {
        return value;
    }

    if (typeof value === 'number') {
        return new Date(value);
    }

    return null;
}

function mapSubmission(doc) {
    const data = doc.data() || {};
    const timestamp = normalizeTimestamp(data.timestamp);
    const message = data.message || data.comment || '';

    return {
        id: doc.id,
        collectionName: doc.ref.parent.id,
        name: data.name || data.author || data.username || data.email || 'Comment entry',
        email: data.email || '',
        subject: data.subject || (data.comment && !data.subject ? 'Comment Entry' : 'No subject'),
        message,
        read: Boolean(data.read),
        timestamp,
        createdAtLabel: timestamp ? timestamp.toLocaleString() : 'Pending server timestamp'
    };
}

async function signInAdmin(email, password) {
    requireAuth();
    const credential = await auth.signInWithEmailAndPassword(email, password);
    return credential.user;
}

async function signOutAdmin() {
    requireAuth();
    await auth.signOut();
}

function onAdminAuthStateChanged(callback) {
    if (!authAvailable || !auth) {
        callback(null);
        return () => {};
    }

    return auth.onAuthStateChanged(callback);
}

function getCurrentAdminUser() {
    return auth ? auth.currentUser : null;
}

function subscribeToSubmissions(onData, onError) {
    requireAuth();

    return db.collection(submissionCollectionName).onSnapshot((snapshot) => {
        const submissions = snapshot.docs.map(mapSubmission);

        submissions.sort((a, b) => {
            const aTime = a.timestamp ? a.timestamp.getTime() : 0;
            const bTime = b.timestamp ? b.timestamp.getTime() : 0;
            return bTime - aTime;
        });

        onData(submissions);
    }, (error) => {
        if (typeof onError === 'function') {
            onError(error);
        }
    });
}

async function updateSubmissionReadState(id, read) {
    requireAuth();
    await db.collection(submissionCollectionName).doc(id).set({
        read: Boolean(read)
    }, { merge: true });
}

async function deleteSubmission(id) {
    requireAuth();
    await db.collection(submissionCollectionName).doc(id).delete();
}

function normalizeResourceLinks(rawLinks) {
    if (!Array.isArray(rawLinks)) return [];

    return rawLinks
        .map((link) => {
            const label = typeof link?.label === 'string' ? link.label.trim() : '';
            const url = typeof link?.url === 'string' ? link.url.trim() : '';

            if (!url) return null;

            return {
                label: label || url,
                url
            };
        })
        .filter(Boolean);
}

function mapContentBox(doc) {
    const data = doc.data() || {};
    const createdAt = normalizeTimestamp(data.createdAt);
    const updatedAt = normalizeTimestamp(data.updatedAt);

    return {
        id: doc.id,
        title: data.title || 'Untitled Box',
        summary: data.summary || '',
        notes: data.notes || '',
        links: normalizeResourceLinks(data.links),
        order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0,
        published: data.published !== false,
        createdAt,
        updatedAt,
        updatedAtLabel: updatedAt ? updatedAt.toLocaleString() : 'Pending update timestamp'
    };
}

function ensureFirestoreReady() {
    if (!firebaseInitialized || !db) {
        throw new Error('Firebase Firestore is not configured yet.');
    }
}

function subscribeToPublicContentBoxes(onData, onError) {
    ensureFirestoreReady();

    return db.collection(contentBoxesCollectionName).where('published', '==', true).onSnapshot((snapshot) => {
        const boxes = snapshot.docs.map(mapContentBox);

        boxes.sort((a, b) => {
            if (a.order !== b.order) {
                return a.order - b.order;
            }

            const aTime = a.updatedAt ? a.updatedAt.getTime() : 0;
            const bTime = b.updatedAt ? b.updatedAt.getTime() : 0;
            return bTime - aTime;
        });

        onData(boxes);
    }, (error) => {
        if (typeof onError === 'function') {
            onError(error);
        }
    });
}

function subscribeToContentBoxes(onData, onError) {
    requireAuth();

    return db.collection(contentBoxesCollectionName).onSnapshot((snapshot) => {
        const boxes = snapshot.docs.map(mapContentBox);

        boxes.sort((a, b) => {
            if (a.order !== b.order) {
                return a.order - b.order;
            }

            const aTime = a.updatedAt ? a.updatedAt.getTime() : 0;
            const bTime = b.updatedAt ? b.updatedAt.getTime() : 0;
            return bTime - aTime;
        });

        onData(boxes);
    }, (error) => {
        if (typeof onError === 'function') {
            onError(error);
        }
    });
}

async function saveContentBox(payload) {
    requireAuth();

    const title = typeof payload?.title === 'string' ? payload.title.trim() : '';
    const summary = typeof payload?.summary === 'string' ? payload.summary.trim() : '';
    const notes = typeof payload?.notes === 'string' ? payload.notes.trim() : '';
    const order = Number.isFinite(Number(payload?.order)) ? Number(payload.order) : 0;
    const published = Boolean(payload?.published);
    const links = normalizeResourceLinks(payload?.links);

    if (!title) {
        throw new Error('A title is required.');
    }

    const boxData = {
        title,
        summary,
        notes,
        links,
        order,
        published,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };

    if (payload?.id) {
        await db.collection(contentBoxesCollectionName).doc(payload.id).set(boxData, { merge: true });
        return payload.id;
    }

    boxData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
    const docRef = await db.collection(contentBoxesCollectionName).add(boxData);
    return docRef.id;
}

async function deleteContentBox(id) {
    requireAuth();
    await db.collection(contentBoxesCollectionName).doc(id).delete();
}

window.firebaseConfig = {
    submitToFirebase,
    validateFormData,
    sanitizeInput,
    signInAdmin,
    signOutAdmin,
    onAdminAuthStateChanged,
    getCurrentAdminUser,
    subscribeToSubmissions,
    updateSubmissionReadState,
    deleteSubmission,
    subscribeToPublicContentBoxes,
    subscribeToContentBoxes,
    saveContentBox,
    deleteContentBox,
    getSubmissionCollectionName: () => submissionCollectionName,
    getContentBoxesCollectionName: () => contentBoxesCollectionName,
    isInitialized: () => firebaseInitialized,
    isAuthAvailable: () => authAvailable
};
