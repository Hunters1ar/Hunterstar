const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();
const contentBoxesCollectionName = 'content_boxes';
const ARCHIVE_STORAGE_FOLDER = 'archives';


// Secret shared between VPS and Cloud Function
const uploadSecret = defineSecret('UPLOAD_SECRET');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeTimestamp(value) {
    if (!value) return null;
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    return null;
}

function normalizeLinks(rawLinks) {
    if (!Array.isArray(rawLinks)) return [];
    return rawLinks.map((link) => {
        const label = typeof link?.label === 'string' ? link.label.trim() : '';
        const url = typeof link?.url === 'string' ? link.url.trim() : '';
        if (!url) return null;
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) return null;
            return { label: label || parsed.toString(), url: parsed.toString() };
        } catch { return null; }
    }).filter(Boolean);
}

function getAttachmentKind(contentType, fileName) {
    const type = String(contentType || '').toLowerCase();
    const name = String(fileName || '').toLowerCase();
    if (type.startsWith('image/')) return 'image';
    if (type.startsWith('video/')) return 'video';
    if (type.startsWith('audio/')) return 'audio';
    if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
    if (type.startsWith('text/') || /\.(txt|md|json|csv|log|xml|html|css|js)$/.test(name)) return 'text';
    if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'archive';
    if (/\.(exe|msi|msix|msp|appx|appxbundle|bat|cmd|com|scr|ps1|psm1|vbs|vbe|wsf|wsh|jar|apk|dmg|pkg|deb|rpm)$/.test(name)) return 'program';
    return 'file';
}

function normalizeAttachments(rawAttachments) {
    if (!Array.isArray(rawAttachments)) return [];
    return rawAttachments.map((attachment) => {
        if (!attachment || typeof attachment !== 'object') return null;
        const name = typeof attachment.name === 'string' ? attachment.name.trim() : '';
        const url = typeof attachment.url === 'string' ? attachment.url.trim() : '';
        const contentType = typeof attachment.contentType === 'string' ? attachment.contentType.trim() : '';
        if (!name || !url) return null;
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) return null;
            return {
                id: attachment.id || '',
                name,
                url: parsed.toString(),
                contentType: contentType || 'application/octet-stream',
                size: Number.isFinite(Number(attachment.size)) ? Number(attachment.size) : 0,
                kind: attachment.kind || getAttachmentKind(contentType, name),
                uploadedAt: normalizeTimestamp(attachment.uploadedAt)
            };
        } catch { return null; }
    }).filter(Boolean);
}

function mapArchiveDoc(doc) {
    const data = doc.data() || {};
    const attachments = normalizeAttachments(data.attachments);
    return {
        id: doc.id,
        title: data.title || 'Untitled Box',
        summary: data.summary || '',
        notes: data.notes || '',
        links: normalizeLinks(data.links),
        attachments,
        attachmentCount: attachments.length,
        order: Number.isFinite(Number(data.order)) ? Number(data.order) : 0,
        published: data.published === true,
        createdAt: normalizeTimestamp(data.createdAt),
        updatedAt: normalizeTimestamp(data.updatedAt)
    };
}

function sortArchives(a, b) {
    if (a.order !== b.order) return a.order - b.order;
    const aTime = Date.parse(a.updatedAt || '') || 0;
    const bTime = Date.parse(b.updatedAt || '') || 0;
    return bTime - aTime;
}

function sendJson(res, status, body) {
    res.status(status)
        .set('Cache-Control', status === 200 ? 'public, max-age=60, s-maxage=300' : 'no-store')
        .json(body);
}

function sanitizeFileName(name) {
    const fallback = 'archive-file';
    const source = typeof name === 'string' && name.trim() ? name.trim() : fallback;
    const safe = source.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 140);
    return safe || fallback;
}

function randomHex(bytes = 16) {
    return crypto.randomBytes(bytes).toString('hex');
}

