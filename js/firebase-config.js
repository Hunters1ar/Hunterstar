// ---------------------------------------------------------------------------
// Portfolio API Client
// Replaces direct Firebase SDK calls with fetch requests to the backend API.
// Maintains the same window.firebaseConfig interface for compatibility.
// ---------------------------------------------------------------------------

let API_BASE = 'https://api.hunterstar.uz';
if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    API_BASE = 'http://localhost:3001';
} else if (window.location.hostname.includes('hunterstaronline.online')) {
    const match = window.location.pathname.match(/^\/s\/([^\/]+)/);
    if (match) {
        API_BASE = `https://${window.location.hostname}/s/api-${match[1]}`;
    }
}
const ARCHIVE_API_BASE = `${API_BASE}/api`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
async function apiRequest(path, options = {}) {
    const { method = 'GET', body, isFormData = false, forceActivity = false } = options;
    const isArchiveRequest = isPublicArchiveRequest(path);
    const config = {
        method,
        credentials: isArchiveRequest ? 'omit' : 'include',
        headers: {}
    };

    if (forceActivity) {
        config.headers['X-Admin-Activity'] = '1';
    }

    if (body && !isFormData) {
        config.headers['Content-Type'] = 'application/json';
        config.body = JSON.stringify(body);
    } else if (body && isFormData) {
        config.body = body;
    }

    const response = await fetch(getApiUrl(path), config);
    const text = await response.text();
    let data = {};

    try {
        data = text ? JSON.parse(text) : {};
    } catch (error) {
        data = {
            ok: false,
            error: text || `Request failed with status ${response.status}`
        };
    }

    if (!response.ok && data.ok !== false) {
        data.ok = false;
        data.error = data.error || `Request failed with status ${response.status}`;
    }

    if (response.status === 401 && isProtectedAdminRequest(path)) {
        clearCurrentAdminUser();
    }

    if (response.status === 401 && isProtectedPrivateRequest(path)) {
        clearCurrentPrivateUser();
    }

    return { response, data };
}

function getApiUrl(path) {
    if (isPublicArchiveRequest(path)) {
        return `${ARCHIVE_API_BASE}${path.replace(/^\/api/, '')}`;
    }

    return `${API_BASE}${path}`;
}

function isPublicArchiveRequest(path) {
    return path === '/api/archives' || path.startsWith('/api/archives/');
}

function isProtectedAdminRequest(path) {
    return path.startsWith('/api/admin/')
        && !path.startsWith('/api/admin/login')
        && !path.startsWith('/api/admin/2fa')
        && path !== '/api/admin/session';
}

function isProtectedPrivateRequest(path) {
    return path.startsWith('/api/private/')
        && !path.startsWith('/api/private/login')
        && !path.startsWith('/api/private/2fa')
        && path !== '/api/private/session';
}

// ---------------------------------------------------------------------------
// Collection config (kept for admin UI compatibility)
// ---------------------------------------------------------------------------
const primarySubmissionCollectionName = 'my comments';
const legacySubmissionCollectionNames = ['contact-submissions'];
const submissionCollectionNames = Array.from(new Set([
    primarySubmissionCollectionName,
    ...legacySubmissionCollectionNames
]));
const contentBoxesCollectionName = 'content_boxes';
const archiveStorageFolderName = 'archives';
const maxArchiveFileSizeBytes = null;

// ---------------------------------------------------------------------------
// State tracking
// ---------------------------------------------------------------------------
const ADMIN_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
let currentAdminUser = null;
let currentPrivateUser = null;
let authStateCallbacks = [];
let privateAuthStateCallbacks = [];
let adminSessionTouchInFlight = null;
let privateSessionTouchInFlight = null;

function setCurrentAdminUser(user) {
    const previous = currentAdminUser;
    const isSameUser = previous && user && previous.uid === user.uid && previous.email === user.email;

    currentAdminUser = user;
    if (isSameUser) return;

    authStateCallbacks.forEach(cb => cb(currentAdminUser));
}

function clearCurrentAdminUser() {
    if (!currentAdminUser) return;

    currentAdminUser = null;
    authStateCallbacks.forEach(cb => cb(null));
}

function setCurrentPrivateUser(user) {
    const previous = currentPrivateUser;
    const isSameUser = previous && user && previous.uid === user.uid && previous.email === user.email;

    currentPrivateUser = user;
    if (isSameUser) return;

    privateAuthStateCallbacks.forEach(cb => cb(currentPrivateUser));
}

