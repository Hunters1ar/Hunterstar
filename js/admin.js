/**
 * ============================================================================
 * ADMIN DASHBOARD
 * ============================================================================
 * Handles admin authentication and live Firestore archive management.
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

    const state = {
        submissions: [],
        filteredSubmissions: [],
        selectedId: null,
        loading: false,
        unsubscribe: null
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

    function setLoginLoading(loading) {
        if (!loginButton) return;

        loginButton.disabled = loading;
        loginButton.textContent = loading ? 'Authorizing...' : 'Enter Control Room';
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

    function updateStats() {
        const unread = state.submissions.filter((submission) => !submission.read).length;

        if (totalCount) totalCount.textContent = String(state.submissions.length);
        if (unreadCount) unreadCount.textContent = String(unread);
        if (readCount) readCount.textContent = String(state.submissions.length - unread);
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

    function stopSubscription() {
        if (typeof state.unsubscribe === 'function') {
            state.unsubscribe();
        }

        state.unsubscribe = null;
    }

    function startSubscription() {
        if (!firebaseTools) return;

        stopSubscription();
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

    function handleAuthStateChange(user) {
        const isSignedIn = Boolean(user);

        if (authCard) authCard.classList.toggle('hidden', isSignedIn);
        if (dashboard) dashboard.classList.toggle('hidden', !isSignedIn);

        if (!isSignedIn) {
            stopSubscription();
            state.loading = false;
            state.submissions = [];
            state.filteredSubmissions = [];
            state.selectedId = null;
            updateStats();
            renderListStatus();
            renderList();
            renderDetail();
            if (sessionUser) sessionUser.textContent = 'Signed out';
            return;
        }

        if (sessionUser) {
            sessionUser.textContent = user.email || 'Admin session';
        }

        startSubscription();
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

        updateStats();
        renderListStatus();
        renderDetail();

        firebaseTools.onAdminAuthStateChanged(handleAuthStateChange);
        window.addEventListener('beforeunload', stopSubscription);
    }

    init();
})();
