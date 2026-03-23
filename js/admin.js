/**
 * ============================================================================
 * ADMIN DASHBOARD
 * ============================================================================
 * Handles admin authentication, submissions, and public content box management.
 * ============================================================================
 */

(function() {
    'use strict';

    const firebaseTools = window.firebaseConfig;

    const authCard = document.getElementById('adminAuthCard');
    const dashboard = document.getElementById('adminDashboard');
    const loginForm = document.getElementById('adminLoginForm');
    const loginButton = document.getElementById('adminLoginBtn');
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
    const resourceLinksInput = document.getElementById('resourceLinks');
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

    const state = {
        submissions: [],
        filteredSubmissions: [],
        selectedId: null,
        loading: false,
        unsubscribe: null,
        boxes: [],
        selectedBoxId: null,
        boxesLoading: false,
        unsubscribeBoxes: null
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

    function setResourceSaving(loading) {
        if (!resourceSaveButton) return;

        resourceSaveButton.disabled = loading;
        resourceSaveButton.textContent = loading ? 'Saving...' : (state.selectedBoxId ? 'Update Box' : 'Save Box');

        if (resourceDeleteButton) {
            resourceDeleteButton.disabled = loading || !state.selectedBoxId;
        }
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

    function resetResourceForm(keepStatus) {
        state.selectedBoxId = null;

        if (resourceForm) {
            resourceForm.reset();
        }

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

        renderResourceList();
    }

    function fillResourceForm(box) {
        if (!box) {
            resetResourceForm(true);
            return;
        }

        state.selectedBoxId = box.id;

        if (resourceTitleInput) resourceTitleInput.value = box.title || '';
        if (resourceSummaryInput) resourceSummaryInput.value = box.summary || '';
        if (resourceNotesInput) resourceNotesInput.value = box.notes || '';
        if (resourceLinksInput) resourceLinksInput.value = formatLinksForTextarea(box.links);
        if (resourceOrderInput) resourceOrderInput.value = String(Number.isFinite(Number(box.order)) ? Number(box.order) : 0);
        if (resourcePublishedInput) resourcePublishedInput.checked = Boolean(box.published);
        if (resourceFormTitle) resourceFormTitle.textContent = 'Edit Box';
        if (resourceSaveButton) resourceSaveButton.textContent = 'Update Box';
        if (resourceDeleteButton) {
            resourceDeleteButton.classList.remove('hidden');
            resourceDeleteButton.disabled = false;
        }

        renderResourceList();
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
            meta.textContent = 'Order ' + (Number.isFinite(Number(box.order)) ? Number(box.order) : 0) + ' • ' + (box.published ? 'Published' : 'Draft');

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

            const footer = document.createElement('div');
            footer.className = 'admin-resource-footer';
            footer.textContent = box.updatedAtLabel || 'Pending update timestamp';

            item.appendChild(top);
            item.appendChild(summary);
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
            await firebaseTools.signInAdmin(email, password);
            loginForm.reset();
            setStatus(authStatus, 'Secure session established.', 'success');
        } catch (error) {
            setStatus(authStatus, getFriendlyError(error), 'error');
        } finally {
            setLoginLoading(false);
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
            await firebaseTools.updateSubmissionReadState(selected.id, !selected.read);
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
            await firebaseTools.deleteSubmission(selected.id);
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
                order: resourceOrderInput ? Number(resourceOrderInput.value || 0) : 0,
                published: resourcePublishedInput ? resourcePublishedInput.checked : true
            };

            if (!payload.title) {
                throw new Error('Box title is required.');
            }

            const savedId = await firebaseTools.saveContentBox(payload);
            state.selectedBoxId = savedId;
            setStatus(resourceStatus, payload.id ? 'Box updated successfully.' : 'Box created successfully.', 'success');
        } catch (error) {
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

    function handleAuthStateChange(user) {
        const isSignedIn = Boolean(user);

        if (authCard) authCard.classList.toggle('hidden', isSignedIn);
        if (dashboard) dashboard.classList.toggle('hidden', !isSignedIn);

        if (!isSignedIn) {
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
            if (sessionUser) sessionUser.textContent = 'Signed out';
            return;
        }

        if (sessionUser) {
            sessionUser.textContent = user.email || 'Admin session';
        }

        startSubmissionSubscription();
        startBoxSubscription();
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

        if (resourceResetButton) {
            resourceResetButton.addEventListener('click', () => resetResourceForm(false));
        }

        if (resourceDeleteButton) {
            resourceDeleteButton.addEventListener('click', handleResourceDelete);
            resourceDeleteButton.disabled = true;
        }

        updateStats();
        updateResourceStats();
        renderListStatus();
        renderDetail();
        renderResourceList();
        resetResourceForm(true);

        firebaseTools.onAdminAuthStateChanged(handleAuthStateChange);
        window.addEventListener('beforeunload', () => {
            stopSubmissionSubscription();
            stopBoxSubscription();
        });
    }

    init();
})();
