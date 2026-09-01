

(function() {
    'use strict';

    const firebaseTools = window.firebaseConfig;
    const emptyQrImage = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
    const adminIdleTimeoutMs = firebaseTools && typeof firebaseTools.getAdminIdleTimeoutMs === 'function'
        ? firebaseTools.getAdminIdleTimeoutMs()
        : 5 * 60 * 1000;
    const adminSessionTouchThrottleMs = 60 * 1000;
    const adminActivityThrottleMs = 1000;

    const authCard = document.getElementById('adminAuthCard');
    const dashboard = document.getElementById('adminDashboard');
    const loginForm = document.getElementById('adminLoginForm');
    const loginButton = document.getElementById('adminLoginBtn');
    const twoFactorPanel = document.getElementById('adminTwoFactorPanel');
    const twoFactorForm = document.getElementById('adminTwoFactorForm');
    const twoFactorButton = document.getElementById('adminTwoFactorBtn');
    const twoFactorCodeInput = document.getElementById('adminTwoFactorCode');
    const twoFactorSetup = document.getElementById('adminTwoFactorSetup');
    const twoFactorQr = document.getElementById('adminTwoFactorQr');
    const twoFactorManualKey = document.getElementById('adminTwoFactorManualKey');
    const twoFactorEyebrow = document.getElementById('adminTwoFactorEyebrow');
    const twoFactorTitle = document.getElementById('adminTwoFactorTitle');
    const twoFactorCopy = document.getElementById('adminTwoFactorCopy');
    const logoutButton = document.getElementById('adminLogoutBtn');
    const authStatus = document.getElementById('adminAuthStatus');
    const sessionUser = document.getElementById('adminSessionUser');
    const searchInput = document.getElementById('adminSearch');
    const listStatus = document.getElementById('adminListStatus');
    const submissionList = document.getElementById('adminSubmissionList');
    const emptyState = document.getElementById('adminEmptyState');
    const detailCard = document.getElementById('adminDetailCard');
    const detailSubject = document.getElementById('adminDetailSubject');
    const detailName = document.getElementById('adminDetailName');
    const detailReadBadge = document.getElementById('adminDetailReadBadge');
    const detailEmail = document.getElementById('adminDetailEmail');
    const detailDate = document.getElementById('adminDetailDate');
    const detailMessage = document.getElementById('adminDetailMessage');
    const toggleReadButton = document.getElementById('adminToggleReadBtn');
    const deleteButton = document.getElementById('adminDeleteBtn');
    const totalCount = document.getElementById('adminTotalCount');
    const unreadCount = document.getElementById('adminUnreadCount');
    const readCount = document.getElementById('adminReadCount');

    const resourceForm = document.getElementById('adminResourceForm');
    const resourceFormTitle = document.getElementById('adminResourceFormTitle');
    const resourceTitleInput = document.getElementById('resourceTitle');
    const resourceSummaryInput = document.getElementById('resourceSummary');
    const resourceNotesInput = document.getElementById('resourceNotes');
    const resourceNotesToolbar = document.getElementById('resourceNotesToolbar');
    const resourceLinksInput = document.getElementById('resourceLinks');
    const resourceFilesInput = document.getElementById('resourceFiles');
    const resourceFileDropTarget = document.querySelector('.admin-file-picker-target');
    const resourceUploadProgress = document.getElementById('adminUploadProgress');
    const resourceUploadProgressText = document.getElementById('adminUploadProgressText');
    const resourceUploadProgressMeta = document.getElementById('adminUploadProgressMeta');
    const resourceUploadProgressBar = document.getElementById('adminUploadProgressBar');
    const resourceFilePreviewList = document.getElementById('adminResourceFilePreviewList');
    const resourceFilePreviewStatus = document.getElementById('adminResourceFilePreviewStatus');
    const resourceOrderInput = document.getElementById('resourceOrder');
    const resourcePublishedInput = document.getElementById('resourcePublished');
    const resourceSaveButton = document.getElementById('adminResourceSaveBtn');
    const resourceResetButton = document.getElementById('adminResourceResetBtn');
    const resourceDeleteButton = document.getElementById('adminResourceDeleteBtn');
    const resourceStatus = document.getElementById('adminResourceStatus');
    const resourceList = document.getElementById('adminResourceList');
    const resourceListStatus = document.getElementById('adminResourceListStatus');
    const resourceTotalCount = document.getElementById('adminBoxTotalCount');
    const resourcePublishedCount = document.getElementById('adminBoxPublishedCount');

    const playlistForm = document.getElementById('adminPlaylistForm');
    const playlistInput = document.getElementById('playlistInput');
    const playlistAddButton = document.getElementById('adminPlaylistAddBtn');
    const playlistStatus = document.getElementById('adminPlaylistStatus');
    const playlistList = document.getElementById('adminPlaylistList');
    const playlistListStatus = document.getElementById('adminPlaylistListStatus');
    const playlistCount = document.getElementById('adminPlaylistCount');
    let playlistAddInFlight = false;

    const state = {
        submissions: [],
        filteredSubmissions: [],
        selectedId: null,
        loading: false,
        unsubscribe: null,
        boxes: [],
        selectedBoxId: null,
        boxesLoading: false,
        unsubscribeBoxes: null,
        resourceDraftAttachments: [],
        resourceRemovedAttachments: [],
        resourcePendingFiles: [],
        twoFactorChallenge: null,
        idleLockTimer: null,
        lastLocalActivityAt: 0,
        lastSessionTouchAt: 0,
        lockingForInactivity: false
    };

    function setStatus(element, message, type) {
        if (!element) return;

        if (!message) {
            element.textContent = '';
            element.className = 'form-status hidden';
            return;
        }

        element.textContent = message;
        element.className = 'form-status ' + type;
    }

    function setListStatus(message, isError) {
        if (!listStatus) return;

        listStatus.textContent = message;
        listStatus.style.color = isError ? '#f18f86' : '';
    }

    function setResourceListStatus(message, isError) {
        if (!resourceListStatus) return;

        resourceListStatus.textContent = message;
        resourceListStatus.style.color = isError ? '#f18f86' : '';
    }

    function setLoginLoading(loading) {
        if (!loginButton) return;

        loginButton.disabled = loading;
        loginButton.textContent = loading ? 'Authorizing...' : 'Enter Control Room';
    }

    function setTwoFactorLoading(loading) {
        if (!twoFactorButton) return;

        twoFactorButton.disabled = loading;
        twoFactorButton.textContent = loading ? 'Verifying...' : 'Verify Code';
    }

    function resetTwoFactorFlow() {
        state.twoFactorChallenge = null;

        if (twoFactorPanel) twoFactorPanel.classList.add('hidden');
        if (twoFactorSetup) twoFactorSetup.classList.add('hidden');
        if (twoFactorQr) twoFactorQr.src = emptyQrImage;
        if (twoFactorManualKey) twoFactorManualKey.textContent = '';
        if (twoFactorForm) twoFactorForm.reset();
        setTwoFactorLoading(false);
    }

    function clearAdminIdleTimer() {
        if (state.idleLockTimer) {
            clearTimeout(state.idleLockTimer);
            state.idleLockTimer = null;
        }
    }

    function scheduleAdminIdleLock() {
        clearAdminIdleTimer();

        if (!firebaseTools || typeof firebaseTools.getCurrentAdminUser !== 'function' || !firebaseTools.getCurrentAdminUser()) {
            return;
        }

        state.idleLockTimer = setTimeout(lockAdminForInactivity, adminIdleTimeoutMs);
    }

    async function touchAdminSessionIfNeeded(force) {
        if (!firebaseTools || typeof firebaseTools.touchAdminSession !== 'function') return;
        if (typeof firebaseTools.getCurrentAdminUser !== 'function' || !firebaseTools.getCurrentAdminUser()) return;

        const now = Date.now();
        if (!force && now - state.lastSessionTouchAt < adminSessionTouchThrottleMs) return;

        state.lastSessionTouchAt = now;
        await firebaseTools.touchAdminSession();
    }

    function handleAdminActivity() {
        if (!firebaseTools || typeof firebaseTools.getCurrentAdminUser !== 'function' || !firebaseTools.getCurrentAdminUser()) {
            return;
        }

        const now = Date.now();
        if (now - state.lastLocalActivityAt < adminActivityThrottleMs) return;

        state.lastLocalActivityAt = now;
        scheduleAdminIdleLock();
        touchAdminSessionIfNeeded(false).catch(() => {});
    }

    async function lockAdminForInactivity() {
        if (state.lockingForInactivity) return;
        if (!firebaseTools || typeof firebaseTools.expireAdminSession !== 'function') return;
        if (typeof firebaseTools.getCurrentAdminUser !== 'function' || !firebaseTools.getCurrentAdminUser()) return;

        state.lockingForInactivity = true;
        clearAdminIdleTimer();

        try {
            await firebaseTools.expireAdminSession();
            setStatus(authStatus, 'Session locked after 5 minutes inactive. Sign in and enter your authenticator code again.', 'error');
        } finally {
            state.lockingForInactivity = false;
        }
    }

    function showTwoFactorChallenge(result) {
        const isSetup = Boolean(result.twoFactorSetupRequired);
        state.twoFactorChallenge = {
            token: result.challengeToken,
            isSetup
        };

        if (twoFactorEyebrow) {
            twoFactorEyebrow.textContent = isSetup ? 'Authenticator Setup' : 'Authenticator Check';
        }

        if (twoFactorTitle) {
            twoFactorTitle.textContent = isSetup ? 'Scan QR Code' : 'Enter Authenticator Code';
        }

        if (twoFactorCopy) {
            twoFactorCopy.textContent = isSetup
                ? 'Scan the QR code with Google Authenticator, Microsoft Authenticator, 1Password, or a compatible app, then enter the current code.'
                : 'Open your authenticator app and enter the current 6-digit code.';
        }

        if (twoFactorSetup) {
            twoFactorSetup.classList.toggle('hidden', !isSetup);
        }

        if (twoFactorQr && result.qrCodeDataUrl) {
            twoFactorQr.src = result.qrCodeDataUrl;
        }

        if (twoFactorManualKey) {
            twoFactorManualKey.textContent = result.manualKey
                ? String(result.manualKey).replace(/(.{4})/g, '$1 ').trim()
                : '';
        }

        if (twoFactorPanel) {
            twoFactorPanel.classList.remove('hidden');
        }

        if (twoFactorCodeInput) {
            twoFactorCodeInput.value = '';
            twoFactorCodeInput.focus();
        }
    }

    function setResourceSaving(loading) {
        if (!resourceSaveButton) return;

        resourceSaveButton.disabled = loading;
        const isUploading = loading && state.resourcePendingFiles.length > 0;
        resourceSaveButton.textContent = loading
            ? (isUploading ? 'Uploading...' : 'Saving...')
            : (state.selectedBoxId ? 'Update Box' : 'Save Box');

        if (resourceDeleteButton) {
            resourceDeleteButton.disabled = loading || !state.selectedBoxId;
        }

        if (resourceFilesInput) {
            resourceFilesInput.disabled = loading;
        }

        if (resourceFileDropTarget) {
            resourceFileDropTarget.classList.toggle('is-disabled', loading);
        }
    }

    const noteInlineFormats = {
        bold: {
            prefix: '**',
            suffix: '**',
            placeholder: 'bold text'
        },
        italic: {
            prefix: '*',
            suffix: '*',
            placeholder: 'italic text'
        },
        underline: {
            prefix: '__',
            suffix: '__',
            placeholder: 'underlined text'
        },
        strike: {
            prefix: '~~',
            suffix: '~~',
            placeholder: 'struck text'
        },
        inlineCode: {
            prefix: '`',
            suffix: '`',
            placeholder: 'code'
        }
    };

    function emitNotesInputChange() {
        if (!resourceNotesInput) return;

        resourceNotesInput.dispatchEvent(new Event('input', {
            bubbles: true
        }));
    }

    function replaceNotesSelection(replacement, selectedStart, selectedEnd) {
        if (!resourceNotesInput) return;

        const value = resourceNotesInput.value;
        const start = resourceNotesInput.selectionStart || 0;
        const end = resourceNotesInput.selectionEnd || start;

        resourceNotesInput.value = value.slice(0, start) + replacement + value.slice(end);
        resourceNotesInput.focus();
        resourceNotesInput.setSelectionRange(start + selectedStart, start + selectedEnd);
        emitNotesInputChange();
    }

    function wrapNotesSelection(prefix, suffix, placeholder) {
        if (!resourceNotesInput) return;

        const start = resourceNotesInput.selectionStart || 0;
        const end = resourceNotesInput.selectionEnd || start;
        const selectedText = resourceNotesInput.value.slice(start, end) || placeholder;
        const replacement = prefix + selectedText + suffix;

        replaceNotesSelection(replacement, prefix.length, prefix.length + selectedText.length);
    }

    function wrapNotesCodeBlock() {
        if (!resourceNotesInput) return;

        const start = resourceNotesInput.selectionStart || 0;
        const end = resourceNotesInput.selectionEnd || start;
        const selectedText = resourceNotesInput.value.slice(start, end) || 'command';

        wrapNotesSelection('```', '```', selectedText);
    }

    function toggleNotesLinePrefix(prefix, placeholder) {
        if (!resourceNotesInput) return;

        const value = resourceNotesInput.value;
        const start = resourceNotesInput.selectionStart || 0;
        const end = resourceNotesInput.selectionEnd || start;

        if (start === end) {
            const replacement = prefix + placeholder;
            replaceNotesSelection(replacement, prefix.length, replacement.length);
            return;
        }

        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
        const nextLineBreak = value.indexOf('\n', end);
        const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
        const selectedLines = value.slice(lineStart, lineEnd).split('\n');
        const meaningfulLines = selectedLines.filter((line) => line.trim());
        const shouldRemovePrefix = meaningfulLines.length > 0 && meaningfulLines.every((line) => line.trimStart().startsWith(prefix));

        const formattedLines = selectedLines.map((line) => {
            if (!line.trim()) return line;

            const indentation = line.match(/^\s*/)[0];
            const content = line.slice(indentation.length);

            if (shouldRemovePrefix) {
                return indentation + content.replace(prefix, '');
            }

            return indentation + prefix + content;
        });

        const replacement = formattedLines.join('\n');
        resourceNotesInput.value = value.slice(0, lineStart) + replacement + value.slice(lineEnd);
        resourceNotesInput.focus();
        resourceNotesInput.setSelectionRange(lineStart, lineStart + replacement.length);
        emitNotesInputChange();
    }

    function applyNotesFormat(format) {
        const inlineFormat = noteInlineFormats[format];

        if (inlineFormat) {
            wrapNotesSelection(inlineFormat.prefix, inlineFormat.suffix, inlineFormat.placeholder);
            return;
        }

        if (format === 'codeBlock') {
            wrapNotesCodeBlock();
            return;
        }

        if (format === 'quote') {
            toggleNotesLinePrefix('> ', 'quote');
            return;
        }

        if (format === 'list') {
            toggleNotesLinePrefix('- ', 'item');
        }
    }

    function handleNotesToolbarClick(event) {
        const button = event.target.closest('[data-format]');
        if (!button || !resourceNotesToolbar || !resourceNotesToolbar.contains(button)) return;

        applyNotesFormat(button.dataset.format);
    }

    function handleNotesKeyboardShortcuts(event) {
        if (!resourceNotesInput || !(event.ctrlKey || event.metaKey)) return;

        const key = event.key.toLowerCase();

        if (event.shiftKey && key === 'm') {
            event.preventDefault();
            applyNotesFormat('codeBlock');
            return;
        }

        if (event.shiftKey) return;

        const shortcutFormats = {
            b: 'bold',
            i: 'italic',
            u: 'underline'
        };

        if (!shortcutFormats[key]) return;

        event.preventDefault();
        applyNotesFormat(shortcutFormats[key]);
    }

    function getFriendlyError(error) {
        if (!error) {
            return 'Something went wrong.';
        }

        switch (error.code) {
            case 'auth/operation-not-allowed':
                return 'Email/Password sign-in is disabled in Firebase. Enable it in Authentication > Sign-in method.';
            case 'auth/invalid-login-credentials':
            case 'auth/wrong-password':
            case 'auth/user-not-found':
            case 'auth/invalid-credential':
                return 'Wrong email or password.';
            case 'auth/too-many-requests':
                return 'Too many attempts. Wait a moment and try again.';
            case 'permission-denied':
            case 'PERMISSION_DENIED':
            case 'permission_denied':
                return 'Your Firestore rules are blocking this action.';
            case 'storage/unauthorized':
                return 'Your Storage rules are blocking this upload.';
            case 'storage/quota-exceeded':
                return 'Firebase Storage quota was exceeded.';
            case 'storage/canceled':
                return 'The upload was canceled.';
            default:
                return error.message || 'Something went wrong.';
        }
    }

    function getSelectedSubmission() {
        return state.submissions.find((submission) => submission.id === state.selectedId) || null;
    }

    function getSelectedBox() {
        return state.boxes.find((box) => box.id === state.selectedBoxId) || null;
    }

    function updateStats() {
        const unread = state.submissions.filter((submission) => !submission.read).length;

        if (totalCount) totalCount.textContent = String(state.submissions.length);
        if (unreadCount) unreadCount.textContent = String(unread);
        if (readCount) readCount.textContent = String(state.submissions.length - unread);
    }

    function updateResourceStats() {
        const publishedBoxes = state.boxes.filter((box) => box.published).length;
        if (resourceTotalCount) resourceTotalCount.textContent = String(state.boxes.length);
        if (resourcePublishedCount) resourcePublishedCount.textContent = String(publishedBoxes);
    }

    function formatFileSize(size) {
        const bytes = Number(size) || 0;
        if (bytes < 1024) return bytes + ' B';

        const units = ['KB', 'MB', 'GB'];
        let value = bytes / 1024;
        let unitIndex = 0;

        while (value >= 1024 && unitIndex < units.length - 1) {
            value /= 1024;
            unitIndex += 1;
        }

        return value.toFixed(value >= 10 ? 1 : 2) + ' ' + units[unitIndex];
    }

    function resetResourceUploadProgress() {
        if (resourceUploadProgress) {
            resourceUploadProgress.classList.add('hidden');
            resourceUploadProgress.classList.remove('is-complete', 'is-error');
        }

        if (resourceUploadProgressText) {
            resourceUploadProgressText.textContent = 'Waiting for upload...';
        }

        if (resourceUploadProgressMeta) {
            resourceUploadProgressMeta.textContent = '0%';
        }

        if (resourceUploadProgressBar) {
            resourceUploadProgressBar.value = 0;
            resourceUploadProgressBar.textContent = '0%';
        }
    }

    function updateResourceUploadProgress(progress) {
        if (!resourceUploadProgress || !progress) return;

        const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
        const fileIndex = Number(progress.fileIndex) || 0;
        const fileCount = Math.max(1, Number(progress.fileCount) || 1);
        const uploadedLabel = formatFileSize(progress.bytesTransferred);
        const totalLabel = formatFileSize(progress.totalBytes);
        const stateLabel = progress.state === 'success' && percent >= 100 ? 'Upload complete' : 'Uploading';

        resourceUploadProgress.classList.remove('hidden', 'is-error');
        resourceUploadProgress.classList.toggle('is-complete', percent >= 100);

        if (resourceUploadProgressText) {
            resourceUploadProgressText.textContent = stateLabel + ' file ' + (fileIndex + 1) + ' of ' + fileCount + ': ' + (progress.fileName || 'archive file');
        }

        if (resourceUploadProgressMeta) {
            resourceUploadProgressMeta.textContent = percent + '% - ' + uploadedLabel + ' / ' + totalLabel;
        }

        if (resourceUploadProgressBar) {
            resourceUploadProgressBar.value = percent;
            resourceUploadProgressBar.textContent = percent + '%';
        }
    }

    function markResourceUploadError() {
        if (resourceUploadProgress) {
            resourceUploadProgress.classList.remove('hidden');
            resourceUploadProgress.classList.add('is-error');
        }
    }

    function getAttachmentKind(contentType, fileName) {
        if (firebaseTools && typeof firebaseTools.getAttachmentKind === 'function') {
            return firebaseTools.getAttachmentKind(contentType, fileName);
        }

        const type = String(contentType || '').toLowerCase();
        const name = String(fileName || '').toLowerCase();

        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('video/')) return 'video';
        if (type.startsWith('audio/')) return 'audio';
        if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
        if (type.startsWith('text/')) return 'text';
        if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'archive';
        if (/\.(exe|msi|msix|msp|appx|appxbundle|bat|cmd|com|scr|ps1|psm1|vbs|vbe|wsf|wsh|jar|apk|dmg|pkg|deb|rpm)$/.test(name)) return 'program';

        return 'file';
    }

    function createPendingFileEntry(file) {
        const kind = getAttachmentKind(file.type, file.name);
        const previewUrl = ['image', 'video', 'audio', 'pdf'].includes(kind)
            ? URL.createObjectURL(file)
            : '';

        return {
            id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
            file,
            name: file.name,
            contentType: file.type || 'application/octet-stream',
            size: file.size,
            kind,
            url: previewUrl,
            previewUrl
        };
    }

    function revokePendingFilePreviews(files) {
        files.forEach((entry) => {
            if (entry && entry.previewUrl) {
                URL.revokeObjectURL(entry.previewUrl);
            }
        });
    }

    function getAttachmentPreviewLabel(attachment) {
        const name = attachment.name || 'Archive file';
        const extensionMatch = name.match(/\.([a-z0-9]{1,8})$/i);
        if (extensionMatch) return extensionMatch[1].toUpperCase();
        return (attachment.kind || 'FILE').toUpperCase();
    }

    function createMetaText(submission) {
        return submission.createdAtLabel || 'Pending server timestamp';
    }

    function createPreviewText(message) {
        if (!message) return 'No message content.';
        return message.length > 120 ? message.slice(0, 117) + '...' : message;
    }

    function ensureValidSelection() {
        if (!state.filteredSubmissions.length) {
            state.selectedId = null;
            return;
        }

        const selectedVisible = state.filteredSubmissions.some((submission) => submission.id === state.selectedId);
        if (!selectedVisible) {
            state.selectedId = state.filteredSubmissions[0].id;
        }
    }

    function formatLinksForTextarea(links) {
        if (!Array.isArray(links) || !links.length) return '';
        return links.map((link) => {
            const label = (link.label || '').trim();
            const url = (link.url || '').trim();
            return label && label !== url ? label + ' | ' + url : url;
        }).join('\n');
    }

    function parseLinksInput(rawValue) {
        if (!rawValue) return [];

        return rawValue
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
                let label = '';
                let url = '';

                if (parts.length >= 2) {
                    label = parts[0];
                    url = parts.slice(1).join(' | ');
                } else {
                    url = line;
                }

                const normalizedUrl = normalizeUrl(url);
                return {
                    label: label || normalizedUrl,
                    url: normalizedUrl
                };
            });
    }

    function normalizeUrl(value) {
        const trimmed = String(value || '').trim();
        if (!trimmed) {
            throw new Error('One of the links is empty.');
        }

        const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed);
        const candidate = hasProtocol ? trimmed : 'https://' + trimmed;
        const parsed = new URL(candidate);

        if (!['http:', 'https:'].includes(parsed.protocol)) {
            throw new Error('Only http and https links are allowed in the public boxes.');
        }

        return parsed.toString();
    }

    function createAttachmentPreview(attachment, options) {
        const previewOptions = options || {};
        const item = document.createElement('article');
        item.className = 'admin-attachment-item';

        const media = document.createElement('div');
        media.className = 'admin-attachment-preview';

        const kind = attachment.kind || getAttachmentKind(attachment.contentType, attachment.name);
        const url = attachment.url || '';

        if (kind === 'image' && url) {
            const image = document.createElement('img');
            image.src = url;
            image.alt = attachment.name || 'Archive image';
            image.loading = 'lazy';
            media.appendChild(image);
        } else if (kind === 'video' && url) {
            const video = document.createElement('video');
            video.src = url;
            video.controls = true;
            video.preload = 'metadata';
            video.muted = true;
            media.appendChild(video);
        } else if (kind === 'audio' && url) {
            const audio = document.createElement('audio');
            audio.src = url;
            audio.controls = true;
            audio.preload = 'metadata';
            media.appendChild(audio);
        } else if (kind === 'pdf' && url) {
            const frame = document.createElement('iframe');
            frame.src = url;
            frame.title = attachment.name || 'Archive PDF preview';
            frame.loading = 'lazy';
            media.appendChild(frame);
        } else {
            const fallback = document.createElement('span');
            fallback.className = 'admin-attachment-fallback';
            fallback.textContent = getAttachmentPreviewLabel(attachment);
            media.appendChild(fallback);
        }

        const body = document.createElement('div');
        body.className = 'admin-attachment-body';

        const name = document.createElement('h4');
        name.className = 'admin-attachment-name';
        name.textContent = attachment.name || 'Archive file';

        const meta = document.createElement('p');
        meta.className = 'admin-attachment-meta';
        meta.textContent = [
            formatFileSize(attachment.size),
            attachment.contentType || 'application/octet-stream'
        ].filter(Boolean).join(' - ');

        const actions = document.createElement('div');
        actions.className = 'admin-attachment-actions';

        if (url && !previewOptions.pending) {
            const openLink = document.createElement('a');
            openLink.className = 'resource-link admin-attachment-link';
            openLink.href = url;
            openLink.target = '_blank';
            openLink.rel = 'noopener noreferrer';
            if (kind === 'program') {
                openLink.download = attachment.name || 'archive-file';
            }
            openLink.textContent = kind === 'program' ? 'Download' : 'Open';
            actions.appendChild(openLink);
        }

        const removeButton = document.createElement('button');
        removeButton.type = 'button';
        removeButton.className = 'admin-danger-button admin-attachment-remove';
        removeButton.textContent = previewOptions.pending ? 'Remove Upload' : 'Remove File';
        removeButton.addEventListener('click', (event) => {
            event.stopPropagation();
            previewOptions.onRemove?.(attachment);
        });
        actions.appendChild(removeButton);

        body.appendChild(name);
        body.appendChild(meta);
        body.appendChild(actions);

        item.appendChild(media);
        item.appendChild(body);
        return item;
    }

    function renderResourceFilePreviews() {
        if (!resourceFilePreviewList) return;

        resourceFilePreviewList.innerHTML = '';

        const existingAttachments = state.resourceDraftAttachments;
        const pendingFiles = state.resourcePendingFiles;
        const totalFiles = existingAttachments.length + pendingFiles.length;

        if (resourceFilePreviewStatus) {
            resourceFilePreviewStatus.textContent = totalFiles
                ? totalFiles + (totalFiles === 1 ? ' file attached.' : ' files attached.')
                : 'No files attached yet.';
        }

        existingAttachments.forEach((attachment) => {
            const item = createAttachmentPreview(attachment, {
                onRemove: () => {
                    state.resourceDraftAttachments = state.resourceDraftAttachments.filter((entry) => entry.id !== attachment.id);
                    state.resourceRemovedAttachments.push(attachment);
                    renderResourceFilePreviews();
                }
            });

            resourceFilePreviewList.appendChild(item);
        });

        pendingFiles.forEach((entry) => {
            const item = createAttachmentPreview(entry, {
                pending: true,
                onRemove: () => {
                    state.resourcePendingFiles = state.resourcePendingFiles.filter((pending) => pending.id !== entry.id);
                    revokePendingFilePreviews([entry]);
                    renderResourceFilePreviews();
                    setResourceSaving(false);
                }
            });

            resourceFilePreviewList.appendChild(item);
        });

        if (!totalFiles) {
            const empty = document.createElement('div');
            empty.className = 'admin-attachment-empty';
            empty.textContent = 'Attach an image, video, PDF, audio clip, archive, or document.';
            resourceFilePreviewList.appendChild(empty);
        }
    }

    function resetResourceForm(keepStatus) {
        state.selectedBoxId = null;
        state.resourceDraftAttachments = [];
        state.resourceRemovedAttachments = [];
        revokePendingFilePreviews(state.resourcePendingFiles);
        state.resourcePendingFiles = [];

        if (resourceForm) {
            resourceForm.reset();
        }

        if (resourceFilesInput) resourceFilesInput.value = '';
        if (resourceOrderInput) resourceOrderInput.value = '0';
        if (resourcePublishedInput) resourcePublishedInput.checked = true;
        if (resourceFormTitle) resourceFormTitle.textContent = 'Create New Box';
        if (resourceSaveButton) resourceSaveButton.textContent = 'Save Box';
        if (resourceDeleteButton) {
            resourceDeleteButton.classList.add('hidden');
            resourceDeleteButton.disabled = true;
        }

        if (!keepStatus) {
            setStatus(resourceStatus, '', 'hidden');
        }

        resetResourceUploadProgress();
        renderResourceList();
        renderResourceFilePreviews();
    }

    function fillResourceForm(box) {
        if (!box) {
            resetResourceForm(true);
            return;
        }

        state.selectedBoxId = box.id;
        state.resourceDraftAttachments = Array.isArray(box.attachments) ? box.attachments.slice() : [];
        state.resourceRemovedAttachments = [];
        revokePendingFilePreviews(state.resourcePendingFiles);
        state.resourcePendingFiles = [];

        if (resourceTitleInput) resourceTitleInput.value = box.title || '';
        if (resourceSummaryInput) resourceSummaryInput.value = box.summary || '';
        if (resourceNotesInput) resourceNotesInput.value = box.notes || '';
        if (resourceLinksInput) resourceLinksInput.value = formatLinksForTextarea(box.links);
        if (resourceFilesInput) resourceFilesInput.value = '';
        if (resourceOrderInput) resourceOrderInput.value = String(Number.isFinite(Number(box.order)) ? Number(box.order) : 0);
        if (resourcePublishedInput) resourcePublishedInput.checked = Boolean(box.published);
        if (resourceFormTitle) resourceFormTitle.textContent = 'Edit Box';
        if (resourceSaveButton) resourceSaveButton.textContent = 'Update Box';
        if (resourceDeleteButton) {
            resourceDeleteButton.classList.remove('hidden');
            resourceDeleteButton.disabled = false;
        }

        resetResourceUploadProgress();
        renderResourceList();
        renderResourceFilePreviews();
    }

    function renderList() {
        if (!submissionList) return;

        submissionList.innerHTML = '';

        if (!state.filteredSubmissions.length) {
            return;
        }

        state.filteredSubmissions.forEach((submission) => {
            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'admin-submission-item';

            if (submission.id === state.selectedId) {
                item.classList.add('is-active');
            }

            if (!submission.read) {
                item.classList.add('is-unread');
            }

            item.dataset.id = submission.id;

            const head = document.createElement('div');
            head.className = 'admin-submission-head';

            const name = document.createElement('h4');
            name.className = 'admin-submission-name';
            name.textContent = submission.name || 'Unknown sender';

            const date = document.createElement('span');
            date.className = 'admin-submission-date';
            date.textContent = createMetaText(submission);

            head.appendChild(name);
            head.appendChild(date);

            const subject = document.createElement('p');
            subject.className = 'admin-submission-subject';
            subject.textContent = submission.subject || 'No subject';

            const preview = document.createElement('p');
            preview.className = 'admin-submission-preview';
            preview.textContent = createPreviewText(submission.message);

            item.appendChild(head);
            item.appendChild(subject);
            item.appendChild(preview);

            item.addEventListener('click', () => {
                state.selectedId = submission.id;
                renderList();
                renderDetail();
            });

            submissionList.appendChild(item);
        });
    }

    function renderDetail() {
        const selected = getSelectedSubmission();

        if (!selected) {
            if (emptyState) emptyState.classList.remove('hidden');
            if (detailCard) detailCard.classList.add('hidden');
            if (toggleReadButton) toggleReadButton.disabled = true;
            if (deleteButton) deleteButton.disabled = true;
            return;
        }

        if (emptyState) emptyState.classList.add('hidden');
        if (detailCard) detailCard.classList.remove('hidden');

        if (detailSubject) detailSubject.textContent = selected.subject || 'No subject';
        if (detailName) detailName.textContent = selected.name || 'Unknown sender';

        if (detailReadBadge) {
            detailReadBadge.textContent = selected.read ? 'Read' : 'Unread';
            detailReadBadge.classList.toggle('is-unread', !selected.read);
        }

        if (detailEmail) {
            detailEmail.textContent = selected.email || 'No email';
            detailEmail.href = selected.email ? 'mailto:' + selected.email : '#';
        }

        if (detailDate) detailDate.textContent = createMetaText(selected);
        if (detailMessage) detailMessage.textContent = selected.message || 'No message content.';
        if (toggleReadButton) {
            toggleReadButton.disabled = false;
            toggleReadButton.textContent = selected.read ? 'Mark as Unread' : 'Mark as Read';
        }
        if (deleteButton) deleteButton.disabled = false;
    }

    function renderListStatus() {
        if (state.loading) {
            setListStatus('Syncing secure archive...', false);
            return;
        }

        if (!state.filteredSubmissions.length) {
            const hasSearch = Boolean(searchInput && searchInput.value.trim());
            setListStatus(hasSearch ? 'No matching submissions found.' : 'No submissions found in this archive yet.', false);
            return;
        }

        const suffix = state.filteredSubmissions.length === 1 ? 'entry loaded' : 'entries loaded';
        setListStatus(state.filteredSubmissions.length + ' ' + suffix, false);
    }

    function renderResourceList() {
        if (!resourceList) return;

        resourceList.innerHTML = '';

        if (state.boxesLoading) {
            setResourceListStatus('Syncing homepage boxes...', false);
            return;
        }

        if (!state.boxes.length) {
            setResourceListStatus('No public boxes created yet.', false);
            return;
        }

        setResourceListStatus(state.boxes.length + (state.boxes.length === 1 ? ' box loaded.' : ' boxes loaded.'), false);

        state.boxes.forEach((box) => {
            const item = document.createElement('article');
            item.className = 'admin-resource-item';
            if (box.id === state.selectedBoxId) {
                item.classList.add('is-active');
            }

            const top = document.createElement('div');
            top.className = 'admin-resource-item-top';

            const headingGroup = document.createElement('div');

            const title = document.createElement('h4');
            title.className = 'admin-resource-title';
            title.textContent = box.title || 'Untitled Box';

            const meta = document.createElement('p');
            meta.className = 'admin-resource-meta';
            const attachmentCount = Array.isArray(box.attachments) ? box.attachments.length : 0;
            meta.textContent = [
                'Order ' + (Number.isFinite(Number(box.order)) ? Number(box.order) : 0),
                box.published ? 'Published' : 'Draft',
                attachmentCount + (attachmentCount === 1 ? ' file' : ' files')
            ].join(' - ');

            headingGroup.appendChild(title);
            headingGroup.appendChild(meta);

            const editButton = document.createElement('button');
            editButton.type = 'button';
            editButton.className = 'cta-button admin-mini-button';
            editButton.textContent = 'Edit';
            editButton.addEventListener('click', () => fillResourceForm(box));

            top.appendChild(headingGroup);
            top.appendChild(editButton);

            const summary = document.createElement('p');
            summary.className = 'admin-resource-summary';
            summary.textContent = box.summary || (box.notes ? box.notes.slice(0, 120) + (box.notes.length > 120 ? '...' : '') : 'No summary yet.');

            const previewAttachments = Array.isArray(box.attachments) ? box.attachments.slice(0, 3) : [];
            const attachmentStrip = document.createElement('div');
            attachmentStrip.className = 'admin-resource-attachment-strip';

            previewAttachments.forEach((attachment) => {
                const chip = document.createElement('span');
                chip.className = 'admin-resource-file-chip';
                chip.textContent = getAttachmentPreviewLabel(attachment);
                attachmentStrip.appendChild(chip);
            });

            const footer = document.createElement('div');
            footer.className = 'admin-resource-footer';
            footer.textContent = box.updatedAtLabel || 'Pending update timestamp';

            item.appendChild(top);
            item.appendChild(summary);
            if (attachmentStrip.childElementCount) {
                item.appendChild(attachmentStrip);
            }
            item.appendChild(footer);

            item.addEventListener('click', (event) => {
                if (event.target === editButton) return;
                fillResourceForm(box);
            });

            resourceList.appendChild(item);
        });
    }

    function applyFilter() {
        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

        state.filteredSubmissions = state.submissions.filter((submission) => {
            if (!query) return true;

            const haystack = [
                submission.name,
                submission.email,
                submission.subject,
                submission.message
            ].join(' ').toLowerCase();

            return haystack.includes(query);
        });

        ensureValidSelection();
        renderListStatus();
        renderList();
        renderDetail();
    }

    function stopSubmissionSubscription() {
        if (typeof state.unsubscribe === 'function') {
            state.unsubscribe();
        }

        state.unsubscribe = null;
    }

    function stopBoxSubscription() {
        if (typeof state.unsubscribeBoxes === 'function') {
            state.unsubscribeBoxes();
        }

        state.unsubscribeBoxes = null;
    }

    function startSubmissionSubscription() {
        if (!firebaseTools) return;

        stopSubmissionSubscription();
        state.loading = true;
        state.submissions = [];
        state.filteredSubmissions = [];
        state.selectedId = null;

        updateStats();
        renderListStatus();
        renderList();
        renderDetail();

        state.unsubscribe = firebaseTools.subscribeToSubmissions((submissions) => {
            state.loading = false;
            state.submissions = submissions;

            if (!state.selectedId && submissions.length) {
                state.selectedId = submissions[0].id;
            }

            if (state.selectedId && !submissions.some((submission) => submission.id === state.selectedId)) {
                state.selectedId = submissions.length ? submissions[0].id : null;
            }

            updateStats();
            applyFilter();
        }, (error) => {
            state.loading = false;
            setStatus(authStatus, getFriendlyError(error), 'error');
            setListStatus('Signed in, but the archive is blocked by your Firestore rules.', true);
            renderDetail();
        });
    }

    function startBoxSubscription() {
        if (!firebaseTools || !firebaseTools.subscribeToContentBoxes) return;

        stopBoxSubscription();
        state.boxesLoading = true;
        state.boxes = [];
        updateResourceStats();
        renderResourceList();

        state.unsubscribeBoxes = firebaseTools.subscribeToContentBoxes((boxes) => {
            state.boxesLoading = false;
            state.boxes = boxes;

            const selectedBoxStillExists = state.selectedBoxId && boxes.some((box) => box.id === state.selectedBoxId);
            if (state.selectedBoxId && !selectedBoxStillExists) {
                resetResourceForm(true);
            }

            if (state.selectedBoxId && selectedBoxStillExists && !state.resourcePendingFiles.length && !state.resourceRemovedAttachments.length) {
                const selectedBox = boxes.find((box) => box.id === state.selectedBoxId);
                state.resourceDraftAttachments = selectedBox && Array.isArray(selectedBox.attachments) ? selectedBox.attachments.slice() : [];
                renderResourceFilePreviews();
            }

            updateResourceStats();
            renderResourceList();
        }, (error) => {
            state.boxesLoading = false;
            setStatus(resourceStatus, getFriendlyError(error), 'error');
            setResourceListStatus('Signed in, but your rules are blocking the public boxes collection.', true);
            renderResourceList();
        });
    }

    async function handleLoginSubmit(event) {
        event.preventDefault();

        if (!firebaseTools) {
            setStatus(authStatus, 'Firebase helper is missing on this page.', 'error');
            return;
        }

        if (!firebaseTools.isInitialized()) {
            setStatus(authStatus, 'Firestore is not configured yet.', 'error');
            return;
        }

        if (!firebaseTools.isAuthAvailable()) {
            setStatus(authStatus, 'Firebase Auth is missing on this page.', 'error');
            return;
        }

        const email = document.getElementById('adminEmail').value.trim();
        const password = document.getElementById('adminPassword').value;

        setLoginLoading(true);
        setStatus(authStatus, '', 'hidden');

        try {
            const result = await firebaseTools.signInAdmin(email, password);
            loginForm.reset();

            if (result && (result.twoFactorRequired || result.twoFactorSetupRequired)) {
                showTwoFactorChallenge(result);
                setStatus(
                    authStatus,
                    result.twoFactorSetupRequired
                        ? 'Scan the QR code and confirm the first authenticator code.'
                        : 'Password accepted. Enter your authenticator code to finish signing in.',
                    'success'
                );
                return;
            }

            resetTwoFactorFlow();
            setStatus(authStatus, 'Secure session established.', 'success');
        } catch (error) {
            setStatus(authStatus, getFriendlyError(error), 'error');
        } finally {
            setLoginLoading(false);
        }
    }

    async function handleTwoFactorSubmit(event) {
        event.preventDefault();

        if (!firebaseTools || typeof firebaseTools.verifyAdminTwoFactor !== 'function') {
            setStatus(authStatus, '2FA helper is missing on this page.', 'error');
            return;
        }

        if (!state.twoFactorChallenge || !state.twoFactorChallenge.token) {
            setStatus(authStatus, 'Sign in again to start a new 2FA challenge.', 'error');
            return;
        }

        const code = twoFactorCodeInput ? twoFactorCodeInput.value : '';

        setTwoFactorLoading(true);
        setStatus(authStatus, '', 'hidden');

        try {
            await firebaseTools.verifyAdminTwoFactor(state.twoFactorChallenge.token, code);
            loginForm.reset();
            resetTwoFactorFlow();
            setStatus(authStatus, 'Secure session established.', 'success');
        } catch (error) {
            if (twoFactorCodeInput) {
                twoFactorCodeInput.select();
            }
            setStatus(authStatus, getFriendlyError(error), 'error');
        } finally {
            setTwoFactorLoading(false);
        }
    }

    async function handleLogout() {
        if (!firebaseTools) return;

        try {
            await firebaseTools.signOutAdmin();
            setStatus(authStatus, 'Signed out of control room.', 'success');
        } catch (error) {
            setStatus(authStatus, getFriendlyError(error), 'error');
        }
    }

    async function handleToggleRead() {
        const selected = getSelectedSubmission();
        if (!selected || !firebaseTools) return;

        toggleReadButton.disabled = true;

        try {
            await firebaseTools.updateSubmissionReadState(selected.id, !selected.read, selected.collectionName);
        } catch (error) {
            setStatus(authStatus, getFriendlyError(error), 'error');
        } finally {
            toggleReadButton.disabled = false;
        }
    }

    async function handleDelete() {
        const selected = getSelectedSubmission();
        if (!selected || !firebaseTools) return;

        const confirmed = window.confirm('Delete this submission permanently?');
        if (!confirmed) return;

        deleteButton.disabled = true;

        try {
            await firebaseTools.deleteSubmission(selected.id, selected.collectionName);
            state.selectedId = null;
        } catch (error) {
            setStatus(authStatus, getFriendlyError(error), 'error');
        } finally {
            deleteButton.disabled = false;
        }
    }

    async function handleResourceSave(event) {
        event.preventDefault();

        if (!firebaseTools || !firebaseTools.saveContentBox) {
            setStatus(resourceStatus, 'Firebase content box helper is missing.', 'error');
            return;
        }

        try {
            setResourceSaving(true);
            setStatus(resourceStatus, '', 'hidden');

            const payload = {
                id: state.selectedBoxId,
                title: resourceTitleInput ? resourceTitleInput.value.trim() : '',
                summary: resourceSummaryInput ? resourceSummaryInput.value.trim() : '',
                notes: resourceNotesInput ? resourceNotesInput.value.trim() : '',
                links: parseLinksInput(resourceLinksInput ? resourceLinksInput.value : ''),
                attachments: state.resourceDraftAttachments,
                removedAttachments: state.resourceRemovedAttachments,
                files: state.resourcePendingFiles.map((entry) => entry.file),
                onUploadProgress: updateResourceUploadProgress,
                order: resourceOrderInput ? Number(resourceOrderInput.value || 0) : 0,
                published: resourcePublishedInput ? resourcePublishedInput.checked : true
            };

            if (!payload.title) {
                throw new Error('Box title is required.');
            }

            if (payload.files.length) {
                const totalBytes = payload.files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
                updateResourceUploadProgress({
                    fileName: payload.files[0].name,
                    fileIndex: 0,
                    fileCount: payload.files.length,
                    bytesTransferred: 0,
                    totalBytes,
                    percent: 0,
                    state: 'queued'
                });
            } else {
                resetResourceUploadProgress();
            }

            const savedId = await firebaseTools.saveContentBox(payload);
            state.selectedBoxId = savedId;
            revokePendingFilePreviews(state.resourcePendingFiles);
            state.resourcePendingFiles = [];
            state.resourceRemovedAttachments = [];
            if (resourceFilesInput) resourceFilesInput.value = '';
            renderResourceFilePreviews();
            setStatus(resourceStatus, payload.id ? 'Box updated successfully.' : 'Box created successfully.', 'success');
        } catch (error) {
            markResourceUploadError();
            setStatus(resourceStatus, getFriendlyError(error), 'error');
        } finally {
            setResourceSaving(false);
        }
    }

    async function handleResourceDelete() {
        const selected = getSelectedBox();
        if (!selected || !firebaseTools || !firebaseTools.deleteContentBox) return;

        const confirmed = window.confirm('Delete this homepage box permanently?');
        if (!confirmed) return;

        try {
            setResourceSaving(true);
            await firebaseTools.deleteContentBox(selected.id);
            resetResourceForm(true);
            setStatus(resourceStatus, 'Box deleted successfully.', 'success');
        } catch (error) {
            setStatus(resourceStatus, getFriendlyError(error), 'error');
        } finally {
            setResourceSaving(false);
        }
    }

    function addResourceFiles(fileSource) {
        const files = Array.from(fileSource || []).filter((file) =>
            file && typeof file.name === 'string' && Number(file.size) >= 0
        );

        if (!files.length) return;

        const addedBytes = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0);

        state.resourcePendingFiles = state.resourcePendingFiles.concat(files.map(createPendingFileEntry));
        renderResourceFilePreviews();
        resetResourceUploadProgress();
        setResourceSaving(false);
        setStatus(
            resourceStatus,
            files.length + (files.length === 1 ? ' file' : ' files') + ' ready. Save the box to upload ' + formatFileSize(addedBytes) + '.',
            'success'
        );
    }

    function handleResourceFilesChange(event) {
        addResourceFiles(event.target.files);
        event.target.value = '';
    }

    function handleResourceFileDrag(event) {
        if (!resourceFileDropTarget) return;

        event.preventDefault();
        event.stopPropagation();
        resourceFileDropTarget.classList.add('is-dragging');
    }

    function handleResourceFileDragLeave(event) {
        if (!resourceFileDropTarget) return;

        event.preventDefault();
        event.stopPropagation();

        if (!resourceFileDropTarget.contains(event.relatedTarget)) {
            resourceFileDropTarget.classList.remove('is-dragging');
        }
    }

    function handleResourceFileDrop(event) {
        if (!resourceFileDropTarget) return;

        event.preventDefault();
        event.stopPropagation();
        resourceFileDropTarget.classList.remove('is-dragging');

        if (resourceFilesInput && resourceFilesInput.disabled) return;

        addResourceFiles(event.dataTransfer ? event.dataTransfer.files : []);
    }

    function handleResourceFileTargetKeydown(event) {
        if (!resourceFilesInput || resourceFilesInput.disabled) return;

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            resourceFilesInput.click();
        }
    }

    function handleAuthStateChange(user) {
        const isSignedIn = Boolean(user);

        if (authCard) authCard.classList.toggle('hidden', isSignedIn);
        if (dashboard) dashboard.classList.toggle('hidden', !isSignedIn);

        if (!isSignedIn) {
            clearAdminIdleTimer();
            state.lastLocalActivityAt = 0;
            state.lastSessionTouchAt = 0;
            resetTwoFactorFlow();
            stopSubmissionSubscription();
            stopBoxSubscription();
            state.loading = false;
            state.submissions = [];
            state.filteredSubmissions = [];
            state.selectedId = null;
            state.boxesLoading = false;
            state.boxes = [];
            updateStats();
            updateResourceStats();
            renderListStatus();
            renderList();
            renderDetail();
            renderResourceList();
            resetResourceForm(true);
            clearPlaylistManager();
            if (sessionUser) sessionUser.textContent = 'Signed out';
            return;
        }

        if (sessionUser) {
            sessionUser.textContent = user.email || 'Admin session';
        }

        state.lastLocalActivityAt = Date.now();
        state.lastSessionTouchAt = Date.now();
        scheduleAdminIdleLock();

        startSubmissionSubscription();
        startBoxSubscription();
        refreshPlaylists();
    }

    // -----------------------------------------------------------------------
    // Playlist gallery manager
    // -----------------------------------------------------------------------
    function setPlaylistStatus(message, type) {
        if (!playlistStatus) return;
        if (!message) {
            playlistStatus.textContent = '';
            playlistStatus.className = 'form-status hidden';
            return;
        }
        playlistStatus.textContent = message;
        playlistStatus.className = 'form-status ' + (type || '');
    }

    function setPlaylistListStatus(message, isError) {
        if (!playlistListStatus) return;
        playlistListStatus.textContent = message;
        playlistListStatus.style.color = isError ? '#f18f86' : '';
    }

    function renderPlaylists(playlists) {
        if (!playlistList) return;
        playlistList.innerHTML = '';
        if (playlistCount) playlistCount.textContent = String(playlists.length);

        if (!playlists.length) {
            setPlaylistListStatus('No playlists yet. Add one above.', false);
            return;
        }

        setPlaylistListStatus(playlists.length + (playlists.length === 1 ? ' playlist live.' : ' playlists live.'), false);

        playlists.forEach((playlist) => {
            const item = document.createElement('article');
            item.className = 'admin-resource-item';

            const top = document.createElement('div');
            top.className = 'admin-resource-item-top';

            const group = document.createElement('div');
            const title = document.createElement('h4');
            title.className = 'admin-resource-title';
            title.textContent = playlist.title || 'Playlist';
            const meta = document.createElement('p');
            meta.className = 'admin-resource-meta';
            meta.textContent = playlist.id;
            group.appendChild(title);
            group.appendChild(meta);

            const removeButton = document.createElement('button');
            removeButton.type = 'button';
            removeButton.className = 'admin-danger-button admin-mini-button';
            removeButton.textContent = 'Remove';
            removeButton.addEventListener('click', () => handlePlaylistRemove(playlist, removeButton));

            top.appendChild(group);
            top.appendChild(removeButton);
            item.appendChild(top);
            playlistList.appendChild(item);
        });
    }

    async function refreshPlaylists() {
        if (!firebaseTools || !firebaseTools.listAdminPlaylists) return;
        setPlaylistListStatus('Loading playlists...', false);
        try {
            const playlists = await firebaseTools.listAdminPlaylists();
            renderPlaylists(playlists);
        } catch (error) {
            if (playlistList) playlistList.innerHTML = '';
            if (playlistCount) playlistCount.textContent = '0';
            setPlaylistListStatus(getFriendlyError(error), true);
        }
    }

    async function handlePlaylistSubmit(event) {
        event.preventDefault();
        if (playlistAddInFlight || !firebaseTools || !playlistInput) return;

        const value = playlistInput.value.trim();
        if (!value) return;

        playlistAddInFlight = true;
        if (playlistAddButton) {
            playlistAddButton.disabled = true;
            playlistAddButton.textContent = 'Adding...';
        }
        setPlaylistStatus('', '');

        try {
            const result = await firebaseTools.addAdminPlaylist(value);
            setPlaylistStatus('Added "' + (result.title || result.id) + '".', 'success');
            playlistInput.value = '';
            await refreshPlaylists();
        } catch (error) {
            setPlaylistStatus(getFriendlyError(error), 'error');
        } finally {
            playlistAddInFlight = false;
            if (playlistAddButton) {
                playlistAddButton.disabled = false;
                playlistAddButton.textContent = 'Add Playlist';
            }
        }
    }

    async function handlePlaylistRemove(playlist, button) {
        const label = playlist.title || playlist.id;
        if (!window.confirm('Remove "' + label + '" from the playlist gallery?')) return;

        if (button) button.disabled = true;
        try {
            await firebaseTools.deleteAdminPlaylist(playlist.id);
            setPlaylistStatus('Removed "' + label + '".', 'success');
            await refreshPlaylists();
        } catch (error) {
            if (button) button.disabled = false;
            setPlaylistStatus(getFriendlyError(error), 'error');
        }
    }

    function clearPlaylistManager() {
        if (playlistList) playlistList.innerHTML = '';
        if (playlistCount) playlistCount.textContent = '0';
        setPlaylistListStatus('Waiting for secure session...', false);
        setPlaylistStatus('', '');
    }

    function init() {
        if (!firebaseTools) {
            setStatus(authStatus, 'Firebase helper failed to load.', 'error');
            return;
        }

        if (searchInput) {
            searchInput.addEventListener('input', applyFilter);
        }

        if (loginForm) {
            loginForm.addEventListener('submit', handleLoginSubmit);
        }

        if (twoFactorForm) {
            twoFactorForm.addEventListener('submit', handleTwoFactorSubmit);
        }

        if (logoutButton) {
            logoutButton.addEventListener('click', handleLogout);
        }

        if (toggleReadButton) {
            toggleReadButton.addEventListener('click', handleToggleRead);
            toggleReadButton.disabled = true;
        }

        if (deleteButton) {
            deleteButton.addEventListener('click', handleDelete);
            deleteButton.disabled = true;
        }

        if (resourceForm) {
            resourceForm.addEventListener('submit', handleResourceSave);
        }

        if (resourceNotesToolbar) {
            resourceNotesToolbar.addEventListener('click', handleNotesToolbarClick);
        }

        if (resourceNotesInput) {
            resourceNotesInput.addEventListener('keydown', handleNotesKeyboardShortcuts);
        }

        if (resourceFilesInput) {
            resourceFilesInput.addEventListener('change', handleResourceFilesChange);
        }

        if (resourceFileDropTarget) {
            resourceFileDropTarget.addEventListener('dragenter', handleResourceFileDrag);
            resourceFileDropTarget.addEventListener('dragover', handleResourceFileDrag);
            resourceFileDropTarget.addEventListener('dragleave', handleResourceFileDragLeave);
            resourceFileDropTarget.addEventListener('drop', handleResourceFileDrop);
            resourceFileDropTarget.addEventListener('keydown', handleResourceFileTargetKeydown);
        }

        if (resourceResetButton) {
            resourceResetButton.addEventListener('click', () => resetResourceForm(false));
        }

        if (resourceDeleteButton) {
            resourceDeleteButton.addEventListener('click', handleResourceDelete);
            resourceDeleteButton.disabled = true;
        }

        if (playlistForm) {
            playlistForm.addEventListener('submit', handlePlaylistSubmit);
        }

        ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach((eventName) => {
            document.addEventListener(eventName, handleAdminActivity, {
                capture: true,
                passive: true
            });
        });

        window.addEventListener('focus', handleAdminActivity);
        document.addEventListener('visibilitychange', () => {
            if (!document.hidden) {
                handleAdminActivity();
            }
        });

        updateStats();
        updateResourceStats();
        renderListStatus();
        renderDetail();
        renderResourceList();
        renderResourceFilePreviews();
        resetResourceForm(true);

        firebaseTools.onAdminAuthStateChanged(handleAuthStateChange);
        window.addEventListener('beforeunload', () => {
            clearAdminIdleTimer();
            stopSubmissionSubscription();
            stopBoxSubscription();
        });
    }

    init();
})();