// ---------------------------------------------------------------------------
// POST /upload
// Body (JSON): { secret, folder, boxId, fileName, contentType, dataBase64 }
// Returns: { ok, id, url, path, name, contentType, size, kind, uploadedAt }
// ---------------------------------------------------------------------------
async function handleUpload(req, res, secret) {
    if (req.method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    let body = req.body || {};
    if (Buffer.isBuffer(body)) {
        try { body = JSON.parse(body.toString('utf8')); } catch(e) {}
    } else if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
    }

    // Authenticate
    if (!secret || body.secret !== secret) {
        return sendJson(res, 403, { 
            ok: false, 
            error: `Forbidden. Expected length: ${secret ? secret.length : 0}, Received length: ${body.secret ? body.secret.length : 'undefined'}. typeof body: ${typeof req.body}, isBuffer: ${Buffer.isBuffer(req.body)}` 
        });
    }

    const { fileName, contentType, dataBase64, folder, boxId } = body;

    if (!dataBase64 || !fileName) {
        return sendJson(res, 400, { ok: false, error: 'Missing fileName or dataBase64.' });
    }

    let fileBuffer;
    try {
        fileBuffer = Buffer.from(dataBase64, 'base64');
    } catch (err) {
        return sendJson(res, 400, { ok: false, error: 'Invalid base64 data.' });
    }

    const safeFolder = (folder || ARCHIVE_STORAGE_FOLDER).replace(/[^a-zA-Z0-9/_-]/g, '');
    const safeBoxId = (boxId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '');
    const attachmentId = randomHex();
    const safeName = sanitizeFileName(fileName);
    const storagePath = `${safeFolder}/${safeBoxId}/${Date.now()}-${attachmentId}-${safeName}`;
    const mimeType = contentType || 'application/octet-stream';
    const downloadToken = randomHex();

    try {
        const fileRef = bucket.file(storagePath);
        await fileRef.save(fileBuffer, {
            metadata: {
                contentType: mimeType,
                cacheControl: 'private, max-age=0, no-transform',
                metadata: {
                    firebaseStorageDownloadTokens: downloadToken,
                    boxId: safeBoxId,
                    originalName: fileName
                }
            }
        });

        const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media&token=${downloadToken}`;

        return sendJson(res, 200, {
            ok: true,
            id: attachmentId,
            url,
            path: storagePath,
            name: fileName,
            contentType: mimeType,
            size: fileBuffer.length,
            kind: getAttachmentKind(mimeType, fileName),
            uploadedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error('Storage upload error:', err);
        return sendJson(res, 500, { ok: false, error: 'Storage upload failed: ' + err.message });
    }
}

// ---------------------------------------------------------------------------
// Delete endpoint  POST /delete-file
// Body: JSON { secret, path }
// ---------------------------------------------------------------------------
async function handleDeleteFile(req, res, secret) {
    if (req.method !== 'POST') {
        return sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
    }

    const { secret: providedSecret, path: filePath } = req.body || {};
    if (!secret || providedSecret !== secret) {
        return sendJson(res, 403, { ok: false, error: 'Forbidden.' });
    }
    if (!filePath || typeof filePath !== 'string') {
        return sendJson(res, 400, { ok: false, error: 'No path provided.' });
    }

    try {
        await bucket.file(filePath).delete();
        return sendJson(res, 200, { ok: true });
    } catch (err) {
        if (err.code === 404) return sendJson(res, 200, { ok: true }); // already gone
        console.error('Storage delete error:', err);
        return sendJson(res, 500, { ok: false, error: 'Delete failed: ' + err.message });
    }
}

// ---------------------------------------------------------------------------
// Archive read endpoints
// ---------------------------------------------------------------------------
async function listPublishedArchives(req, res) {
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 200);
    const snapshot = await db.collection(contentBoxesCollectionName).where('published', '==', true).get();
    const archives = snapshot.docs.map(mapArchiveDoc).sort(sortArchives).slice(0, limit);
    sendJson(res, 200, { ok: true, count: archives.length, archives });
}

async function getPublishedArchive(req, res, archiveId) {
    const snapshot = await db.collection(contentBoxesCollectionName).doc(archiveId).get();
    if (!snapshot.exists) { sendJson(res, 404, { ok: false, error: 'Archive item not found.' }); return; }
    const archive = mapArchiveDoc(snapshot);
    if (!archive.published) { sendJson(res, 404, { ok: false, error: 'Archive item not found.' }); return; }
    sendJson(res, 200, { ok: true, archive });
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------
exports.api = onRequest(
    {
        region: 'us-central1',
        cors: true,
        secrets: [uploadSecret],
        timeoutSeconds: 120,
        memory: '256MiB'
    },
    async (req, res) => {
        try {
            const url = new URL(req.url, 'https://portfolio.local');
            const pathname = url.pathname.replace(/\/+$/, '') || '/';
            const segments = pathname.split('/').filter(Boolean);
            const secret = uploadSecret.value();

            if (req.method === 'GET' && pathname === '/health') {
                sendJson(res, 200, { ok: true, service: 'portfolio-archive-api' });
                return;
            }

            if (pathname === '/upload') {
                await handleUpload(req, res, secret);
                return;
            }

            if (pathname === '/delete-file') {
                await handleDeleteFile(req, res, secret);
                return;
            }

            if (req.method === 'GET' && pathname === '/archives') {
                await listPublishedArchives(req, res);
                return;
            }

            if (req.method === 'GET' && segments[0] === 'archives' && segments[1]) {
                await getPublishedArchive(req, res, segments[1]);
                return;
            }

            sendJson(res, 404, { ok: false, error: 'Route not found.' });
        } catch (error) {
            console.error('Archive API error:', error);
            sendJson(res, 500, { ok: false, error: 'Archive API failed.' });
        }
    }
);