function clearCurrentPrivateUser() {
    if (!currentPrivateUser) return;

    currentPrivateUser = null;
    privateAuthStateCallbacks.forEach(cb => cb(null));
}

// ---------------------------------------------------------------------------
// Validation & Sanitization (kept client-side for instant feedback)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------
function normalizeTimestamp(value) {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    if (typeof value === 'number') return new Date(value);
    return null;
}

// ---------------------------------------------------------------------------
// PUBLIC: Contact form submission
// ---------------------------------------------------------------------------
async function submitToFirebase(formData) {
    try {
        const { response, data } = await apiRequest('/api/contact', {
            method: 'POST',
            body: {
                name: formData.name,
                email: formData.email,
                subject: formData.subject,
                message: formData.message
            }
        });

        if (data.ok) {
            return { success: true, message: data.message };
        }

        return { success: false, message: data.error || 'Something went wrong.' };
    } catch (error) {
        console.error('Contact submission error:', error);
        return { success: false, message: 'Network error. Please try again later.' };
    }
}

// ---------------------------------------------------------------------------
// ADMIN: Authentication
// ---------------------------------------------------------------------------
async function signInAdmin(email, password) {
    const { response, data } = await apiRequest('/api/admin/login', {
        method: 'POST',
        body: { email, password }
    });

    if (!data.ok) {
        throw new Error(data.error || 'Login failed.');
    }

    if (data.twoFactorRequired || data.twoFactorSetupRequired) {
        return data;
    }

    setCurrentAdminUser({ email: data.email, uid: data.uid || email });
    return { ...data, user: currentAdminUser };
}

async function verifyAdminTwoFactor(challengeToken, code) {
    const { data } = await apiRequest('/api/admin/2fa/verify', {
        method: 'POST',
        body: { challengeToken, code }
    });

    if (!data.ok) {
        throw new Error(data.error || '2FA verification failed.');
    }

    setCurrentAdminUser({ email: data.email, uid: data.uid || data.email });
    return { ...data, user: currentAdminUser };
}

async function signOutAdmin() {
    await apiRequest('/api/admin/logout', { method: 'POST' });
    setCurrentAdminUser(null);
}

async function touchAdminSession() {
    if (!currentAdminUser) return false;
    if (adminSessionTouchInFlight) return adminSessionTouchInFlight;

    adminSessionTouchInFlight = apiRequest('/api/admin/session/touch', {
        method: 'POST',
        forceActivity: true
    }).then(({ data }) => {
        if (!data.ok) {
            clearCurrentAdminUser();
            return false;
        }

        setCurrentAdminUser({ email: data.email, uid: data.uid });
        return true;
    }).catch(() => {
        clearCurrentAdminUser();
        return false;
    }).finally(() => {
        adminSessionTouchInFlight = null;
    });

    return adminSessionTouchInFlight;
}

async function expireAdminSession() {
    try {
        await apiRequest('/api/admin/logout', { method: 'POST' });
    } catch (error) {
        // The local lock still needs to happen if the network request fails.
    }

    setCurrentAdminUser(null);
}

function onAdminAuthStateChanged(callback) {
    authStateCallbacks.push(callback);

    // Check session on registration
    apiRequest('/api/admin/session')
        .then(({ data }) => {
            if (data.ok) {
                currentAdminUser = { email: data.email, uid: data.uid };
                callback(currentAdminUser);
            } else {
                currentAdminUser = null;
                callback(null);
            }
        })
        .catch(() => {
            currentAdminUser = null;
            callback(null);
        });

    return () => {
        authStateCallbacks = authStateCallbacks.filter(cb => cb !== callback);
    };
}

function getCurrentAdminUser() {
    return currentAdminUser;
}

