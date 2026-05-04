/**
 * ============================================================================
 * MAIN JAVASCRIPT
 * ============================================================================
 * Handles theme toggle, loader reveal, animations, and form submission.
 * Pure vanilla JavaScript - no frameworks required.
 * ============================================================================
 */

(function() {
    'use strict';

    // ========================================================================
    // THEME MANAGEMENT
    // ========================================================================

    const themeToggle = document.getElementById('themeToggle');

    function getStoredTheme() {
        return localStorage.getItem('portfolio-theme') || 'dark';
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);

        const metaThemeColor = document.querySelector('meta[name="theme-color"]');
        if (metaThemeColor) {
            metaThemeColor.setAttribute('content', theme === 'dark' ? '#0a0a0b' : '#f5f0e8');
        }
    }

    function toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';

        applyTheme(newTheme);
        localStorage.setItem('portfolio-theme', newTheme);
    }

    applyTheme(getStoredTheme());

    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
            if (!localStorage.getItem('portfolio-theme')) {
                applyTheme(event.matches ? 'dark' : 'light');
            }
        });
    }

    // ========================================================================
    // RESPONSIVE NAVIGATION
    // ========================================================================

    const navMenuButton = document.getElementById('navMenuButton');
    const siteNavLinks = document.getElementById('siteNavLinks');

    if (navMenuButton && siteNavLinks) {
        navMenuButton.addEventListener('click', () => {
            const isOpen = siteNavLinks.classList.toggle('is-open');
            navMenuButton.classList.toggle('is-open', isOpen);
            navMenuButton.setAttribute('aria-expanded', String(isOpen));
        });

        siteNavLinks.querySelectorAll('a').forEach((link) => {
            link.addEventListener('click', () => {
                siteNavLinks.classList.remove('is-open');
                navMenuButton.classList.remove('is-open');
                navMenuButton.setAttribute('aria-expanded', 'false');
            });
        });
    }

    // ========================================================================
    // TYPEWRITER EFFECT
    // ========================================================================

    const typewriterElement = document.getElementById('typewriter');
    const typewriterText = 'Backend Architect // AI Engineer // Fullstack Developer';
    let charIndex = 0;
    let experienceStarted = false;

    function typeWriter() {
        if (!typewriterElement) return;

        if (charIndex < typewriterText.length) {
            typewriterElement.innerHTML = typewriterText.substring(0, charIndex + 1) + '<span class="cursor"></span>';
            charIndex++;
            window.setTimeout(typeWriter, 30);
        }
    }

    function startExperience() {
        if (experienceStarted) return;

        experienceStarted = true;
        window.setTimeout(typeWriter, 140);
    }

    // ========================================================================
    // RETRO LOADER
    // ========================================================================

    const loader = document.getElementById('retroLoader');
    const loaderMeter = document.getElementById('loaderMeter');
    const loaderProgress = document.getElementById('loaderProgress');
    const loaderLabel = document.getElementById('loaderLabel');
    const loaderStatus = document.getElementById('loaderStatus');
    const loaderLogItems = Array.from(document.querySelectorAll('.retro-loader-log-item'));
    const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const loaderStages = [
        {
            threshold: 0,
            label: 'Initializing the Hunterstar interface...',
            status: 'SYSTEM ONLINE',
            logIndex: 0
        },
        {
            threshold: 26,
            label: 'Loading expertise, projects, and notes...',
            status: 'MODULES READY',
            logIndex: 1
        },
        {
            threshold: 54,
            label: 'Rendering premium portfolio motion...',
            status: 'INTERFACE HOT',
            logIndex: 2
        },
        {
            threshold: 82,
            label: 'Setting every detail in its place...',
            status: 'FRAME LOCK',
            logIndex: 3
        },
        {
            threshold: 100,
            label: 'Hunterstar is ready. Welcome in.',
            status: 'WELCOME',
            logIndex: 3
        }
    ];

    let loaderValue = 0;
    let loaderTarget = 12;
    let loaderCompleted = false;
    let loaderCompletionScheduled = false;
    const loaderStartedAt = performance.now();

    let loaderAdvanceIntervalId = null;
    let loaderRenderIntervalId = null;

    function setLoaderStage(progress) {
        if (!loaderLabel || !loaderStatus) return;

        let activeStage = loaderStages[0];

        loaderStages.forEach((stage) => {
            if (progress >= stage.threshold) {
                activeStage = stage;
            }
        });

        loaderLabel.textContent = activeStage.label;
        loaderStatus.textContent = activeStage.status;

        loaderLogItems.forEach((item, index) => {
            item.classList.toggle('is-active', index <= activeStage.logIndex);
        });
    }

    function renderLoader(progress) {
        const roundedProgress = Math.round(progress);

        if (loaderMeter) {
            loaderMeter.style.width = roundedProgress + '%';
        }

        if (loaderProgress) {
            loaderProgress.textContent = String(roundedProgress).padStart(2, '0');
        }

        setLoaderStage(roundedProgress);
    }

    function finishLoader() {
        if (!loader || loaderCompleted) {
            document.body.classList.remove('is-loading');
            startExperience();
            return;
        }

        loaderCompleted = true;

        window.clearInterval(loaderAdvanceIntervalId);
        window.clearInterval(loaderRenderIntervalId);

        loader.classList.add('is-complete');

        window.setTimeout(() => {
            document.body.classList.remove('is-loading');
            loader.remove();
            startExperience();
        }, prefersReducedMotion ? 120 : 900);
    }

    function completeLoaderWhenReady() {
        if (loaderCompletionScheduled) return;

        loaderCompletionScheduled = true;

        const minimumDuration = prefersReducedMotion ? 320 : 1800;
        const elapsed = performance.now() - loaderStartedAt;
        const remainingDelay = Math.max(0, minimumDuration - elapsed);

        window.setTimeout(() => {
            loaderTarget = 100;
        }, remainingDelay);
    }

    function initRetroLoader() {
        if (!loader) {
            document.body.classList.remove('is-loading');
            startExperience();
            return;
        }

        renderLoader(loaderValue);

        loaderAdvanceIntervalId = window.setInterval(() => {
            if (loaderCompleted || loaderTarget >= 88) return;

            const increment = prefersReducedMotion ? 18 : (Math.random() * 8) + 4;
            loaderTarget = Math.min(loaderTarget + increment, 88);
        }, prefersReducedMotion ? 100 : 220);

        loaderRenderIntervalId = window.setInterval(() => {
            if (loaderCompleted) return;

            if (loaderValue < loaderTarget) {
                const step = prefersReducedMotion ? 8 : 2;
                loaderValue = Math.min(loaderValue + step, loaderTarget);
                renderLoader(loaderValue);
            }

            if (loaderTarget === 100 && loaderValue >= 100) {
                finishLoader();
            }
        }, prefersReducedMotion ? 16 : 48);

        if (document.readyState === 'complete') {
            completeLoaderWhenReady();
        } else {
            window.addEventListener('load', completeLoaderWhenReady, { once: true });
            window.setTimeout(completeLoaderWhenReady, 4500);
        }
    }

    initRetroLoader();

    // ========================================================================
    // SMOOTH SCROLL
    // ========================================================================

    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', function(event) {
            event.preventDefault();
            const target = document.querySelector(this.getAttribute('href'));

            if (target) {
                target.scrollIntoView({
                    behavior: 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // ========================================================================
    // INTERACTIONS
    // ========================================================================

    function initSiteInteractions() {
        const supportsHover = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        const projectCards = document.querySelectorAll('.project-card');
        const magneticElements = document.querySelectorAll('.cta-button, .card-link, .social-link, .game-menu-button');

        projectCards.forEach((card) => {
            const resetCard = () => {
                card.style.setProperty('--card-rotate-x', '0deg');
                card.style.setProperty('--card-rotate-y', '0deg');
                card.style.setProperty('--spotlight-x', '50%');
                card.style.setProperty('--spotlight-y', '30%');
                card.classList.remove('is-engaged');
            };

            if (supportsHover && !prefersReducedMotion) {
                card.addEventListener('pointermove', (event) => {
                    const rect = card.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const y = event.clientY - rect.top;
                    const rotateY = ((x / rect.width) - 0.5) * 2.5;
                    const rotateX = (0.5 - (y / rect.height)) * 2.5;

                    card.style.setProperty('--card-rotate-x', `${rotateX.toFixed(2)}deg`);
                    card.style.setProperty('--card-rotate-y', `${rotateY.toFixed(2)}deg`);
                    card.style.setProperty('--spotlight-x', `${((x / rect.width) * 100).toFixed(2)}%`);
                    card.style.setProperty('--spotlight-y', `${((y / rect.height) * 100).toFixed(2)}%`);
                    card.classList.add('is-engaged');
                });

                card.addEventListener('pointerleave', resetCard);
            }

            card.addEventListener('focusin', () => card.classList.add('is-engaged'));
            card.addEventListener('focusout', () => {
                if (!card.matches(':hover')) {
                    resetCard();
                }
            });
        });

        if (supportsHover && !prefersReducedMotion) {
            magneticElements.forEach((element) => {
                const resetElement = () => {
                    element.style.transform = '';
                };

                element.addEventListener('pointermove', (event) => {
                    const rect = element.getBoundingClientRect();
                    const x = event.clientX - rect.left - rect.width / 2;
                    const y = event.clientY - rect.top - rect.height / 2;
                    element.style.transform = `translate(${(x * 0.025).toFixed(1)}px, ${(y * 0.035).toFixed(1)}px)`;
                });

                element.addEventListener('pointerleave', resetElement);
                element.addEventListener('blur', resetElement);
            });
        }
    }

    initSiteInteractions();

    // ========================================================================
    // PORTFOLIO TERMINAL
    // ========================================================================

    function initPortfolioTerminal() {
        const terminalForm = document.getElementById('portfolioTerminalForm');
        const terminalInput = document.getElementById('portfolioTerminalInput');
        const terminalLog = document.getElementById('portfolioTerminalLog');
        const commandButtons = document.querySelectorAll('[data-terminal-command]');

        if (!terminalForm || !terminalInput || !terminalLog) return;

        const history = [];
        let historyIndex = 0;

        const commands = {
            help: {
                lines: [
                    'Available commands:',
                    'whoami    - show Hunterstar profile',
                    'stack     - list core technologies',
                    'game      - open the embedded HTML5 game',
                    'projects  - jump to selected work',
                    'contact   - jump to the message form',
                    'archives  - open saved notes and tools',
                    'stats     - show quick build stats',
                    'clear     - clean this terminal'
                ]
            },
            whoami: {
                lines: [
                    'Hunterstar // Backend Architect // AI Engineer // Fullstack Developer',
                    'I build robust APIs, AI-assisted product flows, secure data layers, and polished interfaces.',
                    'Current mode: calm execution, useful details, clean shipping.'
                ]
            },
            stack: {
                lines: [
                    'Core stack: HTML, CSS, JavaScript, TypeScript, React, Next.js, Node.js, Firebase, Python, SQL, NoSQL, Three.js.',
                    'Opening the stack section...'
                ],
                target: '#stack'
            },
            game: {
                lines: [
                    'ScriptRunner 3D is embedded under the stack menu.',
                    'Opening the game console...'
                ],
                target: '#game-menu'
            },
            projects: {
                lines: [
                    'Selected work: TengdoshUstoz and EduVenture.',
                    'Opening the portfolio section...'
                ],
                target: '#projects'
            },
            contact: {
                lines: [
                    'Contact channel ready.',
                    'Opening the message form...'
                ],
                target: '#contact',
                focus: '#name'
            },
            archives: {
                lines: [
                    'Opening Hunterstar Archives...',
                    'Saved commands, notes, links, programs, and deployment tools live there.'
                ],
                navigate: 'archives.html'
            },
            stats: {
                lines: [
                    'Builds: 50+',
                    'Core stacks: 6',
                    'Experience: 3+ years',
                    'Learning mode: 24/7'
                ],
                target: '#stats'
            },
            home: {
                lines: [
                    'Returning to the hero interface...'
                ],
                target: '#hero'
            }
        };

        const aliases = {
            about: 'whoami',
            skills: 'stack',
            play: 'game',
            work: 'projects',
            mail: 'contact',
            notes: 'archives',
            cls: 'clear'
        };

        function scrollTerminalToBottom() {
            terminalLog.scrollTop = terminalLog.scrollHeight;
        }

        function appendEntry(command, lines, modifierClass) {
            const entry = document.createElement('div');
            entry.className = 'terminal-entry';

            const commandLine = document.createElement('span');
            commandLine.className = 'terminal-command';

            const path = document.createElement('span');
            path.className = 'terminal-path';
            path.textContent = 'hunterstar@portfolio:~$ ';

            commandLine.append(path, document.createTextNode(command));

            const response = document.createElement('div');
            response.className = 'terminal-response';

            if (modifierClass) {
                response.classList.add(modifierClass);
            }

            lines.forEach((line) => {
                const paragraph = document.createElement('p');
                paragraph.textContent = line;
                response.appendChild(paragraph);
            });

            entry.append(commandLine, response);
            terminalLog.appendChild(entry);
            scrollTerminalToBottom();
        }

        function runCommand(rawCommand) {
            const originalCommand = rawCommand.trim();

            if (!originalCommand) {
                terminalInput.focus();
                return;
            }

            history.push(originalCommand);
            historyIndex = history.length;

            const loweredCommand = originalCommand.toLowerCase();
            const normalizedCommand = aliases[loweredCommand] || loweredCommand;

            if (normalizedCommand === 'clear') {
                terminalLog.textContent = '';
                appendEntry('clear', ['Terminal cleared. Type help to see commands.']);
                return;
            }

            const response = commands[normalizedCommand];

            if (!response) {
                appendEntry(originalCommand, [
                    `command not found: ${originalCommand}`,
                    "Type 'help' for available commands."
                ], 'is-error');
                return;
            }

            appendEntry(originalCommand, response.lines);

            if (response.target) {
                window.setTimeout(() => {
                    const target = document.querySelector(response.target);

                    if (target) {
                        target.scrollIntoView({
                            behavior: prefersReducedMotion ? 'auto' : 'smooth',
                            block: 'start'
                        });
                    }

                    if (response.focus) {
                        const focusTarget = document.querySelector(response.focus);

                        if (focusTarget) {
                            window.setTimeout(() => focusTarget.focus({ preventScroll: true }), 450);
                        }
                    }
                }, 420);
            }

            if (response.navigate) {
                window.setTimeout(() => {
                    window.location.href = response.navigate;
                }, 700);
            }
        }

        terminalForm.addEventListener('submit', (event) => {
            event.preventDefault();
            runCommand(terminalInput.value);
            terminalInput.value = '';
        });

        terminalInput.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                historyIndex = Math.max(0, historyIndex - 1);
                terminalInput.value = history[historyIndex] || '';
                return;
            }

            if (event.key === 'ArrowDown') {
                event.preventDefault();
                historyIndex = Math.min(history.length, historyIndex + 1);
                terminalInput.value = history[historyIndex] || '';
            }
        });

        commandButtons.forEach((button) => {
            button.addEventListener('click', () => {
                const command = button.getAttribute('data-terminal-command');
                terminalInput.value = command;
                runCommand(command);
                terminalInput.value = '';
                terminalInput.focus();
            });
        });
    }

    initPortfolioTerminal();

    // ========================================================================
    // EMBEDDED GAME FRAME
    // ========================================================================

    function initEmbeddedGameFrame() {
        const gameFrame = document.getElementById('hunterstarGameFrame');
        const gameShell = gameFrame ? gameFrame.closest('.game-frame-shell') : null;
        const gamePlayButtons = document.querySelectorAll('[data-game-play]');

        if (!gameFrame || !gameShell) return;

        const embedSource = gameFrame.getAttribute('data-game-embed-src');

        function ensureGameLoaded() {
            const currentSource = gameFrame.getAttribute('src') || '';

            if (embedSource && currentSource !== embedSource) {
                gameFrame.setAttribute('src', embedSource);
            }
        }

        function focusGameFrame() {
            gameShell.classList.add('is-focused');
            gameFrame.focus();
        }

        gameFrame.addEventListener('load', () => {
            gameShell.classList.add('is-loaded');
        });

        gamePlayButtons.forEach((button) => {
            button.addEventListener('click', (event) => {
                event.preventDefault();
                ensureGameLoaded();

                gameFrame.scrollIntoView({
                    behavior: prefersReducedMotion ? 'auto' : 'smooth',
                    block: 'start'
                });

                window.setTimeout(focusGameFrame, prefersReducedMotion ? 80 : 520);
            });
        });

        gameFrame.addEventListener('blur', () => {
            gameShell.classList.remove('is-focused');
        });
    }

    initEmbeddedGameFrame();

    // ========================================================================
    // CONTACT FORM
    // ========================================================================

    const contactForm = document.getElementById('contactForm');
    const formStatus = document.getElementById('formStatus');
    const submitBtn = document.getElementById('submitBtn');

    if (contactForm) {
        contactForm.addEventListener('submit', async function(event) {
            event.preventDefault();

            const formData = {
                name: document.getElementById('name').value,
                email: document.getElementById('email').value,
                subject: document.getElementById('subject').value,
                message: document.getElementById('message').value
            };

            if (window.firebaseConfig && window.firebaseConfig.validateFormData) {
                const validation = window.firebaseConfig.validateFormData(formData);

                if (!validation.valid) {
                    showStatus(validation.error, 'error');
                    return;
                }
            }

            if (window.firebaseConfig && window.firebaseConfig.sanitizeInput) {
                formData.name = window.firebaseConfig.sanitizeInput(formData.name);
                formData.email = window.firebaseConfig.sanitizeInput(formData.email);
                formData.subject = window.firebaseConfig.sanitizeInput(formData.subject);
                formData.message = window.firebaseConfig.sanitizeInput(formData.message);
            }

            setLoading(true);

            try {
                if (window.firebaseConfig && window.firebaseConfig.submitToFirebase) {
                    const result = await window.firebaseConfig.submitToFirebase(formData);

                    if (result.success) {
                        showStatus(result.message, 'success');
                        contactForm.reset();
                    } else {
                        showStatus(result.message, 'error');
                    }
                } else {
                    await new Promise((resolve) => window.setTimeout(resolve, 1000));
                    showStatus('Message received! Configure Firebase for real submissions.', 'success');
                    contactForm.reset();
                }
            } catch (error) {
                console.error('Form submission error:', error);
                showStatus('Something went wrong. Please try again.', 'error');
            } finally {
                setLoading(false);
            }
        });
    }

    function showStatus(message, type) {
        if (!formStatus) return;

        formStatus.textContent = message;
        formStatus.className = 'form-status ' + type;
        formStatus.classList.remove('hidden');

        window.setTimeout(() => {
            formStatus.classList.add('hidden');
        }, 5000);
    }

    function setLoading(loading) {
        if (!submitBtn) return;

        submitBtn.disabled = loading;

        if (loading) {
            submitBtn.innerHTML = `
                <span class="spinner"></span>
                Sending...
            `;
        } else {
            submitBtn.innerHTML = `
                Send Message
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 2L11 13"/>
                    <path d="M22 2L15 22L11 13L2 9L22 2Z"/>
                </svg>
            `;
        }
    }

    // ========================================================================
    // PUBLIC CONTENT BOXES
    // ========================================================================

    const knowledgeSection = document.getElementById('knowledgeVault');
    const knowledgeGrid = document.getElementById('knowledgeGrid');
    const knowledgeStatus = document.getElementById('knowledgeStatus');

    function setKnowledgeStatus(message) {
        if (!knowledgeStatus) return;
        knowledgeStatus.textContent = message;
    }

    function createSafeLink(url) {
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                return null;
            }
            return parsed.toString();
        } catch (error) {
            return null;
        }
    }

    function createResourceCard(box, index) {
        const article = document.createElement('article');
        article.className = 'resource-card';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'resource-toggle';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', 'resourcePanel' + index);

        const titleGroup = document.createElement('div');
        titleGroup.className = 'resource-toggle-copy';

        const eyebrow = document.createElement('span');
        eyebrow.className = 'resource-eyebrow';
        eyebrow.textContent = box.published ? 'Published Note' : 'Draft';

        const title = document.createElement('h3');
        title.className = 'resource-title';
        title.textContent = box.title || 'Untitled Box';

        const summary = document.createElement('p');
        summary.className = 'resource-summary';
        summary.textContent = box.summary || 'Open this card to view commands, notes, and links.';

        const chevron = document.createElement('span');
        chevron.className = 'resource-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        chevron.innerHTML = '&#43;';

        titleGroup.appendChild(eyebrow);
        titleGroup.appendChild(title);
        titleGroup.appendChild(summary);
        button.appendChild(titleGroup);
        button.appendChild(chevron);

        const panel = document.createElement('div');
        panel.className = 'resource-panel';
        panel.id = 'resourcePanel' + index;
        panel.hidden = true;

        const panelInner = document.createElement('div');
        panelInner.className = 'resource-panel-inner';

        if (box.notes) {
            const notesBlock = document.createElement('div');
            notesBlock.className = 'resource-notes';

            const notesLabel = document.createElement('p');
            notesLabel.className = 'resource-block-label';
            notesLabel.textContent = 'Notes';

            const notesPre = document.createElement('pre');
            notesPre.className = 'resource-code';
            notesPre.textContent = box.notes;

            notesBlock.appendChild(notesLabel);
            notesBlock.appendChild(notesPre);
            panelInner.appendChild(notesBlock);
        }

        if (Array.isArray(box.links) && box.links.length) {
            const linksBlock = document.createElement('div');
            linksBlock.className = 'resource-links-block';

            const linksLabel = document.createElement('p');
            linksLabel.className = 'resource-block-label';
            linksLabel.textContent = 'Useful Links';
            linksBlock.appendChild(linksLabel);

            const linksList = document.createElement('div');
            linksList.className = 'resource-links';

            box.links.forEach((link) => {
                const safeUrl = createSafeLink(link.url);
                if (!safeUrl) return;

                const anchor = document.createElement('a');
                anchor.className = 'resource-link';
                anchor.href = safeUrl;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.textContent = link.label || safeUrl;
                linksList.appendChild(anchor);
            });

            if (linksList.childElementCount) {
                linksBlock.appendChild(linksList);
                panelInner.appendChild(linksBlock);
            }
        }

        if (!panelInner.childElementCount) {
            const empty = document.createElement('p');
            empty.className = 'resource-empty';
            empty.textContent = 'This box is empty right now.';
            panelInner.appendChild(empty);
        }

        panel.appendChild(panelInner);

        button.addEventListener('click', () => {
            const isOpen = button.getAttribute('aria-expanded') === 'true';
            button.setAttribute('aria-expanded', String(!isOpen));
            article.classList.toggle('is-open', !isOpen);

            if (isOpen) {
                panel.style.maxHeight = panel.scrollHeight + 'px';
                requestAnimationFrame(() => {
                    panel.style.maxHeight = '0px';
                    panel.style.opacity = '0';
                });
                window.setTimeout(() => {
                    panel.hidden = true;
                }, 320);
                return;
            }

            panel.hidden = false;
            panel.style.maxHeight = '0px';
            panel.style.opacity = '0';
            requestAnimationFrame(() => {
                panel.style.maxHeight = panel.scrollHeight + 'px';
                panel.style.opacity = '1';
            });
        });

        article.appendChild(button);
        article.appendChild(panel);
        return article;
    }

    function renderKnowledgeBoxes(boxes) {
        if (!knowledgeSection || !knowledgeGrid) return;

        const isArchivePage = document.body.classList.contains('archive-page-body');
        knowledgeGrid.innerHTML = '';

        if (!Array.isArray(boxes) || !boxes.length) {
            if (isArchivePage) {
                knowledgeSection.classList.remove('hidden');
                setKnowledgeStatus('No published boxes yet. Add one from admin.html and enable Published.');

                const empty = document.createElement('article');
                empty.className = 'resource-card archive-empty-card';
                empty.innerHTML = '<div class="resource-toggle"><div class="resource-toggle-copy"><span class="resource-eyebrow">Empty Vault</span><h3 class="resource-title">No archive elements found</h3><p class="resource-summary">Create a box in the admin panel, publish it, and it will appear here automatically.</p></div></div>';
                knowledgeGrid.appendChild(empty);
            } else {
                knowledgeSection.classList.add('hidden');
            }
            return;
        }

        boxes.forEach((box, index) => {
            knowledgeGrid.appendChild(createResourceCard(box, index));
        });

        knowledgeSection.classList.remove('hidden');
        setKnowledgeStatus(boxes.length === 1 ? '1 note published.' : boxes.length + ' notes published.');
    }

    if (window.firebaseConfig && typeof window.firebaseConfig.subscribeToPublicContentBoxes === 'function') {
        try {
            window.firebaseConfig.subscribeToPublicContentBoxes((boxes) => {
                renderKnowledgeBoxes(boxes);
            }, (error) => {
                console.warn('Public content boxes are unavailable:', error);
                if (knowledgeSection) {
                    if (document.body.classList.contains('archive-page-body')) {
                        knowledgeSection.classList.remove('hidden');
                        setKnowledgeStatus('Firebase rules are blocking the archive, or the collection is unavailable.');
                    } else {
                        knowledgeSection.classList.add('hidden');
                    }
                }
            });
        } catch (error) {
            console.warn('Public content boxes failed to initialize:', error);
            if (knowledgeSection) {
                if (document.body.classList.contains('archive-page-body')) {
                    knowledgeSection.classList.remove('hidden');
                    setKnowledgeStatus('Firebase archive failed to initialize. Check SDK scripts and config.');
                } else {
                    knowledgeSection.classList.add('hidden');
                }
            }
        }
    } else if (knowledgeSection) {
        if (document.body.classList.contains('archive-page-body')) {
            setKnowledgeStatus('Firebase content helper is missing.');
        } else {
            knowledgeSection.classList.add('hidden');
        }
    }

    // ========================================================================
    // FOOTER YEAR
    // ========================================================================

    const yearElement = document.getElementById('year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }

    // ========================================================================
    // INTERSECTION OBSERVER FOR ANIMATIONS
    // ========================================================================

    const observerOptions = {
        root: null,
        rootMargin: '0px',
        threshold: 0.1
    };

    const animationObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
                animationObserver.unobserve(entry.target);
            }
        });
    }, observerOptions);

    document.querySelectorAll('.index-card').forEach((element) => {
        element.style.opacity = '0';
        element.style.transform = 'translateY(10px)';
        element.style.transition = 'opacity 0.45s ease, transform 0.45s ease';
        animationObserver.observe(element);
    });

    document.querySelectorAll('.project-card').forEach((element) => {
        element.classList.add('reveal-ready');
        animationObserver.observe(element);
    });

    const style = document.createElement('style');
    style.textContent = `
        .index-card.animate-in {
            opacity: 1 !important;
            transform: translateY(0) !important;
        }
    `;
    document.head.appendChild(style);

    // ========================================================================
    // SPINNER STYLES
    // ========================================================================

    const spinnerStyle = document.createElement('style');
    spinnerStyle.textContent = `
        .spinner {
            display: inline-block;
            width: 18px;
            height: 18px;
            border: 2px solid transparent;
            border-top-color: currentColor;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(spinnerStyle);

})();
