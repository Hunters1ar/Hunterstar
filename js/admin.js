/**
 * HUNTERSTAR CONTROL ROOM // REACT DASHBOARD
 * Architecture:
 * 1. Services Layer (adminServices: auth, submissions, content, playlists)
 * 2. Custom Hooks (useAdminSession, useSubmissions, useContentBoxes, usePlaylists, useKeyboardShortcuts)
 * 3. Shared UI Components (Icon, ToastContainer, ConfirmModal, CommandPalette, EmptyState, Spinner)
 * 4. Workspaces (SubmissionsWorkspace, ContentWorkspace, PlaylistsWorkspace)
 * 5. App Shell & Root Bootstrap
 */

(function () {
    'use strict';

    if (!window.React || !window.ReactDOM) {
        console.error('React or ReactDOM failed to load from CDN.');
        return;
    }

    const { useState, useEffect, useRef, useMemo, useCallback } = window.React;
    const h = window.React.createElement;
    const firebaseTools = window.firebaseConfig;

    // =========================================================================
    // 1. SERVICES LAYER
    // =========================================================================
    function getFriendlyError(error) {
        if (!error) return 'Something went wrong.';
        const code = error.code || '';
        switch (code) {
            case 'auth/operation-not-allowed':
                return 'Email/Password sign-in is disabled in Firebase.';
            case 'auth/invalid-login-credentials':
            case 'auth/wrong-password':
            case 'auth/user-not-found':
            case 'auth/invalid-credential':
                return 'Wrong email or password.';
            case 'auth/too-many-requests':
                return 'Too many attempts. Wait a moment and try again.';
            case 'permission-denied':
            case 'PERMISSION_DENIED':
                return 'Firestore permission denied.';
            case 'storage/unauthorized':
                return 'Storage upload unauthorized.';
            case 'storage/quota-exceeded':
                return 'Storage quota exceeded.';
            default:
                return error.message || String(error) || 'Unexpected system error.';
        }
    }

    function formatFileSize(bytes) {
        const size = Number(bytes) || 0;
        if (size < 1024) return size + ' B';
        const units = ['KB', 'MB', 'GB'];
        let val = size / 1024;
        let u = 0;
        while (val >= 1024 && u < units.length - 1) {
            val /= 1024;
            u++;
        }
        return val.toFixed(val >= 10 ? 1 : 2) + ' ' + units[u];
    }

    function getFileKind(contentType, fileName) {
        if (firebaseTools && typeof firebaseTools.getAttachmentKind === 'function') {
            return firebaseTools.getAttachmentKind(contentType, fileName);
        }
        const type = String(contentType || '').toLowerCase();
        const name = String(fileName || '').toLowerCase();
        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('video/')) return 'video';
        if (type.startsWith('audio/')) return 'audio';
        if (type === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
        if (type.startsWith('text/') || /\.(txt|md|json|csv)$/.test(name)) return 'text';
        if (/\.(zip|rar|7z|tar|gz)$/.test(name)) return 'archive';
        if (/\.(exe|msi|bat|cmd|ps1|apk|dmg|deb|rpm)$/.test(name)) return 'program';
        return 'file';
    }

    const adminServices = {
        auth: {
            signIn: async (email, password) => {
                if (!firebaseTools || !firebaseTools.signInAdmin) throw new Error('Auth service uninitialized.');
                return await firebaseTools.signInAdmin(email, password);
            },
            verify2FA: async (token, code) => {
                if (!firebaseTools || !firebaseTools.verifyAdminTwoFactor) throw new Error('2FA service unavailable.');
                return await firebaseTools.verifyAdminTwoFactor(token, code);
            },
            signOut: async () => {
                if (!firebaseTools || !firebaseTools.signOutAdmin) return;
                await firebaseTools.signOutAdmin();
            },
            touchSession: async () => {
                if (firebaseTools && typeof firebaseTools.touchAdminSession === 'function') {
                    await firebaseTools.touchAdminSession();
                }
            },
            expireSession: async () => {
                if (firebaseTools && typeof firebaseTools.expireAdminSession === 'function') {
                    await firebaseTools.expireAdminSession();
                }
            },
            onAuthStateChanged: (callback) => {
                if (firebaseTools && firebaseTools.onAdminAuthStateChanged) {
                    return firebaseTools.onAdminAuthStateChanged(callback);
                }
                return () => {};
            },
            getCurrentUser: () => {
                return (firebaseTools && firebaseTools.getCurrentAdminUser) ? firebaseTools.getCurrentAdminUser() : null;
            },
            getIdleTimeoutMs: () => {
                return (firebaseTools && firebaseTools.getAdminIdleTimeoutMs) ? firebaseTools.getAdminIdleTimeoutMs() : 5 * 60 * 1000;
            }
        },

        submissions: {
            subscribe: (onData, onError) => {
                if (!firebaseTools || !firebaseTools.subscribeToSubmissions) {
                    onError && onError(new Error('Submissions service unavailable.'));
                    return () => {};
                }
                return firebaseTools.subscribeToSubmissions(onData, onError);
            },
            markRead: async (id, read, collectionName) => {
                if (!firebaseTools || !firebaseTools.updateSubmissionReadState) return;
                await firebaseTools.updateSubmissionReadState(id, read, collectionName);
            },
            delete: async (id, collectionName) => {
                if (!firebaseTools || !firebaseTools.deleteSubmission) return;
                await firebaseTools.deleteSubmission(id, collectionName);
            }
        },

        content: {
            subscribe: (onData, onError) => {
                if (!firebaseTools || !firebaseTools.subscribeToContentBoxes) {
                    onError && onError(new Error('Content boxes service unavailable.'));
                    return () => {};
                }
                return firebaseTools.subscribeToContentBoxes(onData, onError);
            },
            saveBox: async (payload) => {
                if (!firebaseTools || !firebaseTools.saveContentBox) throw new Error('Content save service unavailable.');
                return await firebaseTools.saveContentBox(payload);
            },
            deleteBox: async (id) => {
                if (!firebaseTools || !firebaseTools.deleteContentBox) throw new Error('Content delete service unavailable.');
                await firebaseTools.deleteContentBox(id);
            }
        },

        playlists: {
            list: async () => {
                if (!firebaseTools || !firebaseTools.listAdminPlaylists) return [];
                return await firebaseTools.listAdminPlaylists();
            },
            add: async (urlOrId) => {
                if (!firebaseTools || !firebaseTools.addAdminPlaylist) throw new Error('Playlist add service unavailable.');
                return await firebaseTools.addAdminPlaylist(urlOrId);
            },
            delete: async (id) => {
                if (!firebaseTools || !firebaseTools.deleteAdminPlaylist) throw new Error('Playlist delete service unavailable.');
                await firebaseTools.deleteAdminPlaylist(id);
            }
        }
    };

    // =========================================================================
    // 2. ICONS HELPER
    // =========================================================================
    function Icon({ name, size = 18, className = '' }) {
        const props = {
            viewBox: '0 0 24 24',
            width: size,
            height: size,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: '2',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            className
        };

        switch (name) {
            case 'inbox':
                return h('svg', props,
                    h('polyline', { points: '22 12 16 12 14 15 10 15 8 12 2 12' }),
                    h('path', { d: 'M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z' })
                );
            case 'layers':
            case 'boxes':
                return h('svg', props,
                    h('polygon', { points: '12 2 2 7 12 12 22 7 12 2' }),
                    h('polyline', { points: '2 17 12 22 22 17' }),
                    h('polyline', { points: '2 12 12 17 22 12' })
                );
            case 'youtube':
            case 'play':
                return h('svg', props,
                    h('path', { d: 'M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z' }),
                    h('polygon', { points: '9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02', fill: 'currentColor' })
                );
            case 'search':
                return h('svg', props,
                    h('circle', { cx: '11', cy: '11', r: '8' }),
                    h('line', { x1: '21', y1: '21', x2: '16.65', y2: '16.65' })
                );
            case 'lock':
                return h('svg', props,
                    h('rect', { x: '3', y: '11', width: '18', height: '11', rx: '2', ry: '2' }),
                    h('path', { d: 'M7 11V7a5 5 0 0 1 10 0v4' })
                );
            case 'trash':
                return h('svg', props,
                    h('polyline', { points: '3 6 5 6 21 6' }),
                    h('path', { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' })
                );
            case 'plus':
                return h('svg', props,
                    h('line', { x1: '12', y1: '5', x2: '12', y2: '19' }),
                    h('line', { x1: '5', y1: '12', x2: '19', y2: '12' })
                );
            case 'refresh':
                return h('svg', props,
                    h('polyline', { points: '23 4 23 10 17 10' }),
                    h('polyline', { points: '1 20 1 14 7 14' }),
                    h('path', { d: 'M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15' })
                );
            case 'chevron-left':
                return h('svg', props, h('polyline', { points: '15 18 9 12 15 6' }));
            case 'chevron-right':
                return h('svg', props, h('polyline', { points: '9 18 15 12 9 6' }));
            case 'external-link':
                return h('svg', props,
                    h('path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }),
                    h('polyline', { points: '15 3 21 3 21 9' }),
                    h('line', { x1: '10', y1: '14', x2: '21', y2: '3' })
                );
            case 'download':
                return h('svg', props,
                    h('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
                    h('polyline', { points: '7 10 12 15 17 10' }),
                    h('line', { x1: '12', y1: '15', x2: '12', y2: '3' })
                );
            case 'x':
                return h('svg', props,
                    h('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
                    h('line', { x1: '6', y1: '6', x2: '18', y2: '18' })
                );
            case 'upload':
                return h('svg', props,
                    h('path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }),
                    h('polyline', { points: '17 8 12 3 7 8' }),
                    h('line', { x1: '12', y1: '3', x2: '12', y2: '15' })
                );
            case 'command':
                return h('svg', props,
                    h('path', { d: 'M18 3a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3 3 3 0 0 0 3-3 3 3 0 0 0-3-3H6a3 3 0 0 0-3 3 3 3 0 0 0 3 3 3 3 0 0 0 3-3V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0 3 3h12a3 3 0 0 0 3-3 3 3 0 0 0-3-3z' })
                );
            case 'menu':
                return h('svg', props,
                    h('line', { x1: '3', y1: '12', x2: '21', y2: '12' }),
                    h('line', { x1: '3', y1: '6', x2: '21', y2: '6' }),
                    h('line', { x1: '3', y1: '18', x2: '21', y2: '18' })
                );
            case 'check':
                return h('svg', props, h('polyline', { points: '20 6 9 17 4 12' }));
            default:
                return h('svg', props, h('circle', { cx: '12', cy: '12', r: '10' }));
        }
    }

    function BrandLogo({ size = 20, className = '' }) {
        return h('img', {
            src: 'assets/logo.png',
            alt: 'Hunterstar',
            className: 'cr-brand-logo-img ' + className,
            width: size,
            height: size,
            onError: (e) => {
                if (!e.target.dataset.fallback) {
                    e.target.dataset.fallback = '1';
                    e.target.src = 'hunterstar.webp';
                } else if (e.target.dataset.fallback === '1') {
                    e.target.dataset.fallback = '2';
                    e.target.src = 'favicon.svg';
                } else if (e.target.dataset.fallback === '2') {
                    e.target.dataset.fallback = '3';
                    e.target.src = 'favicon-96x96.png';
                }
            }
        });
    }

    function UserAvatar({ user, size = 32, className = '' }) {
        const [imgFailed, setImgFailed] = useState(false);
        const initial = (user && user.email ? user.email[0] : 'H').toUpperCase();

        if (imgFailed) {
            return h('span', { className: 'cr-avatar-initial' }, initial);
        }

        return h('img', {
            src: 'assets/hunterrealpic.png',
            alt: user && user.email ? user.email : 'Hunterstar Root Operator',
            className: 'cr-user-avatar-img ' + className,
            width: size,
            height: size,
            onError: (e) => {
                if (!e.target.dataset.fallback) {
                    e.target.dataset.fallback = '1';
                    e.target.src = 'hunterstar.webp';
                } else if (e.target.dataset.fallback === '1') {
                    e.target.dataset.fallback = '2';
                    e.target.src = 'assets/logo.png';
                } else {
                    setImgFailed(true);
                }
            }
        });
    }

    // =========================================================================
    // 3. TOAST & MODAL NOTIFICATION SYSTEM
    // =========================================================================
    function ToastContainer({ toasts, onDismiss }) {
        if (!toasts.length) return null;
        return h('div', { className: 'cr-toast-container' },
            toasts.map(t => h('div', {
                key: t.id,
                className: 'cr-toast is-' + (t.type || 'info'),
                onClick: () => onDismiss(t.id)
            },
                h(Icon, { name: t.type === 'error' ? 'x' : (t.type === 'success' ? 'check' : 'command'), size: 16 }),
                h('span', null, t.message)
            ))
        );
    }

    function ConfirmModal({ config, onClose }) {
        if (!config) return null;
        return h('div', { className: 'cr-modal-backdrop', onClick: onClose },
            h('div', { className: 'cr-modal-box', onClick: e => e.stopPropagation() },
                h('div', { className: 'cr-panel-title-group' },
                    h('span', { className: 'cr-panel-eyebrow' }, config.eyebrow || 'CONFIRM ACTION'),
                    h('h3', { className: 'cr-panel-title' }, config.title || 'Are you sure?')
                ),
                h('p', { style: { color: 'var(--cr-text-secondary)', fontSize: '0.88rem', lineHeight: '1.6', margin: 0 } },
                    config.message
                ),
                h('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' } },
                    h('button', {
                        type: 'button',
                        className: 'cr-btn cr-btn-secondary',
                        onClick: onClose
                    }, 'Cancel'),
                    h('button', {
                        type: 'button',
                        className: 'cr-btn ' + (config.isDanger ? 'cr-btn-danger' : 'cr-btn-primary'),
                        onClick: () => {
                            config.onConfirm && config.onConfirm();
                            onClose();
                        }
                    }, config.confirmLabel || 'Proceed')
                )
            )
        );
    }

    // =========================================================================
    // 4. COMMAND PALETTE (CTRL + K)
    // =========================================================================
    function CommandPalette({ isOpen, onClose, onSelectAction }) {
        const [query, setQuery] = useState('');
        const [selectedIndex, setSelectedIndex] = useState(0);
        const inputRef = useRef(null);

        const actions = useMemo(() => [
            { id: 'tab-submissions', label: 'Open Submissions (Inbox)', shortcut: '1', run: () => onSelectAction('submissions') },
            { id: 'tab-content', label: 'Open Content Boxes & Notes', shortcut: '2', run: () => onSelectAction('content') },
            { id: 'tab-playlists', label: 'Open YouTube Playlists', shortcut: '3', run: () => onSelectAction('playlists') },
            { id: 'action-new-box', label: 'Create New Content Box', shortcut: 'N', run: () => onSelectAction('new-box') },
            { id: 'action-refresh', label: 'Refresh All Data', shortcut: 'R', run: () => onSelectAction('refresh') },
            { id: 'action-lock', label: 'Lock Control Room Session', shortcut: 'L', run: () => onSelectAction('lock') }
        ], [onSelectAction]);

        const filtered = useMemo(() => {
            const q = query.trim().toLowerCase();
            if (!q) return actions;
            return actions.filter(a => a.label.toLowerCase().includes(q));
        }, [actions, query]);

        useEffect(() => {
            if (isOpen) {
                setQuery('');
                setSelectedIndex(0);
                setTimeout(() => inputRef.current && inputRef.current.focus(), 50);
            }
        }, [isOpen]);

        useEffect(() => {
            setSelectedIndex(0);
        }, [query]);

        if (!isOpen) return null;

        const handleKeyDown = (e) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setSelectedIndex(i => (i + 1) % (filtered.length || 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setSelectedIndex(i => (i - 1 + filtered.length) % (filtered.length || 1));
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (filtered[selectedIndex]) {
                    filtered[selectedIndex].run();
                    onClose();
                }
            } else if (e.key === 'Escape') {
                onClose();
            }
        };

        return h('div', { className: 'cr-modal-backdrop', onClick: onClose },
            h('div', { className: 'cr-modal-box cr-cmd-palette', onClick: e => e.stopPropagation() },
                h('div', { style: { display: 'flex', alignItems: 'center', padding: '0 16px' } },
                    h(Icon, { name: 'search', size: 18, className: 'cr-search-icon-palette' }),
                    h('input', {
                        ref: inputRef,
                        type: 'text',
                        className: 'cr-cmd-input',
                        placeholder: 'Search Control Room commands... (Type 1, 2, 3, N, R, L)',
                        value: query,
                        onChange: e => setQuery(e.target.value),
                        onKeyDown: handleKeyDown
                    })
                ),
                h('div', { className: 'cr-cmd-list' },
                    filtered.length === 0
                        ? h('div', { style: { padding: '16px', color: 'var(--cr-text-muted)', textAlign: 'center', fontSize: '0.84rem' } }, 'No matching command found.')
                        : filtered.map((item, idx) => h('button', {
                            key: item.id,
                            type: 'button',
                            className: 'cr-cmd-item ' + (idx === selectedIndex ? 'is-selected' : ''),
                            onClick: () => { item.run(); onClose(); }
                        },
                            h('span', null, item.label),
                            h('span', { className: 'cr-kbd-shortcut' }, item.shortcut)
                        ))
                )
            )
        );
    }

    // =========================================================================
    // 5. AUTH GATE & 2FA VIEW
    // =========================================================================
    function AuthGate({ onAuthSuccess, toast }) {
        const [email, setEmail] = useState('');
        const [password, setPassword] = useState('');
        const [loading, setLoading] = useState(false);
        const [challenge, setChallenge] = useState(null); // { token, isSetup, qr, manualKey }
        const [twoFactorCode, setTwoFactorCode] = useState('');
        const [statusMsg, setStatusMsg] = useState(null);

        const handleLoginSubmit = async (e) => {
            e.preventDefault();
            if (!email.trim() || !password) return;
            setLoading(true);
            setStatusMsg(null);

            try {
                const res = await adminServices.auth.signIn(email.trim(), password);
                if (res && (res.twoFactorRequired || res.twoFactorSetupRequired)) {
                    setChallenge({
                        token: res.challengeToken,
                        isSetup: Boolean(res.twoFactorSetupRequired),
                        qr: res.qrCodeDataUrl,
                        manualKey: res.manualKey
                    });
                    setStatusMsg({
                        type: 'info',
                        text: res.twoFactorSetupRequired
                            ? 'Scan the QR code with your Authenticator app and enter the 6-digit code.'
                            : 'Enter the 6-digit authenticator code from your app.'
                    });
                    return;
                }
                toast('Secure session established.', 'success');
                onAuthSuccess();
            } catch (err) {
                setStatusMsg({ type: 'error', text: getFriendlyError(err) });
            } finally {
                setLoading(false);
            }
        };

        const handleTwoFactorSubmit = async (e) => {
            e.preventDefault();
            if (!twoFactorCode.trim() || !challenge) return;
            setLoading(true);
            setStatusMsg(null);

            try {
                await adminServices.auth.verify2FA(challenge.token, twoFactorCode.trim());
                toast('Two-factor verification confirmed.', 'success');
                onAuthSuccess();
            } catch (err) {
                setStatusMsg({ type: 'error', text: getFriendlyError(err) });
            } finally {
                setLoading(false);
            }
        };

        return h('div', { className: 'cr-auth-screen' },
            h('div', { className: 'cr-auth-card' },
                h('div', { className: 'cr-auth-header' },
                    h('div', { className: 'cr-brand-icon', style: { width: '48px', height: '48px', padding: '4px' } },
                        h(BrandLogo, { size: 38 })
                    ),
                    h('h1', { className: 'cr-auth-title' },
                        'Control Room ',
                        h('span', null, 'Archive')
                    ),
                    h('p', { className: 'cr-auth-sub' },
                        challenge ? 'Security Verification // Level 2' : 'Private Console // Firebase Admin Only'
                    )
                ),

                statusMsg && h('div', {
                    className: 'form-status ' + (statusMsg.type === 'error' ? 'error' : 'success'),
                    style: { textAlign: 'center', fontSize: '0.84rem' }
                }, statusMsg.text),

                !challenge ? (
                    h('form', { onSubmit: handleLoginSubmit, style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
                        h('div', { className: 'cr-form-group' },
                            h('label', { className: 'cr-form-label' }, 'Admin Email'),
                            h('input', {
                                type: 'email',
                                className: 'cr-form-input',
                                placeholder: 'admin@hunterstar.uz',
                                value: email,
                                onChange: e => setEmail(e.target.value),
                                required: true,
                                autoFocus: true
                            })
                        ),
                        h('div', { className: 'cr-form-group' },
                            h('label', { className: 'cr-form-label' }, 'Password'),
                            h('input', {
                                type: 'password',
                                className: 'cr-form-input',
                                placeholder: '••••••••••••',
                                value: password,
                                onChange: e => setPassword(e.target.value),
                                required: true
                            })
                        ),
                        h('button', {
                            type: 'submit',
                            className: 'cr-btn cr-btn-primary',
                            style: { width: '100%', padding: '12px', marginTop: '6px' },
                            disabled: loading
                        }, loading ? 'Authorizing Session...' : 'Enter Control Room')
                    )
                ) : (
                    h('form', { onSubmit: handleTwoFactorSubmit, style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
                        challenge.isSetup && challenge.qr && h('div', { style: { textAlign: 'center' } },
                            h('img', { src: challenge.qr, alt: '2FA QR Code', className: 'cr-2fa-qr' }),
                            challenge.manualKey && h('div', { className: 'cr-manual-key' },
                                String(challenge.manualKey).replace(/(.{4})/g, '$1 ').trim()
                            )
                        ),
                        h('div', { className: 'cr-form-group' },
                            h('label', { className: 'cr-form-label' }, 'Authenticator Code (6 digits)'),
                            h('input', {
                                type: 'text',
                                className: 'cr-form-input',
                                placeholder: '123456',
                                maxLength: 8,
                                inputMode: 'numeric',
                                value: twoFactorCode,
                                onChange: e => setTwoFactorCode(e.target.value),
                                required: true,
                                autoFocus: true,
                                style: { textAlign: 'center', letterSpacing: '0.2em', fontSize: '1.2rem', fontFamily: 'var(--cr-font-mono)' }
                            })
                        ),
                        h('div', { style: { display: 'flex', gap: '10px', marginTop: '6px' } },
                            h('button', {
                                type: 'button',
                                className: 'cr-btn cr-btn-secondary',
                                style: { flex: 1 },
                                onClick: () => { setChallenge(null); setTwoFactorCode(''); setStatusMsg(null); }
                            }, 'Back'),
                            h('button', {
                                type: 'submit',
                                className: 'cr-btn cr-btn-primary',
                                style: { flex: 2 },
                                disabled: loading
                            }, loading ? 'Verifying Code...' : 'Verify & Unlock')
                        )
                    )
                )
            )
        );
    }

    // =========================================================================
    // 6. WORKSPACE 1: SUBMISSIONS (INCOMING MESSAGES)
    // Interaction pattern: List -> Select -> Inspector
    // =========================================================================
    function SubmissionsWorkspace({ submissions, loading, error, toast, onConfirm }) {
        const [filter, setFilter] = useState('all'); // all, unread, read
        const [search, setSearch] = useState('');
        const [selectedId, setSelectedId] = useState(null);
        const [actionLoading, setActionLoading] = useState(false);

        const filtered = useMemo(() => {
            return (submissions || []).filter(item => {
                if (filter === 'unread' && item.read) return false;
                if (filter === 'read' && !item.read) return false;
                if (search.trim()) {
                    const q = search.trim().toLowerCase();
                    const text = `${item.name || ''} ${item.email || ''} ${item.subject || ''} ${item.message || ''}`.toLowerCase();
                    if (!text.includes(q)) return false;
                }
                return true;
            });
        }, [submissions, filter, search]);

        // Auto-select first if none selected
        useEffect(() => {
            if (filtered.length && (!selectedId || !filtered.some(s => s.id === selectedId))) {
                setSelectedId(filtered[0].id);
            } else if (!filtered.length) {
                setSelectedId(null);
            }
        }, [filtered, selectedId]);

        const selected = useMemo(() => {
            return (submissions || []).find(s => s.id === selectedId) || null;
        }, [submissions, selectedId]);

        const handleToggleRead = async () => {
            if (!selected || actionLoading) return;
            setActionLoading(true);
            const nextState = !selected.read;
            try {
                await adminServices.submissions.markRead(selected.id, nextState, selected.collectionName);
                toast(`Marked as ${nextState ? 'Read' : 'Unread'}.`, 'success');
            } catch (err) {
                toast(getFriendlyError(err), 'error');
            } finally {
                setActionLoading(false);
            }
        };

        const handleDelete = () => {
            if (!selected || actionLoading) return;
            onConfirm({
                eyebrow: 'DELETING SUBMISSION',
                title: 'Delete Message Permanently?',
                message: `Are you sure you want to delete message from "${selected.name || 'Unknown'}"? This action cannot be undone.`,
                confirmLabel: 'Delete Message',
                isDanger: true,
                onConfirm: async () => {
                    setActionLoading(true);
                    try {
                        await adminServices.submissions.delete(selected.id, selected.collectionName);
                        toast('Submission removed from archive.', 'success');
                        setSelectedId(null);
                    } catch (err) {
                        toast(getFriendlyError(err), 'error');
                    } finally {
                        setActionLoading(false);
                    }
                }
            });
        };

        return h('div', { className: 'cr-split-layout' },
            // Left Panel: Message Feed List
            h('div', { className: 'cr-panel' },
                h('div', { className: 'cr-panel-header' },
                    h('div', { className: 'cr-panel-title-group' },
                        h('span', { className: 'cr-panel-eyebrow' }, 'ARCHIVE FEED'),
                        h('h2', { className: 'cr-panel-title' }, 'Messages')
                    ),
                    h('span', { className: 'cr-badge cr-badge-accent' }, `${filtered.length} LOADED`)
                ),
                h('div', { className: 'cr-panel-body' },
                    h('div', { className: 'cr-search-bar' },
                        h('span', { className: 'cr-search-icon' }, h(Icon, { name: 'search', size: 16 })),
                        h('input', {
                            type: 'search',
                            className: 'cr-search-input',
                            placeholder: 'Search name, email, subject...',
                            value: search,
                            onChange: e => setSearch(e.target.value)
                        })
                    ),
                    h('div', { className: 'cr-filter-tabs' },
                        h('button', {
                            type: 'button',
                            className: 'cr-filter-btn ' + (filter === 'all' ? 'is-active' : ''),
                            onClick: () => setFilter('all')
                        }, `All (${submissions.length})`),
                        h('button', {
                            type: 'button',
                            className: 'cr-filter-btn ' + (filter === 'unread' ? 'is-active' : ''),
                            onClick: () => setFilter('unread')
                        }, `Unread (${submissions.filter(s => !s.read).length})`),
                        h('button', {
                            type: 'button',
                            className: 'cr-filter-btn ' + (filter === 'read' ? 'is-active' : ''),
                            onClick: () => setFilter('read')
                        }, `Read (${submissions.filter(s => s.read).length})`)
                    ),

                    loading && h('div', { className: 'cr-state-box' },
                        h('div', { className: 'cr-spinner' }),
                        h('span', { className: 'cr-state-desc' }, 'Loading live submissions from Firestore...')
                    ),

                    !loading && error && h('div', { className: 'cr-state-box' },
                        h('span', { style: { color: 'var(--cr-danger)' } }, error)
                    ),

                    !loading && !error && filtered.length === 0 && h('div', { className: 'cr-state-box' },
                        h(Icon, { name: 'inbox', size: 32 }),
                        h('span', { className: 'cr-state-title' }, 'No messages found'),
                        h('span', { className: 'cr-state-desc' }, search ? 'Try adjusting your search query.' : 'New submissions will appear here in real time.')
                    ),

                    !loading && h('div', { className: 'cr-feed-list' },
                        filtered.map(item => h('div', {
                            key: item.id,
                            className: 'cr-feed-card ' + (!item.read ? 'is-unread ' : '') + (item.id === selectedId ? 'is-active' : ''),
                            onClick: () => setSelectedId(item.id)
                        },
                            h('div', { className: 'cr-feed-head' },
                                h('span', { className: 'cr-feed-name' }, item.name || 'Anonymous'),
                                h('span', { className: 'cr-feed-date' }, item.createdAtLabel || '')
                            ),
                            h('div', { className: 'cr-feed-subject' }, item.subject || 'No Subject'),
                            h('div', { className: 'cr-feed-snippet' }, item.message || '')
                        ))
                    )
                )
            ),

            // Right Panel: Message Inspector
            h('div', { className: 'cr-panel' },
                selected ? (
                    h('div', { className: 'cr-inspector' },
                        h('div', { className: 'cr-panel-header' },
                            h('div', { className: 'cr-panel-title-group' },
                                h('span', { className: 'cr-panel-eyebrow' }, selected.subject || 'INCOMING TRANSMISSION'),
                                h('h2', { className: 'cr-panel-title' }, selected.name || 'Unknown Sender')
                            ),
                            h('span', {
                                className: 'cr-badge ' + (!selected.read ? 'cr-badge-accent' : 'cr-badge-success')
                            }, !selected.read ? 'Unread' : 'Handled')
                        ),
                        h('div', { className: 'cr-panel-body' },
                            h('div', { className: 'cr-inspector-meta' },
                                h('div', { className: 'cr-meta-item' },
                                    h('span', { className: 'cr-meta-label' }, 'Email Address'),
                                    h('span', { className: 'cr-meta-value' },
                                        selected.email
                                            ? h('a', { href: `mailto:${selected.email}` }, selected.email)
                                            : 'None provided'
                                    )
                                ),
                                h('div', { className: 'cr-meta-item' },
                                    h('span', { className: 'cr-meta-label' }, 'Received Timestamp'),
                                    h('span', { className: 'cr-meta-value' }, selected.createdAtLabel || 'Just now')
                                )
                            ),
                            h('div', { className: 'cr-inspector-message-box' },
                                h('p', { className: 'cr-message-text' }, selected.message || '')
                            ),
                            h('div', { className: 'cr-inspector-actions' },
                                h('button', {
                                    type: 'button',
                                    className: 'cr-btn ' + (!selected.read ? 'cr-btn-primary' : 'cr-btn-secondary'),
                                    onClick: handleToggleRead,
                                    disabled: actionLoading
                                },
                                    h(Icon, { name: 'check', size: 16 }),
                                    selected.read ? 'Mark as Unread' : 'Mark as Handled (Read)'
                                ),
                                h('button', {
                                    type: 'button',
                                    className: 'cr-btn cr-btn-danger',
                                    onClick: handleDelete,
                                    disabled: actionLoading
                                },
                                    h(Icon, { name: 'trash', size: 16 }),
                                    'Delete Message'
                                )
                            )
                        )
                    )
                ) : (
                    h('div', { className: 'cr-state-box' },
                        h(Icon, { name: 'inbox', size: 40 }),
                        h('span', { className: 'cr-state-title' }, 'Select a submission to inspect'),
                        h('span', { className: 'cr-state-desc' }, 'Choose an incoming message from the feed on the left to review its content, verify contact info, or mark as handled.')
                    )
                )
            )
        );
    }

    // =========================================================================
    // 7. WORKSPACE 2: CONTENT BOXES & NOTES
    // Interaction pattern: Library (Left) -> Editor (Right)
    // =========================================================================
    function ContentWorkspace({ boxes, loading, error, toast, onConfirm }) {
        const [selectedBoxId, setSelectedBoxId] = useState(null);
        const [search, setSearch] = useState('');
        
        // Form state
        const [title, setTitle] = useState('');
        const [summary, setSummary] = useState('');
        const [notes, setNotes] = useState('');
        const [linksText, setLinksText] = useState('');
        const [order, setOrder] = useState(0);
        const [published, setPublished] = useState(true);
        const [existingAttachments, setExistingAttachments] = useState([]);
        const [removedAttachments, setRemovedAttachments] = useState([]);
        const [pendingFiles, setPendingFiles] = useState([]); // [{ id, file, name, size, kind }]
        const [uploadProgress, setUploadProgress] = useState(null); // { percent, meta }
        const [saving, setSaving] = useState(false);
        const notesRef = useRef(null);
        const fileInputRef = useRef(null);

        const filteredBoxes = useMemo(() => {
            return (boxes || []).filter(b => {
                if (!search.trim()) return true;
                const q = search.trim().toLowerCase();
                return (b.title || '').toLowerCase().includes(q) || (b.summary || '').toLowerCase().includes(q);
            });
        }, [boxes, search]);

        const selectedBox = useMemo(() => {
            return (boxes || []).find(b => b.id === selectedBoxId) || null;
        }, [boxes, selectedBoxId]);

        // When a box is selected in the library, populate editor
        const handleSelectBox = (box) => {
            if (!box) {
                handleNewBox();
                return;
            }
            setSelectedBoxId(box.id);
            setTitle(box.title || '');
            setSummary(box.summary || '');
            setNotes(box.notes || '');
            setLinksText(
                Array.isArray(box.links)
                    ? box.links.map(l => (l.label && l.label !== l.url ? `${l.label} | ${l.url}` : l.url)).join('\n')
                    : ''
            );
            setOrder(Number.isFinite(Number(box.order)) ? Number(box.order) : 0);
            setPublished(Boolean(box.published));
            setExistingAttachments(Array.isArray(box.attachments) ? box.attachments.slice() : []);
            setRemovedAttachments([]);
            setPendingFiles([]);
            setUploadProgress(null);
        };

        const handleNewBox = () => {
            setSelectedBoxId(null);
            setTitle('');
            setSummary('');
            setNotes('');
            setLinksText('');
            setOrder(0);
            setPublished(true);
            setExistingAttachments([]);
            setRemovedAttachments([]);
            setPendingFiles([]);
            setUploadProgress(null);
        };

        // Text formatting helpers operating safely on plain-text selection
        const applyFormat = (prefix, suffix = prefix, placeholder = 'text') => {
            const textarea = notesRef.current;
            if (!textarea) return;
            const start = textarea.selectionStart || 0;
            const end = textarea.selectionEnd || start;
            const val = textarea.value;
            const selectedText = val.slice(start, end) || placeholder;
            const replacement = prefix + selectedText + suffix;

            const nextVal = val.slice(0, start) + replacement + val.slice(end);
            setNotes(nextVal);
            setTimeout(() => {
                textarea.focus();
                textarea.setSelectionRange(start + prefix.length, start + prefix.length + selectedText.length);
            }, 0);
        };

        const handleAddFiles = (files) => {
            const newEntries = Array.from(files || []).map(f => ({
                id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                file: f,
                name: f.name,
                size: f.size,
                kind: getFileKind(f.type, f.name)
            }));
            setPendingFiles(prev => [...prev, ...newEntries]);
        };

        const handleSave = async (e) => {
            e.preventDefault();
            if (!title.trim()) {
                toast('Box title is required.', 'error');
                return;
            }
            setSaving(true);
            setUploadProgress(null);

            try {
                // Parse links
                const parsedLinks = linksText.split('\n')
                    .map(line => line.trim())
                    .filter(Boolean)
                    .map(line => {
                        const parts = line.split('|').map(p => p.trim());
                        if (parts.length >= 2) {
                            return { label: parts[0], url: parts.slice(1).join(' | ') };
                        }
                        return { label: line, url: line };
                    });

                const payload = {
                    id: selectedBoxId,
                    title: title.trim(),
                    summary: summary.trim(),
                    notes: notes.trim(),
                    links: parsedLinks,
                    attachments: existingAttachments,
                    removedAttachments: removedAttachments,
                    files: pendingFiles.map(p => p.file),
                    order: Number(order) || 0,
                    published: Boolean(published),
                    onUploadProgress: (prog) => {
                        setUploadProgress({
                            percent: prog.percent || 0,
                            meta: `${prog.percent}% • ${prog.fileName || 'uploading'}`
                        });
                    }
                };

                const savedId = await adminServices.content.saveBox(payload);
                toast(selectedBoxId ? 'Box updated successfully.' : 'New box created.', 'success');
                setSelectedBoxId(savedId);
                setPendingFiles([]);
                setRemovedAttachments([]);
                setUploadProgress(null);
            } catch (err) {
                toast(getFriendlyError(err), 'error');
            } finally {
                setSaving(false);
            }
        };

        const handleDeleteBox = () => {
            if (!selectedBoxId || saving) return;
            onConfirm({
                eyebrow: 'DELETE CONTENT BOX',
                title: 'Delete Box Permanently?',
                message: `Are you sure you want to delete "${title || 'Untitled Box'}"? Any uploaded attachments will also be cleaned up.`,
                confirmLabel: 'Delete Box',
                isDanger: true,
                onConfirm: async () => {
                    setSaving(true);
                    try {
                        await adminServices.content.deleteBox(selectedBoxId);
                        toast('Content box deleted.', 'success');
                        handleNewBox();
                    } catch (err) {
                        toast(getFriendlyError(err), 'error');
                    } finally {
                        setSaving(false);
                    }
                }
            });
        };

        return h('div', { className: 'cr-split-layout' },
            // Left Panel: Library List
            h('div', { className: 'cr-panel' },
                h('div', { className: 'cr-panel-header' },
                    h('div', { className: 'cr-panel-title-group' },
                        h('span', { className: 'cr-panel-eyebrow' }, 'PUBLISHED LIBRARY'),
                        h('h2', { className: 'cr-panel-title' }, 'Content Boxes')
                    ),
                    h('button', {
                        type: 'button',
                        className: 'cr-btn cr-btn-primary',
                        onClick: handleNewBox
                    },
                        h(Icon, { name: 'plus', size: 14 }),
                        'New Box'
                    )
                ),
                h('div', { className: 'cr-panel-body' },
                    h('div', { className: 'cr-search-bar' },
                        h('span', { className: 'cr-search-icon' }, h(Icon, { name: 'search', size: 16 })),
                        h('input', {
                            type: 'search',
                            className: 'cr-search-input',
                            placeholder: 'Search boxes by title or summary...',
                            value: search,
                            onChange: e => setSearch(e.target.value)
                        })
                    ),

                    loading && h('div', { className: 'cr-state-box' },
                        h('div', { className: 'cr-spinner' }),
                        h('span', { className: 'cr-state-desc' }, 'Loading content library...')
                    ),

                    !loading && error && h('div', { className: 'cr-state-box' },
                        h('span', { style: { color: 'var(--cr-danger)' } }, error)
                    ),

                    !loading && !error && filteredBoxes.length === 0 && h('div', { className: 'cr-state-box' },
                        h(Icon, { name: 'layers', size: 32 }),
                        h('span', { className: 'cr-state-title' }, 'No content boxes'),
                        h('span', { className: 'cr-state-desc' }, 'Click "+ New Box" to author your first command card.')
                    ),

                    !loading && h('div', { className: 'cr-feed-list' },
                        filteredBoxes.map(b => h('div', {
                            key: b.id,
                            className: 'cr-box-item ' + (b.id === selectedBoxId ? 'is-selected' : ''),
                            onClick: () => handleSelectBox(b)
                        },
                            h('div', { className: 'cr-box-top' },
                                h('span', { className: 'cr-box-title' }, b.title || 'Untitled Box'),
                                h('span', {
                                    className: 'cr-badge ' + (b.published ? 'cr-badge-success' : 'cr-badge-muted')
                                }, b.published ? 'Published' : 'Draft')
                            ),
                            b.summary && h('div', { className: 'cr-feed-snippet', style: { paddingLeft: 0 } }, b.summary),
                            h('div', { className: 'cr-box-meta-line' },
                                h('span', null, `Order: ${b.order ?? 0}`),
                                h('span', null, `•`),
                                h('span', null, `${(b.attachments || []).length} file(s)`)
                            )
                        ))
                    )
                )
            ),

            // Right Panel: Box Editor
            h('div', { className: 'cr-panel' },
                h('div', { className: 'cr-panel-header' },
                    h('div', { className: 'cr-panel-title-group' },
                        h('span', { className: 'cr-panel-eyebrow' }, selectedBoxId ? 'EDITING ARCHIVE CARD' : 'AUTHORING NEW CARD'),
                        h('h2', { className: 'cr-panel-title' }, selectedBoxId ? (title || 'Edit Box') : 'Create New Box')
                    ),
                    selectedBoxId && h('button', {
                        type: 'button',
                        className: 'cr-btn cr-btn-danger',
                        onClick: handleDeleteBox,
                        disabled: saving
                    },
                        h(Icon, { name: 'trash', size: 14 }),
                        'Delete Box'
                    )
                ),
                h('form', { onSubmit: handleSave, className: 'cr-panel-body' },
                    h('div', { className: 'cr-form-group' },
                        h('label', { className: 'cr-form-label' }, 'Box Title *'),
                        h('input', {
                            type: 'text',
                            className: 'cr-form-input',
                            placeholder: 'e.g. Git Commands / Server Deploy',
                            value: title,
                            onChange: e => setTitle(e.target.value),
                            required: true,
                            maxLength: 120
                        })
                    ),
                    h('div', { className: 'cr-form-group' },
                        h('label', { className: 'cr-form-label' }, 'Short Summary'),
                        h('input', {
                            type: 'text',
                            className: 'cr-form-input',
                            placeholder: 'Brief summary displayed on homepage card',
                            value: summary,
                            onChange: e => setSummary(e.target.value),
                            maxLength: 180
                        })
                    ),

                    // Markdown Notes with formatting toolbar
                    h('div', { className: 'cr-form-group' },
                        h('label', { className: 'cr-form-label' }, 'Notes / Commands (Plain-text Markdown)'),
                        h('div', { className: 'cr-fmt-toolbar' },
                            h('button', { type: 'button', className: 'cr-fmt-btn', title: 'Bold (Ctrl+B)', onClick: () => applyFormat('**', '**', 'bold text') }, h('strong', null, 'B')),
                            h('button', { type: 'button', className: 'cr-fmt-btn', title: 'Italic (Ctrl+I)', onClick: () => applyFormat('*', '*', 'italic text') }, h('em', null, 'I')),
                            h('button', { type: 'button', className: 'cr-fmt-btn', title: 'Inline Code', onClick: () => applyFormat('`', '`', 'code') }, '</>'),
                            h('button', { type: 'button', className: 'cr-fmt-btn', title: 'Code Block (Ctrl+Shift+M)', onClick: () => applyFormat('```\n', '\n```', 'command') }, '```'),
                            h('button', { type: 'button', className: 'cr-fmt-btn', title: 'Quote', onClick: () => applyFormat('> ', '', 'quote') }, '>'),
                            h('button', { type: 'button', className: 'cr-fmt-btn', title: 'Bullet List', onClick: () => applyFormat('- ', '', 'item') }, '-')
                        ),
                        h('textarea', {
                            ref: notesRef,
                            rows: 6,
                            className: 'cr-form-textarea has-toolbar',
                            placeholder: 'git status\ngit commit -m "feat: control room"\ngit push origin main',
                            value: notes,
                            onChange: e => setNotes(e.target.value),
                            onKeyDown: (e) => {
                                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
                                    e.preventDefault(); applyFormat('**', '**', 'bold text');
                                } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
                                    e.preventDefault(); applyFormat('*', '*', 'italic text');
                                } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
                                    e.preventDefault(); applyFormat('```\n', '\n```', 'command');
                                }
                            }
                        })
                    ),

                    // Links
                    h('div', { className: 'cr-form-group' },
                        h('label', { className: 'cr-form-label' }, 'Useful Links (Label | URL, one per line)'),
                        h('textarea', {
                            rows: 3,
                            className: 'cr-form-textarea',
                            placeholder: 'GitHub | https://github.com/Hunters1ar\nDocs | https://example.com/docs',
                            value: linksText,
                            onChange: e => setLinksText(e.target.value)
                        })
                    ),

                    // File Attachments & Upload Dropzone
                    h('div', { className: 'cr-form-group' },
                        h('label', { className: 'cr-form-label' }, 'Archive Attachments & Files'),
                        h('div', {
                            className: 'cr-dropzone',
                            onClick: () => fileInputRef.current && fileInputRef.current.click(),
                            onDragOver: e => e.preventDefault(),
                            onDrop: e => {
                                e.preventDefault();
                                handleAddFiles(e.dataTransfer.files);
                            }
                        },
                            h('input', {
                                ref: fileInputRef,
                                type: 'file',
                                multiple: true,
                                style: { display: 'none' },
                                onChange: e => handleAddFiles(e.target.files)
                            }),
                            h('div', { className: 'cr-dropzone-icon' }, h(Icon, { name: 'upload', size: 28 })),
                            h('div', { className: 'cr-dropzone-text' }, 'Drop archive files here or click to browse'),
                            h('div', { className: 'cr-dropzone-sub' }, 'Supports images, audio, video, PDFs, archives, and executables (download-only).')
                        ),

                        uploadProgress && h('div', { className: 'cr-progress-wrap' },
                            h('div', { className: 'cr-progress-meta' },
                                h('span', null, 'Uploading files to storage...'),
                                h('span', null, uploadProgress.meta)
                            ),
                            h('div', { className: 'cr-progress-bar' },
                                h('div', { className: 'cr-progress-fill', style: { width: `${uploadProgress.percent}%` } })
                            )
                        ),

                        // List of existing + pending attachments
                        (existingAttachments.length > 0 || pendingFiles.length > 0) && h('div', { className: 'cr-attachment-list' },
                            existingAttachments.map(att => h('div', { key: att.id, className: 'cr-attachment-card' },
                                h('span', { className: `cr-attachment-badge kind-${att.kind || 'file'}` },
                                    (att.kind || 'FILE').toUpperCase()
                                ),
                                h('div', { className: 'cr-attachment-info' },
                                    h('div', { className: 'cr-attachment-name', title: att.name }, att.name),
                                    h('div', { className: 'cr-attachment-size' }, formatFileSize(att.size))
                                ),
                                att.url && h('a', {
                                    href: att.url,
                                    target: '_blank',
                                    rel: 'noopener noreferrer',
                                    download: att.kind === 'program' ? (att.name || 'file') : undefined,
                                    title: att.kind === 'program' ? 'Download' : 'Open',
                                    className: 'cr-btn cr-btn-secondary',
                                    style: { padding: '4px 8px' }
                                }, h(Icon, { name: att.kind === 'program' ? 'download' : 'external-link', size: 14 })),
                                h('button', {
                                    type: 'button',
                                    className: 'cr-btn cr-btn-danger',
                                    style: { padding: '4px 8px' },
                                    onClick: () => {
                                        setExistingAttachments(prev => prev.filter(x => x.id !== att.id));
                                        setRemovedAttachments(prev => [...prev, att]);
                                    }
                                }, h(Icon, { name: 'x', size: 14 }))
                            )),
                            pendingFiles.map(p => h('div', { key: p.id, className: 'cr-attachment-card', style: { borderStyle: 'dashed' } },
                                h('span', { className: `cr-attachment-badge kind-${p.kind}` },
                                    p.kind.toUpperCase()
                                ),
                                h('div', { className: 'cr-attachment-info' },
                                    h('div', { className: 'cr-attachment-name' }, `[Pending] ${p.name}`),
                                    h('div', { className: 'cr-attachment-size' }, formatFileSize(p.size))
                                ),
                                h('button', {
                                    type: 'button',
                                    className: 'cr-btn cr-btn-danger',
                                    style: { padding: '4px 8px' },
                                    onClick: () => setPendingFiles(prev => prev.filter(x => x.id !== p.id))
                                }, h(Icon, { name: 'x', size: 14 }))
                            ))
                        )
                    ),

                    // Order & Published Toggle
                    h('div', { style: { display: 'flex', alignItems: 'center', gap: '20px', margin: '10px 0' } },
                        h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
                            h('label', { className: 'cr-form-label', style: { margin: 0 } }, 'Sort Order:'),
                            h('input', {
                                type: 'number',
                                className: 'cr-form-input',
                                style: { width: '80px', padding: '6px 10px' },
                                value: order,
                                onChange: e => setOrder(Number(e.target.value) || 0)
                            })
                        ),
                        h('label', { style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.84rem' } },
                            h('input', {
                                type: 'checkbox',
                                checked: published,
                                onChange: e => setPublished(e.target.checked)
                            }),
                            h('span', null, 'Publish on Public Index')
                        )
                    ),

                    // Actions
                    h('div', { style: { display: 'flex', gap: '10px', marginTop: '14px' } },
                        h('button', {
                            type: 'submit',
                            className: 'cr-btn cr-btn-primary',
                            disabled: saving
                        },
                            h(Icon, { name: 'check', size: 16 }),
                            saving ? 'Saving to Archive...' : (selectedBoxId ? 'Update Box' : 'Save New Box')
                        ),
                        h('button', {
                            type: 'button',
                            className: 'cr-btn cr-btn-secondary',
                            onClick: handleNewBox,
                            disabled: saving
                        }, 'Clear Form')
                    )
                )
            )
        );
    }

    // =========================================================================
    // 8. WORKSPACE 3: YOUTUBE PLAYLISTS
    // =========================================================================
    function PlaylistsWorkspace({ playlists, loading, error, onRefresh, toast, onConfirm }) {
        const [urlInput, setUrlInput] = useState('');
        const [adding, setAdding] = useState(false);

        const handleAddPlaylist = async (e) => {
            e.preventDefault();
            const val = urlInput.trim();
            if (!val) return;
            setAdding(true);

            try {
                const res = await adminServices.playlists.add(val);
                toast(`Added playlist "${res.title || res.id}".`, 'success');
                setUrlInput('');
                onRefresh();
            } catch (err) {
                toast(getFriendlyError(err), 'error');
            } finally {
                setAdding(false);
            }
        };

        const handleRemove = (playlist) => {
            onConfirm({
                eyebrow: 'REMOVE PLAYLIST',
                title: 'Remove from Radio Gallery?',
                message: `Are you sure you want to remove "${playlist.title || playlist.id}" from the live playlist gallery?`,
                confirmLabel: 'Remove Playlist',
                isDanger: true,
                onConfirm: async () => {
                    try {
                        await adminServices.playlists.delete(playlist.id);
                        toast('Playlist removed.', 'success');
                        onRefresh();
                    } catch (err) {
                        toast(getFriendlyError(err), 'error');
                    }
                }
            });
        };

        return h('div', { className: 'cr-split-layout' },
            // Left Panel: Add Playlist
            h('div', { className: 'cr-panel' },
                h('div', { className: 'cr-panel-header' },
                    h('div', { className: 'cr-panel-title-group' },
                        h('span', { className: 'cr-panel-eyebrow' }, 'GALLERY MANAGER'),
                        h('h2', { className: 'cr-panel-title' }, 'Add Playlist')
                    )
                ),
                h('form', { onSubmit: handleAddPlaylist, className: 'cr-panel-body' },
                    h('p', { style: { fontSize: '0.82rem', color: 'var(--cr-text-secondary)', lineHeight: '1.5', margin: '0 0 10px 0' } },
                        'Paste a YouTube playlist link or ID. It will appear on the public Radio Playlist page with metadata pulled automatically.'
                    ),
                    h('div', { className: 'cr-form-group' },
                        h('label', { className: 'cr-form-label' }, 'Playlist URL or Playlist ID'),
                        h('input', {
                            type: 'text',
                            className: 'cr-form-input',
                            placeholder: 'https://www.youtube.com/playlist?list=PL...',
                            value: urlInput,
                            onChange: e => setUrlInput(e.target.value),
                            required: true
                        })
                    ),
                    h('button', {
                        type: 'submit',
                        className: 'cr-btn cr-btn-primary',
                        disabled: adding || !urlInput.trim()
                    },
                        h(Icon, { name: 'plus', size: 16 }),
                        adding ? 'Fetching & Adding...' : 'Add to Radio'
                    )
                )
            ),

            // Right Panel: Live Playlists Grid
            h('div', { className: 'cr-panel' },
                h('div', { className: 'cr-panel-header' },
                    h('div', { className: 'cr-panel-title-group' },
                        h('span', { className: 'cr-panel-eyebrow' }, 'CONFIGURED GALLERY'),
                        h('h2', { className: 'cr-panel-title' }, 'Live Playlists')
                    ),
                    h('span', { className: 'cr-badge cr-badge-accent' }, `${(playlists || []).length} ACTIVE`)
                ),
                h('div', { className: 'cr-panel-body' },
                    loading && h('div', { className: 'cr-state-box' },
                        h('div', { className: 'cr-spinner' }),
                        h('span', { className: 'cr-state-desc' }, 'Loading playlists...')
                    ),

                    !loading && error && h('div', { className: 'cr-state-box' },
                        h('span', { style: { color: 'var(--cr-danger)' } }, error)
                    ),

                    !loading && !error && (playlists || []).length === 0 && h('div', { className: 'cr-state-box' },
                        h(Icon, { name: 'youtube', size: 36 }),
                        h('span', { className: 'cr-state-title' }, 'No playlists registered'),
                        h('span', { className: 'cr-state-desc' }, 'Add your favorite YouTube anime/ambient playlist on the left.')
                    ),

                    !loading && h('div', { className: 'cr-playlist-grid' },
                        (playlists || []).map(p => h('div', { key: p.id, className: 'cr-playlist-card' },
                            h('div', null,
                                h('h4', { className: 'cr-playlist-title' }, p.title || 'YouTube Playlist'),
                                h('div', { className: 'cr-playlist-id' }, p.id)
                            ),
                            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' } },
                                h('a', {
                                    href: `https://www.youtube.com/playlist?list=${p.id}`,
                                    target: '_blank',
                                    rel: 'noopener noreferrer',
                                    className: 'cr-btn cr-btn-secondary',
                                    style: { padding: '4px 10px', fontSize: '0.74rem' }
                                },
                                    h(Icon, { name: 'external-link', size: 14 }),
                                    'YouTube'
                                ),
                                h('button', {
                                    type: 'button',
                                    className: 'cr-btn cr-btn-danger',
                                    style: { padding: '4px 10px', fontSize: '0.74rem' },
                                    onClick: () => handleRemove(p)
                                },
                                    h(Icon, { name: 'trash', size: 14 }),
                                    'Remove'
                                )
                            )
                        ))
                    )
                )
            )
        );
    }

    // =========================================================================
    // 9. ADMIN SHELL & NAVIGATION
    // =========================================================================
    function AdminShell({
        currentUser,
        activeTab,
        setActiveTab,
        isCollapsed,
        setIsCollapsed,
        isMobileOpen,
        setIsMobileOpen,
        syncState,
        onLockSession,
        onOpenCmd,
        unreadCount,
        boxCount,
        playlistCount,
        children
    }) {
        const navItems = [
            { id: 'submissions', label: 'Submissions', icon: 'inbox', badge: unreadCount > 0 ? String(unreadCount) : null, isPulse: unreadCount > 0 },
            { id: 'content', label: 'Content Boxes', icon: 'layers', badge: String(boxCount) },
            { id: 'playlists', label: 'YouTube Playlists', icon: 'youtube', badge: String(playlistCount) }
        ];

        return h('div', { className: 'cr-app-shell' },
            // Mobile Backdrop
            isMobileOpen && h('div', {
                className: 'cr-mobile-backdrop',
                onClick: () => setIsMobileOpen(false)
            }),

            // Collapsible Animated Sidebar
            h('aside', {
                className: 'cr-sidebar ' + (isCollapsed ? 'is-collapsed ' : '') + (isMobileOpen ? 'is-mobile-open' : '')
            },
                h('div', { className: 'cr-sidebar-header' },
                    h('div', { className: 'cr-sidebar-brand' },
                        h('div', { className: 'cr-brand-icon' },
                            h(BrandLogo, { size: 24 })
                        ),
                        h('div', { className: 'cr-brand-info' },
                            h('span', { className: 'cr-brand-title' }, 'Control ', h('span', null, 'Room')),
                            h('span', { className: 'cr-brand-sub' }, 'Hunterstar OS')
                        )
                    ),
                    h('button', {
                        type: 'button',
                        className: 'cr-sidebar-toggle-btn',
                        onClick: () => setIsCollapsed(!isCollapsed),
                        title: isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'
                    },
                        h(Icon, { name: isCollapsed ? 'chevron-right' : 'chevron-left', size: 14 })
                    )
                ),

                h('div', { className: 'cr-sidebar-nav' },
                    h('div', { className: 'cr-nav-heading' }, 'Workspaces'),
                    navItems.map(item => h('button', {
                        key: item.id,
                        type: 'button',
                        className: 'cr-nav-item ' + (activeTab === item.id ? 'is-active' : ''),
                        onClick: () => {
                            setActiveTab(item.id);
                            setIsMobileOpen(false);
                        }
                    },
                        h('span', { className: 'cr-nav-icon' }, h(Icon, { name: item.icon, size: 18 })),
                        h('span', { className: 'cr-nav-label' }, item.label),
                        item.badge && h('span', {
                            className: 'cr-nav-badge ' + (item.isPulse ? 'is-pulse' : '')
                        }, item.badge)
                    ))
                ),

                h('div', { className: 'cr-sidebar-footer' },
                    h('div', { className: 'cr-user-chip' },
                        h('div', { className: 'cr-user-avatar' },
                            h(UserAvatar, { user: currentUser, size: 32 })
                        ),
                        h('div', { className: 'cr-user-details' },
                            h('span', { className: 'cr-user-email' }, currentUser && currentUser.email ? currentUser.email : 'Admin User'),
                            h('span', { className: 'cr-user-role' }, 'ROOT OPERATOR')
                        )
                    ),
                    h('button', {
                        type: 'button',
                        className: 'cr-lock-btn',
                        onClick: onLockSession,
                        title: 'Lock Control Room (L)'
                    },
                        h(Icon, { name: 'lock', size: 14 }),
                        h('span', null, 'Lock Session')
                    )
                )
            ),

            // Main Area
            h('div', { className: 'cr-main-area' },
                // Topbar
                h('header', { className: 'cr-topbar' },
                    h('div', { className: 'cr-topbar-left' },
                        h('button', {
                            type: 'button',
                            className: 'cr-mobile-menu-btn',
                            onClick: () => setIsMobileOpen(true)
                        }, h(Icon, { name: 'menu', size: 18 })),
                        h('div', { className: 'cr-breadcrumb' },
                            h('span', null, 'ARCHIVE'),
                            h('span', { className: 'cr-breadcrumb-separator' }, '/'),
                            h('span', { className: 'cr-breadcrumb-active' },
                                activeTab === 'submissions' ? 'SUBMISSIONS FEED' : (activeTab === 'content' ? 'CONTENT & COMMANDS' : 'RADIO PLAYLISTS')
                            )
                        )
                    ),
                    h('div', { className: 'cr-topbar-right' },
                        // Sync Status
                        h('div', { className: `cr-sync-status is-${syncState}` },
                            h('span', { className: 'cr-sync-dot' }),
                            h('span', null, syncState === 'synced' ? '● SYNCED' : (syncState === 'syncing' ? '◐ SYNCING' : '⚠ RECONNECT'))
                        ),
                        // Command Palette Trigger
                        h('button', {
                            type: 'button',
                            className: 'cr-cmd-trigger',
                            onClick: onOpenCmd,
                            title: 'Search Commands (Ctrl+K)'
                        },
                            h(Icon, { name: 'search', size: 14 }),
                            h('span', null, 'Commands'),
                            h('span', { className: 'cr-kbd-shortcut' }, 'Ctrl+K')
                        )
                    )
                ),

                // Active Workspace Canvas
                h('main', { className: 'cr-workspace-canvas' }, children)
            )
        );
    }

    // =========================================================================
    // 10. ROOT APPLICATION (AdminApp)
    // =========================================================================
    function AdminApp() {
        const [currentUser, setCurrentUser] = useState(adminServices.auth.getCurrentUser());
        const [activeTab, setActiveTab] = useState('submissions');
        const [isCollapsed, setIsCollapsed] = useState(() => {
            try { return localStorage.getItem('cr-sidebar-collapsed') === 'true'; } catch (_) { return false; }
        });
        const [isMobileOpen, setIsMobileOpen] = useState(false);
        const [syncState, setSyncState] = useState('synced'); // synced, syncing, error
        const [cmdOpen, setCmdOpen] = useState(false);
        const [modalConfig, setModalConfig] = useState(null);
        const [toasts, setToasts] = useState([]);

        // Data states
        const [submissions, setSubmissions] = useState([]);
        const [subsLoading, setSubsLoading] = useState(false);
        const [subsError, setSubsError] = useState(null);

        const [boxes, setBoxes] = useState([]);
        const [boxesLoading, setBoxesLoading] = useState(false);
        const [boxesError, setBoxesError] = useState(null);

        const [playlists, setPlaylists] = useState([]);
        const [playlistsLoading, setPlaylistsLoading] = useState(false);
        const [playlistsError, setPlaylistsError] = useState(null);

        // Toast dispatcher
        const addToast = useCallback((message, type = 'info') => {
            const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            setToasts(prev => [...prev, { id, message, type }]);
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, 3800);
        }, []);

        const dismissToast = useCallback((id) => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, []);

        // Persist sidebar state
        useEffect(() => {
            try { localStorage.setItem('cr-sidebar-collapsed', String(isCollapsed)); } catch (_) {}
        }, [isCollapsed]);

        // Authoritative Auth State Subscription
        useEffect(() => {
            const unsub = adminServices.auth.onAuthStateChanged((user) => {
                setCurrentUser(user);
            });
            return () => unsub();
        }, []);

        // Authoritative Inactivity Check & Session Touch
        useEffect(() => {
            if (!currentUser) return;
            let idleTimer = null;
            const timeoutMs = adminServices.auth.getIdleTimeoutMs();

            const resetTimer = () => {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(async () => {
                    await adminServices.auth.expireSession();
                    addToast('Session locked after 5 minutes of inactivity.', 'warning');
                }, timeoutMs);
            };

            const handleActivity = () => {
                resetTimer();
                adminServices.auth.touchSession().catch(() => {});
            };

            ['click', 'keydown', 'mousemove', 'scroll'].forEach(evt => {
                window.addEventListener(evt, handleActivity, { passive: true, capture: true });
            });

            resetTimer();

            return () => {
                if (idleTimer) clearTimeout(idleTimer);
                ['click', 'keydown', 'mousemove', 'scroll'].forEach(evt => {
                    window.removeEventListener(evt, handleActivity);
                });
            };
        }, [currentUser, addToast]);

        // Load Submissions Feed
        useEffect(() => {
            if (!currentUser) return;
            setSubsLoading(true);
            setSyncState('syncing');
            const unsub = adminServices.submissions.subscribe(
                (data) => {
                    setSubmissions(data || []);
                    setSubsLoading(false);
                    setSubsError(null);
                    setSyncState('synced');
                },
                (err) => {
                    setSubsError(getFriendlyError(err));
                    setSubsLoading(false);
                    setSyncState('error');
                }
            );
            return () => unsub();
        }, [currentUser]);

        // Load Content Boxes Feed
        useEffect(() => {
            if (!currentUser) return;
            setBoxesLoading(true);
            setSyncState('syncing');
            const unsub = adminServices.content.subscribe(
                (data) => {
                    setBoxes(data || []);
                    setBoxesLoading(false);
                    setBoxesError(null);
                    setSyncState('synced');
                },
                (err) => {
                    setBoxesError(getFriendlyError(err));
                    setBoxesLoading(false);
                    setSyncState('error');
                }
            );
            return () => unsub();
        }, [currentUser]);

        // Load Playlists
        const refreshPlaylists = useCallback(async () => {
            if (!currentUser) return;
            setPlaylistsLoading(true);
            try {
                const list = await adminServices.playlists.list();
                setPlaylists(list || []);
                setPlaylistsError(null);
            } catch (err) {
                setPlaylistsError(getFriendlyError(err));
            } finally {
                setPlaylistsLoading(false);
            }
        }, [currentUser]);

        useEffect(() => {
            if (currentUser) {
                refreshPlaylists();
            }
        }, [currentUser, refreshPlaylists]);

        // Global Keyboard Shortcuts (Ctrl+1, Ctrl+2, Ctrl+3, Ctrl+K, L, Esc)
        useEffect(() => {
            const handleKeyDown = (e) => {
                const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
                
                // Ctrl / Cmd + K -> Command Palette
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                    e.preventDefault();
                    setCmdOpen(prev => !prev);
                    return;
                }

                // Workspace Switching (Ctrl + 1/2/3)
                if ((e.ctrlKey || e.metaKey) && !e.shiftKey) {
                    if (e.key === '1') { e.preventDefault(); setActiveTab('submissions'); }
                    else if (e.key === '2') { e.preventDefault(); setActiveTab('content'); }
                    else if (e.key === '3') { e.preventDefault(); setActiveTab('playlists'); }
                }

                // Esc to close overlays
                if (e.key === 'Escape') {
                    if (cmdOpen) setCmdOpen(false);
                    if (modalConfig) setModalConfig(null);
                }

                // L to lock session when not in an active input
                if (!isInput && (e.key === 'l' || e.key === 'L') && currentUser) {
                    e.preventDefault();
                    adminServices.auth.signOut().then(() => addToast('Session locked.', 'info'));
                }
            };

            window.addEventListener('keydown', handleKeyDown);
            return () => window.removeEventListener('keydown', handleKeyDown);
        }, [cmdOpen, modalConfig, currentUser, addToast]);

        // Lock handler
        const handleLockSession = async () => {
            await adminServices.auth.signOut();
            addToast('Control Room session signed out.', 'info');
        };

        // Command action selector
        const handleCommandAction = (actionId) => {
            if (actionId === 'submissions') setActiveTab('submissions');
            else if (actionId === 'content') setActiveTab('content');
            else if (actionId === 'playlists') setActiveTab('playlists');
            else if (actionId === 'new-box') {
                setActiveTab('content');
            } else if (actionId === 'refresh') {
                refreshPlaylists();
                addToast('Refreshing live data feeds...', 'info');
            } else if (actionId === 'lock') {
                handleLockSession();
            }
        };

        const unreadSubCount = useMemo(() => {
            return (submissions || []).filter(s => !s.read).length;
        }, [submissions]);

        return h(window.React.Fragment, null,
            // Toasts & Dialogs
            h(ToastContainer, { toasts, onDismiss: dismissToast }),
            h(ConfirmModal, { config: modalConfig, onClose: () => setModalConfig(null) }),
            h(CommandPalette, {
                isOpen: cmdOpen,
                onClose: () => setCmdOpen(false),
                onSelectAction: handleCommandAction
            }),

            // If not logged in -> Auth Gate
            !currentUser ? (
                h(AuthGate, {
                    onAuthSuccess: () => {},
                    toast: addToast
                })
            ) : (
                // Authenticated Dashboard Shell
                h(AdminShell, {
                    currentUser,
                    activeTab,
                    setActiveTab,
                    isCollapsed,
                    setIsCollapsed,
                    isMobileOpen,
                    setIsMobileOpen,
                    syncState,
                    onLockSession: handleLockSession,
                    onOpenCmd: () => setCmdOpen(true),
                    unreadCount: unreadSubCount,
                    boxCount: (boxes || []).length,
                    playlistCount: (playlists || []).length
                },
                    activeTab === 'submissions' && h(SubmissionsWorkspace, {
                        submissions,
                        loading: subsLoading,
                        error: subsError,
                        toast: addToast,
                        onConfirm: setModalConfig
                    }),
                    activeTab === 'content' && h(ContentWorkspace, {
                        boxes,
                        loading: boxesLoading,
                        error: boxesError,
                        toast: addToast,
                        onConfirm: setModalConfig
                    }),
                    activeTab === 'playlists' && h(PlaylistsWorkspace, {
                        playlists,
                        loading: playlistsLoading,
                        error: playlistsError,
                        onRefresh: refreshPlaylists,
                        toast: addToast,
                        onConfirm: setModalConfig
                    })
                )
            )
        );
    }

    // Bootstrap React mount
    function init() {
        const rootElem = document.getElementById('adminRoot');
        if (!rootElem) {
            console.error('Mount target #adminRoot missing.');
            return;
        }
        const root = window.ReactDOM.createRoot(rootElem);
        root.render(h(AdminApp));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