function getAdminIdleTimeoutMs() {
    return ADMIN_IDLE_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// PRIVATE ROOM: Authentication
// ---------------------------------------------------------------------------
async function signInPrivate(email, password) {
    const { data } = await apiRequest('/api/private/login', {
        method: 'POST',
        body: { email, password }
    });

    if (!data.ok) {
        throw new Error(data.error || 'Login failed.');
    }

    if (data.twoFactorRequired || data.twoFactorSetupRequired) {
        return data;
    }

    setCurrentPrivateUser({ email: data.email, uid: data.uid || email });
    return { ...data, user: currentPrivateUser };
}

async function verifyPrivateTwoFactor(challengeToken, code) {
    const { data } = await apiRequest('/api/private/2fa/verify', {
        method: 'POST',
        body: { challengeToken, code }
    });

    if (!data.ok) {
        throw new Error(data.error || '2FA verification failed.');
    }

    setCurrentPrivateUser({ email: data.email, uid: data.uid || data.email });
    return { ...data, user: currentPrivateUser };
}

async function signOutPrivate() {
    await apiRequest('/api/private/logout', { method: 'POST' });
    setCurrentPrivateUser(null);
}

async function touchPrivateSession() {
    if (!currentPrivateUser) return false;
    if (privateSessionTouchInFlight) return privateSessionTouchInFlight;

    privateSessionTouchInFlight = apiRequest('/api/private/session/touch', {
        method: 'POST'
    }).then(({ data }) => {
        if (!data.ok) {
            clearCurrentPrivateUser();
            return false;
        }

        setCurrentPrivateUser({ email: data.email, uid: data.uid });
        return true;
    }).catch(() => {
        clearCurrentPrivateUser();
        return false;
    }).finally(() => {
        privateSessionTouchInFlight = null;
    });

    return privateSessionTouchInFlight;
}

async function expirePrivateSession() {
    try {
        await apiRequest('/api/private/logout', { method: 'POST' });
    } catch (error) {
        // The local lock still needs to happen if the network request fails.
    }

    setCurrentPrivateUser(null);
}

function onPrivateAuthStateChanged(callback) {
    privateAuthStateCallbacks.push(callback);

    apiRequest('/api/private/session')
        .then(({ data }) => {
            if (data.ok) {
                currentPrivateUser = { email: data.email, uid: data.uid };
                callback(currentPrivateUser);
            } else {
                currentPrivateUser = null;
                callback(null);
            }
        })
        .catch(() => {
            currentPrivateUser = null;
            callback(null);
        });

    return () => {
        privateAuthStateCallbacks = privateAuthStateCallbacks.filter(cb => cb !== callback);
    };
}

function getCurrentPrivateUser() {
    return currentPrivateUser;
}

function getPrivateIdleTimeoutMs() {
    return ADMIN_IDLE_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// PRIVATE ROOM: Diary pages
// ---------------------------------------------------------------------------
function normalizePrivateDiaryPayload(date, entry = {}) {
    const photos = Array.isArray(entry.photos)
        ? entry.photos.map(photo => ({
            id: photo.id,
            name: photo.name,
            path: photo.path,
            url: photo.url || photo.src,
            contentType: photo.contentType,
            size: photo.size,
            kind: photo.kind || 'image',
            x: photo.x,
            y: photo.y,
            width: photo.width,
            rotation: photo.rotation,
            pinned: photo.pinned,
            uploadedAt: photo.uploadedAt
        })).filter(photo => photo.path && photo.url)
        : [];

    return {
        date,
        text: typeof entry.text === 'string' ? entry.text : '',
        mood: entry.mood || 'steady',
        pageType: entry.pageType || entry.type || 'diary',
        photos,
        photoCount: photos.length
    };
}

async function listPrivateDiaryPages() {
    const { data } = await apiRequest('/api/private/diary');
    if (!data.ok) throw new Error(data.error || 'Failed to load diary pages.');
    return Array.isArray(data.pages) ? data.pages : [];
}

async function getPrivateDiaryPage(date) {
    const { data } = await apiRequest(`/api/private/diary/${encodeURIComponent(date)}`);
    if (!data.ok) throw new Error(data.error || 'Failed to load diary page.');
    return data.page;
}

async function savePrivateDiaryPage(date, entry) {
    const payload = normalizePrivateDiaryPayload(date, entry);
    const { data } = await apiRequest(`/api/private/diary/${encodeURIComponent(date)}`, {
        method: 'PUT',
        body: payload,
        forceActivity: true
    });
    if (!data.ok) throw new Error(data.error || 'Failed to save diary page.');
    return data.page;
}

async function deletePrivateDiaryPage(date) {
    const { data } = await apiRequest(`/api/private/diary/${encodeURIComponent(date)}`, {
        method: 'DELETE',
        forceActivity: true
    });
    if (!data.ok) throw new Error(data.error || 'Failed to delete diary page.');
    return true;
}

async function uploadPrivateDiaryPhotos(date, files) {
    const formData = new FormData();
    Array.from(files || []).forEach((file) => {
        formData.append('files', file);
    });

    const { data } = await apiRequest(`/api/private/diary/${encodeURIComponent(date)}/photos`, {
        method: 'POST',
        body: formData,
        isFormData: true,
        forceActivity: true
    });
    if (!data.ok) throw new Error(data.error || 'Failed to upload diary photos.');
    return Array.isArray(data.photos) ? data.photos : [];
}

async function deletePrivateDiaryPhoto(date, photoId) {
    const { data } = await apiRequest(`/api/private/diary/${encodeURIComponent(date)}/photos/${encodeURIComponent(photoId)}`, {
        method: 'DELETE',
        forceActivity: true
    });
    if (!data.ok) throw new Error(data.error || 'Failed to delete diary photo.');
    return true;
}

async function clearPrivateDiaryPages() {
    const { data } = await apiRequest('/api/private/diary', {
        method: 'DELETE',
        forceActivity: true
    });
    if (!data.ok) throw new Error(data.error || 'Failed to clear diary pages.');
    return data.deleted || 0;
}

// ---------------------------------------------------------------------------
// ADMIN: Submissions
// ---------------------------------------------------------------------------
let submissionPollingInterval = null;

function subscribeToSubmissions(onData, onError) {
    async function fetchSubmissions() {
        try {
            const { data } = await apiRequest('/api/admin/submissions');
            if (data.ok) {
                const submissions = data.submissions.map(sub => ({
                    ...sub,
                    timestamp: normalizeTimestamp(sub.timestamp),
                    createdAtLabel: sub.timestamp
                        ? new Date(sub.timestamp).toLocaleString()
                        : 'Pending server timestamp'
                }));
                onData(submissions);
            } else if (onError) {
                onError(new Error(data.error));
            }
        } catch (error) {
            if (onError) onError(error);
        }
    }

    fetchSubmissions();
    submissionPollingInterval = setInterval(fetchSubmissions, 5000);

    return () => {
        if (submissionPollingInterval) {
            clearInterval(submissionPollingInterval);
            submissionPollingInterval = null;
        }
    };
}

async function updateSubmissionReadState(id, read, collectionName) {
    const { data } = await apiRequest(`/api/admin/submissions/${id}`, {
        method: 'PATCH',
        body: { read: Boolean(read), collectionName }
    });
    if (!data.ok) throw new Error(data.error);
}

async function deleteSubmission(id, collectionName) {
    const { data } = await apiRequest(
        `/api/admin/submissions/${id}?collection=${encodeURIComponent(collectionName || primarySubmissionCollectionName)}`,
        { method: 'DELETE' }
    );
    if (!data.ok) throw new Error(data.error);
}

// ---------------------------------------------------------------------------
// PUBLIC: Content Boxes (archives page)
// ---------------------------------------------------------------------------
let publicBoxPollingInterval = null;

function subscribeToPublicContentBoxes(onData, onError) {
    async function fetchBoxes() {
        try {
            const { data } = await apiRequest('/api/archives');
            if (data.ok) {
                const boxes = data.archives.map(box => ({
                    ...box,
                    createdAt: normalizeTimestamp(box.createdAt),
                    updatedAt: normalizeTimestamp(box.updatedAt),
                    updatedAtLabel: box.updatedAt
                        ? new Date(box.updatedAt).toLocaleString()
                        : 'Pending update timestamp'
                }));
                onData(boxes);
            } else if (onError) {
                onError(new Error(data.error));
            }
        } catch (error) {
            if (onError) onError(error);
        }
    }

    fetchBoxes();
    publicBoxPollingInterval = setInterval(fetchBoxes, 30000); // 30s for public

    return () => {
        if (publicBoxPollingInterval) {
            clearInterval(publicBoxPollingInterval);
            publicBoxPollingInterval = null;
        }
    };
}

// ---------------------------------------------------------------------------
// ADMIN: Content Boxes
// ---------------------------------------------------------------------------
let adminBoxPollingInterval = null;

function subscribeToContentBoxes(onData, onError) {
    async function fetchBoxes() {
        try {
            const { data } = await apiRequest('/api/admin/content-boxes');
            if (data.ok) {
                const boxes = data.contentBoxes.map(box => ({
                    ...box,
                    createdAt: normalizeTimestamp(box.createdAt),
                    updatedAt: normalizeTimestamp(box.updatedAt),
                    updatedAtLabel: box.updatedAt
                        ? new Date(box.updatedAt).toLocaleString()
                        : 'Pending update timestamp'
                }));
                onData(boxes);
            } else if (onError) {
                onError(new Error(data.error));
            }
        } catch (error) {
            if (onError) onError(error);
        }
    }

    fetchBoxes();
    adminBoxPollingInterval = setInterval(fetchBoxes, 5000);

    return () => {
        if (adminBoxPollingInterval) {
            clearInterval(adminBoxPollingInterval);
            adminBoxPollingInterval = null;
        }
    };
}

async function saveContentBox(payload) {
    const formData = new FormData();

    // Build the payload without files
    const payloadData = {
        id: payload.id || null,
        title: payload.title,
        summary: payload.summary,
        notes: payload.notes,
        order: payload.order,
        published: payload.published,
        links: payload.links,
        attachments: payload.attachments,
        removedAttachments: payload.removedAttachments
    };

    formData.append('payload', JSON.stringify(payloadData));

    // Append files
    if (payload.files) {
        const files = Array.from(payload.files);
        for (const file of files) {
            formData.append('files', file);
        }
    }

    const { data } = await apiRequest('/api/admin/content-boxes', {
        method: 'POST',
        body: formData,
        isFormData: true
    });

    if (!data.ok) throw new Error(data.error);
    return data.id;
}

async function deleteContentBox(id) {
    const { data } = await apiRequest(`/api/admin/content-boxes/${id}`, {
        method: 'DELETE'
    });
    if (!data.ok) throw new Error(data.error);
}

// ---------------------------------------------------------------------------
// ADMIN: Playlist gallery
// ---------------------------------------------------------------------------
async function listAdminPlaylists() {
    const { data } = await apiRequest('/api/admin/playlists');
    if (!data.ok) throw new Error(data.error || 'Failed to load playlists.');
    return Array.isArray(data.playlists) ? data.playlists : [];
}

async function addAdminPlaylist(playlist) {
    const { data } = await apiRequest('/api/admin/playlists', {
        method: 'POST',
        body: { playlist },
        forceActivity: true
    });
    if (!data.ok) throw new Error(data.error || 'Failed to add playlist.');
    return data;
}

async function deleteAdminPlaylist(id) {
    const { data } = await apiRequest(`/api/admin/playlists/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        forceActivity: true
    });
    if (!data.ok) throw new Error(data.error || 'Failed to delete playlist.');
    return true;
}

// ---------------------------------------------------------------------------
// Attachment helpers (kept for admin UI compatibility)
// ---------------------------------------------------------------------------
function getAttachmentKind(contentType, fileName) {
    const type = String(contentType || '').toLowerCase();
    const name = String(fileName || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|html|css|js)$/.test(name)) return 'text';
    if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'archive';
    if (/\.(exe|msi|msix|bat|cmd|com|scr|ps1|jar|apk|dmg|pkg|deb|rpm)$/.test(name)) return 'program';
    return 'file';
}

// ---------------------------------------------------------------------------
// Export same interface as before
// ---------------------------------------------------------------------------
window.firebaseConfig = {
    submitToFirebase,
    validateFormData,
    sanitizeInput,
    signInAdmin,
    verifyAdminTwoFactor,
    signOutAdmin,
    touchAdminSession,
    expireAdminSession,
    onAdminAuthStateChanged,
    getCurrentAdminUser,
    getAdminIdleTimeoutMs,
    signInPrivate,
    verifyPrivateTwoFactor,
    signOutPrivate,
    touchPrivateSession,
    expirePrivateSession,
    onPrivateAuthStateChanged,
    getCurrentPrivateUser,
    getPrivateIdleTimeoutMs,
    listPrivateDiaryPages,
    getPrivateDiaryPage,
    savePrivateDiaryPage,
    deletePrivateDiaryPage,
    uploadPrivateDiaryPhotos,
    deletePrivateDiaryPhoto,
    clearPrivateDiaryPages,
    subscribeToSubmissions,
    updateSubmissionReadState,
    deleteSubmission,
    subscribeToPublicContentBoxes,
    subscribeToContentBoxes,
    saveContentBox,
    deleteContentBox,
    listAdminPlaylists,
    addAdminPlaylist,
    deleteAdminPlaylist,
    getSubmissionCollectionName: () => primarySubmissionCollectionName,
    getSubmissionCollectionNames: () => submissionCollectionNames.slice(),
    getContentBoxesCollectionName: () => contentBoxesCollectionName,
    getArchiveStorageFolderName: () => archiveStorageFolderName,
    getPrivateDiaryCollectionName: () => 'private_diary_pages',
    getMaxArchiveFileSizeBytes: () => maxArchiveFileSizeBytes,
    getAttachmentKind,
    isInitialized: () => true,
    isAuthAvailable: () => true,
    isStorageAvailable: () => true
};

console.log('Hunterstar');
