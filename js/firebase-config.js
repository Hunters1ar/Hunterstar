const firebaseConfig = {
    apiKey: "AIzaSyDCmF8y4DXFqABNOuDtz6ytEUqJJcIFlMs",
    authDomain: "portfolio-9b8a5.firebaseapp.com",
    projectId: "portfolio-9b8a5",
    storageBucket: "portfolio-9b8a5.firebasestorage.app",
    messagingSenderId: "181987994223",
    appId: "1:181987994223:web:303a755503ecbd5ddcfb9a",
    measurementId: "G-RR93XNL49Q"
};

const primarySubmissionCollectionName = 'my comments';
const legacySubmissionCollectionNames = ['contact-submissions'];
const submissionCollectionNames = Array.from(new Set([
    primarySubmissionCollectionName,
    ...legacySubmissionCollectionNames
]));
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

    const submissionPayloadVariants = createSubmissionPayloadVariants(formData);

    try {
        for (const collectionName of submissionCollectionNames) {
            for (const submission of submissionPayloadVariants) {
                try {
                    const docRef = await db.collection(collectionName).add(submission);

                    console.log('Submission saved with ID:', docRef.id, 'in collection:', collectionName);

                    return {
                        success: true,
                        message: 'Thank you for your message! I\'ll get back to you soon.'
                    };
                } catch (error) {
                    if (error.code === 'permission-denied') {
                        console.warn('Submission blocked by Firestore rules for collection:', collectionName, error);
                        continue;
                    }

                    console.error('Firebase submission error:', error);

                    return {
                        success: false,
                        message: 'Something went wrong. Please try again later.'
                    };
                }
            }
        }
    } catch (error) {
        console.error('Firebase submission error:', error);
    }

    return {
        success: false,
        message: 'Unable to submit. Check Firestore rules for "' + primarySubmissionCollectionName + '".'
    };
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

function createSubmissionPayloadVariants(formData) {
    const createTimestamp = () => firebaseInitialized && typeof firebase !== 'undefined' && firebase.firestore && firebase.firestore.FieldValue
        ? firebase.firestore.FieldValue.serverTimestamp()
        : new Date();

    const payloadVariants = [{
        name: formData.name,
        email: formData.email,
        subject: formData.subject || 'Portfolio Contact',
        message: formData.message,
        comment: formData.message,
        read: false,
        timestamp: createTimestamp(),
        createdAt: createTimestamp(),
        source: 'portfolio-contact-form',
        page: typeof window !== 'undefined' ? window.location.pathname : 'index.html'
    }];

    return payloadVariants.map((payload) => Object.fromEntries(
        Object.entries(payload).filter(([, value]) => {
            if (typeof value === 'string') {
                return value.trim().length > 0;
            }

            return value !== undefined && value !== null;
        })
    ));
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
    const timestamp = normalizeTimestamp(data.timestamp || data.createdAt);
    const message = data.message || data.comment || '';

    return {
        id: doc.id,
        collectionName: doc.ref.parent.id,
        name: data.name || data.author || data.username || data.email || 'Comment entry',
        email: data.email || '',
        subject: data.subject || 'Comment Entry',
        message,
        read: Boolean(data.read),
        timestamp,
        createdAtLabel: timestamp ? timestamp.toLocaleString() : 'Pending server timestamp'
    };
}

function sortSubmissions(submissions) {
    return submissions.sort((a, b) => {
        const aTime = a.timestamp ? a.timestamp.getTime() : 0;
        const bTime = b.timestamp ? b.timestamp.getTime() : 0;
        return bTime - aTime;
    });
}

function resolveSubmissionCollectionName(collectionName) {
    if (typeof collectionName === 'string' && submissionCollectionNames.includes(collectionName)) {
        return collectionName;
    }

    return primarySubmissionCollectionName;
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

    const collectionState = new Map(
        submissionCollectionNames.map((collectionName) => [
            collectionName,
            {
                status: 'pending',
                docs: [],
                error: null
            }
        ])
    );

    function emitSubmissions() {
        const states = Array.from(collectionState.values());
        const hasReadyCollection = states.some((state) => state.status === 'ready');

        if (hasReadyCollection) {
            const submissions = submissionCollectionNames.flatMap((collectionName) => {
                const state = collectionState.get(collectionName);
                return state ? state.docs : [];
            });

            onData(sortSubmissions(submissions));
            return;
        }

        const hasPendingCollection = states.some((state) => state.status === 'pending');
        if (!hasPendingCollection && typeof onError === 'function') {
            onError(states.find((state) => state.error)?.error || new Error('No submission collections are accessible.'));
        }
    }

    const unsubscribers = submissionCollectionNames.map((collectionName) => db.collection(collectionName).onSnapshot((snapshot) => {
        const state = collectionState.get(collectionName);
        if (!state) return;

        state.status = 'ready';
        state.docs = snapshot.docs.map(mapSubmission);
        state.error = null;
        emitSubmissions();
    }, (error) => {
        console.warn('Submission collection is unavailable:', collectionName, error);

        const state = collectionState.get(collectionName);
        if (!state) return;

        state.status = 'error';
        state.docs = [];
        state.error = error;
        emitSubmissions();
    }));

    return () => {
        unsubscribers.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                unsubscribe();
            }
        });
    };
}

async function updateSubmissionReadState(id, read, collectionName) {
    requireAuth();
    await db.collection(resolveSubmissionCollectionName(collectionName)).doc(id).set({
        read: Boolean(read)
    }, { merge: true });
}

async function deleteSubmission(id, collectionName) {
    requireAuth();
    await db.collection(resolveSubmissionCollectionName(collectionName)).doc(id).delete();
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
    getSubmissionCollectionName: () => primarySubmissionCollectionName,
    getSubmissionCollectionNames: () => submissionCollectionNames.slice(),
    getContentBoxesCollectionName: () => contentBoxesCollectionName,
    isInitialized: () => firebaseInitialized,
    isAuthAvailable: () => authAvailable
};
