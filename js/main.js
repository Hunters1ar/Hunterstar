(function() {
    'use strict';
    const consoleAsciiFallback = `

                                     ++                                    
                                    +++                                    
                            +++++++ +++ +++++++                            
                      +++++++++++++ +++ +++++++++++  ++++++                
                 +++++++++          +++              ++++++                
               ++++++               +++                  +++++             
             +++++                  +++                   ++++             
          ++++++                    ++++                   +++++++         
         +++++                     +++++                     ++++++        
        +++++         +++++++     ++++++++    +++++++        +++++++++     
        ++++           +++++++++++++++++++++++++++++        ++++++++++++   
   ++++ +++ ++++          +++++++++++++++++++++++           +++ +++  +++   
 ++++   +++   +++++ +++++++  ++++++++++++++++++  +++++++  +++++ +++  ++++  
  ++++  +++  ++++++ +++++++  ++++++++++++++++++  +++++++  +++++ +++  ++++  
    +++ +++ ++++          +++++++++++++++++++++++           +++ +++ ++++   
        ++++            +++++++++++++++++++++++++++         ++++++++++++   
        +++++         ++++++      ++++++++     ++++++        +++++ +++     
         +++++                     +++++                      +++++        
          ++++++                    ++++                    +++++          
            ++++++                   ++                  ++++++            
              +++++++               +++               +++++++              
                 +++++++++          +++          ++++++++++                
                     +++++++++++    +++    ++++++++++++                    
                         ++++++++++ +++ ++++++++++                         
                                    +++                                    
                                     ++                                    
                                                                           
                                  `;

    const consoleProfileLines = [
        'Backend Architect // AI Engineer // Fullstack Developer',
        'AI systems | secure APIs | Firebase | SQL | NoSQL | polished web apps',
        'GitHub   https://github.com/Hunters1ar',
        'LinkedIn https://www.linkedin.com/in/khurshidkhursandov',
        'Telegram https://t.me/Hunters1ar'
    ];

    function printConsoleSignature(asciiArt) {
        const ascii = '\n' + String(asciiArt || consoleAsciiFallback).trimEnd() + '\n';
        const title = 'HUNTERSTAR // PORTFOLIO CONSOLE';

        const fontStack = 'font-family:"JetBrains Mono",Consolas,monospace;';
        const asciiStyle = [
            fontStack,
            'color:#7eefff',
            'font-size:12px',
            'line-height:1.22',
            'text-shadow:0 0 8px rgba(126,239,255,0.58)'
        ].join(';');
        const titleStyle = [
            fontStack,
            'color:#d9fbff',
            'font-size:13px',
            'font-weight:700',
            'letter-spacing:0.1em',
            'text-shadow:0 0 10px rgba(126,239,255,0.45)'
        ].join(';');
        const infoStyle = [
            fontStack,
            'color:#8fefff',
            'font-size:12px',
            'line-height:1.45'
        ].join(';');
        const mutedStyle = [
            fontStack,
            'color:#8a9aa3',
            'font-size:11px',
            'line-height:1.4'
        ].join(';');

        const divider = '-'.repeat(70);

        console.log('%c' + ascii, asciiStyle);
        console.log('%c' + title, titleStyle);
        console.log('%c' + consoleProfileLines.join('\n'), infoStyle);
        console.log('%c' + divider, mutedStyle);
    }

    function initConsoleSignature() {
        if (typeof fetch !== 'function') {
            printConsoleSignature(consoleAsciiFallback);
            return;
        }

        fetch('ascii.txt?v=clean-console-signature', { cache: 'reload' })
            .then((response) => {
                if (!response.ok) {
                    throw new Error('Unable to load ascii.txt');
                }

                return response.text();
            })
            .then(printConsoleSignature)
            .catch(() => {
                printConsoleSignature(consoleAsciiFallback);
            });
    }

    initConsoleSignature();

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


    function initProjectsCarousel() {
        document.querySelectorAll('[data-carousel]').forEach((carousel) => {
            const track = carousel.querySelector('[data-carousel-track]');
            if (!track) return;

            const cards = Array.from(track.querySelectorAll('.project-card'));
            if (!cards.length) return;

            const prevBtn = carousel.querySelector('[data-carousel-prev]');
            const nextBtn = carousel.querySelector('[data-carousel-next]');
            const dotsContainer = carousel.querySelector('[data-carousel-dots]');
            const scrollBehavior = prefersReducedMotion ? 'auto' : 'smooth';

            const dots = [];
            if (dotsContainer) {
                dotsContainer.innerHTML = '';
                cards.forEach((card, index) => {
                    const dot = document.createElement('button');
                    dot.type = 'button';
                    dot.className = 'carousel-dot';
                    dot.setAttribute('role', 'tab');
                    dot.setAttribute('aria-label', `Go to project ${index + 1}`);
                    dot.addEventListener('click', () => { scrollToCard(index); restartAuto(); });
                    dotsContainer.appendChild(dot);
                    dots.push(dot);
                });
            }
            const offsetFor = (index) => cards[index].offsetLeft - cards[0].offsetLeft;

            function scrollToCard(index) {
                const clamped = Math.max(0, Math.min(index, cards.length - 1));
                track.scrollTo({ left: offsetFor(clamped), behavior: scrollBehavior });
            }

            function currentIndex() {
                const sl = track.scrollLeft;
                let best = 0;
                let bestDist = Infinity;
                cards.forEach((card, i) => {
                    const dist = Math.abs(offsetFor(i) - sl);
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = i;
                    }
                });
                return best;
            }

            function update() {
                const maxScroll = track.scrollWidth - track.clientWidth;
                const canScroll = maxScroll > 2;
                const atStart = track.scrollLeft <= 2;
                const atEnd = track.scrollLeft >= maxScroll - 2;

                carousel.classList.toggle('is-static', !canScroll);
                if (prevBtn) prevBtn.disabled = !canScroll || atStart;
                if (nextBtn) nextBtn.disabled = !canScroll || atEnd;

                const active = currentIndex();
                dots.forEach((dot, i) => {
                    const isActive = i === active;
                    dot.classList.toggle('is-active', isActive);
                    dot.setAttribute('aria-selected', isActive ? 'true' : 'false');
                });

                refreshAuto();
            }

            if (prevBtn) prevBtn.addEventListener('click', () => { scrollToCard(currentIndex() - 1); restartAuto(); });
            if (nextBtn) nextBtn.addEventListener('click', () => { scrollToCard(currentIndex() + 1); restartAuto(); });

            track.addEventListener('keydown', (event) => {
                if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    scrollToCard(currentIndex() + 1);
                    restartAuto();
                } else if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    scrollToCard(currentIndex() - 1);
                    restartAuto();
                }
            });

            let scrollRaf = null;
            track.addEventListener('scroll', () => {
                if (scrollRaf) return;
                scrollRaf = requestAnimationFrame(() => {
                    scrollRaf = null;
                    update();
                });
            }, { passive: true });

            window.addEventListener('resize', update);
            window.addEventListener('load', update);

            cards.forEach((card) => card.classList.add('reveal-ready'));
            const revealCards = () => {
                cards.forEach((card, i) => {
                    window.setTimeout(() => card.classList.add('animate-in'), prefersReducedMotion ? 0 : i * 90);
                });
            };

            if ('IntersectionObserver' in window) {
                const revealObserver = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => {
                        if (!entry.isIntersecting) return;
                        revealCards();
                        revealObserver.disconnect();
                    });
                }, { threshold: 0.15 });
                revealObserver.observe(carousel);
            } else {
                revealCards();
            }

            const AUTOPLAY_MS = 4500;
            let autoTimer = null;
            let inView = true;
            let paused = false;

            function canAutoplay() {
                return !prefersReducedMotion
                    && !carousel.classList.contains('is-static')
                    && inView
                    && !paused
                    && !document.hidden;
            }

            function stopAuto() {
                if (autoTimer) {
                    window.clearInterval(autoTimer);
                    autoTimer = null;
                }
            }

            function startAuto() {
                if (autoTimer || !canAutoplay()) return;
                autoTimer = window.setInterval(() => {
                    const i = currentIndex();
                    scrollToCard(i >= cards.length - 1 ? 0 : i + 1);
                }, AUTOPLAY_MS);
            }

            function refreshAuto() {
                if (canAutoplay()) startAuto();
                else stopAuto();
            }

            function restartAuto() {
                stopAuto();
                startAuto();
            }

            const pause = () => { paused = true; refreshAuto(); };
            const resume = () => { paused = false; refreshAuto(); };

            carousel.addEventListener('pointerenter', pause);
            carousel.addEventListener('pointerleave', resume);
            carousel.addEventListener('focusin', pause);
            carousel.addEventListener('focusout', (event) => {
                if (!carousel.contains(event.relatedTarget)) resume();
            });
            track.addEventListener('pointerdown', pause);
            window.addEventListener('pointerup', () => {
                if (paused && !carousel.matches(':hover')) resume();
            });
            document.addEventListener('visibilitychange', refreshAuto);

            if ('IntersectionObserver' in window) {
                const inViewObserver = new IntersectionObserver((entries) => {
                    entries.forEach((entry) => { inView = entry.isIntersecting; });
                    refreshAuto();
                }, { threshold: 0.25 });
                inViewObserver.observe(carousel);
            }

            update();
            refreshAuto();
        });
    }

    initProjectsCarousel();


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
                    'archives  - reveal the server room portal',
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
                    'Archive route moved behind the server room.',
                    'Opening the secure room portal...'
                ],
                target: '#server-room'
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

    function formatArchiveFileSize(size) {
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

    function getArchiveAttachmentKind(contentType, fileName) {
        if (window.firebaseConfig && typeof window.firebaseConfig.getAttachmentKind === 'function') {
            return window.firebaseConfig.getAttachmentKind(contentType, fileName);
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

    function getArchiveAttachmentLabel(attachment) {
        const name = attachment.name || 'Archive file';
        const extensionMatch = name.match(/\.([a-z0-9]{1,8})$/i);
        if (extensionMatch) return extensionMatch[1].toUpperCase();
        return (attachment.kind || 'FILE').toUpperCase();
    }

    function createArchiveAttachmentCard(attachment) {
        const safeUrl = createSafeLink(attachment.url);
        if (!safeUrl) return null;

        const kind = attachment.kind || getArchiveAttachmentKind(attachment.contentType, attachment.name);
        const item = document.createElement('article');
        item.className = 'resource-attachment-card';

        const preview = document.createElement('div');
        preview.className = 'resource-attachment-preview';

        if (kind === 'image') {
            const image = document.createElement('img');
            image.src = safeUrl;
            image.alt = attachment.name || 'Archive image';
            image.loading = 'lazy';
            preview.appendChild(image);
        } else if (kind === 'video') {
            const video = document.createElement('video');
            video.src = safeUrl;
            video.controls = true;
            video.preload = 'metadata';
            preview.appendChild(video);
        } else if (kind === 'audio') {
            const audio = document.createElement('audio');
            audio.src = safeUrl;
            audio.controls = true;
            audio.preload = 'metadata';
            preview.appendChild(audio);
        } else if (kind === 'pdf') {
            const frame = document.createElement('iframe');
            frame.src = safeUrl;
            frame.title = attachment.name || 'Archive PDF preview';
            frame.loading = 'lazy';
            preview.appendChild(frame);
        } else {
            const fallback = document.createElement('span');
            fallback.className = 'resource-attachment-fallback';
            fallback.textContent = getArchiveAttachmentLabel(attachment);
            preview.appendChild(fallback);
        }

        const body = document.createElement('div');
        body.className = 'resource-attachment-body';

        const name = document.createElement('h4');
        name.className = 'resource-attachment-name';
        name.textContent = attachment.name || 'Archive file';

        const meta = document.createElement('p');
        meta.className = 'resource-attachment-meta';
        meta.textContent = [
            formatArchiveFileSize(attachment.size),
            attachment.contentType || 'application/octet-stream'
        ].filter(Boolean).join(' - ');

        const link = document.createElement('a');
        link.className = 'resource-link resource-attachment-link';
        link.href = safeUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        if (kind === 'program') {
            link.download = attachment.name || 'archive-file';
        }
        link.textContent = kind === 'program' ? 'Download File' : 'Open File';

        const downloadLink = document.createElement('a');
        downloadLink.className = 'resource-link resource-attachment-link resource-attachment-download';
        downloadLink.href = safeUrl;
        downloadLink.download = attachment.name || 'archive-file';
        downloadLink.rel = 'noopener noreferrer';
        downloadLink.textContent = 'Download';

        const actions = document.createElement('div');
        actions.className = 'resource-attachment-actions';
        actions.appendChild(link);
        actions.appendChild(downloadLink);

        body.appendChild(name);
        body.appendChild(meta);
        body.appendChild(actions);
        item.appendChild(preview);
        item.appendChild(body);
        return item;
    }

    function copyTextToClipboard(text) {
        const payload = String(text || '');

        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(payload);
        }

        return new Promise((resolve, reject) => {
            const textarea = document.createElement('textarea');
            textarea.value = payload;
            textarea.setAttribute('readonly', '');
            textarea.style.position = 'fixed';
            textarea.style.top = '-9999px';
            textarea.style.left = '-9999px';

            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();

            try {
                const copied = document.execCommand('copy');
                if (!copied) {
                    throw new Error('Copy command was blocked.');
                }

                resolve();
            } catch (error) {
                reject(error);
            } finally {
                textarea.remove();
            }
        });
    }

    function normalizeFencedCode(rawContent) {
        let content = String(rawContent || '').replace(/\r\n/g, '\n').replace(/^\n|\n$/g, '');
        let label = 'Command';
        const firstLineBreak = content.indexOf('\n');

        if (firstLineBreak > -1) {
            const firstLine = content.slice(0, firstLineBreak).trim();

            if (/^[a-z0-9_+.#-]{1,24}$/i.test(firstLine)) {
                label = firstLine.toUpperCase();
                content = content.slice(firstLineBreak + 1);
            }
        }

        return {
            label,
            text: content.trim()
        };
    }

    function parseResourceNotes(notes) {
        const source = String(notes || '');
        const segments = [];
        const fencePattern = /```([\s\S]*?)```/g;
        let cursor = 0;
        let match;

        while ((match = fencePattern.exec(source))) {
            if (match.index > cursor) {
                segments.push({
                    type: 'text',
                    text: source.slice(cursor, match.index)
                });
            }

            const fencedCode = normalizeFencedCode(match[1]);
            if (fencedCode.text) {
                segments.push({
                    type: 'code',
                    label: fencedCode.label,
                    text: fencedCode.text
                });
            }

            cursor = fencePattern.lastIndex;
        }

        if (cursor < source.length) {
            segments.push({
                type: 'text',
                text: source.slice(cursor)
            });
        }

        return segments;
    }

    function createPlainNotesBlock(text) {
        const notesPre = document.createElement('pre');
        notesPre.className = 'resource-code';
        notesPre.textContent = text;
        return notesPre;
    }

    function textHasRichFormatting(text) {
        const source = String(text || '');

        return /(\*\*[^*]+?\*\*)|(__[^_]+?__)|(~~[\s\S]+?~~)|(`[^`\n]+?`)|(\*[^*\n]+?\*)/.test(source)
            || /^\s*(?:-\s+|>\s?)/m.test(source)
            || /(?:https?:\/\/|www\.)[^\s<>"'`]+/i.test(source);
    }

    function splitAutolinkToken(token) {
        let urlText = String(token || '');
        let suffix = '';

        while (/[.,;:!?]$/.test(urlText)) {
            suffix = urlText.slice(-1) + suffix;
            urlText = urlText.slice(0, -1);
        }

        return {
            urlText,
            suffix
        };
    }

    function appendLinkedText(parent, text) {
        const source = String(text || '');
        const urlPattern = /(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
        let cursor = 0;
        let match;

        while ((match = urlPattern.exec(source))) {
            if (match.index > cursor) {
                parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
            }

            const rawToken = match[0];
            const autolink = splitAutolinkToken(rawToken);
            const hrefText = autolink.urlText.toLowerCase().startsWith('www.')
                ? 'https://' + autolink.urlText
                : autolink.urlText;
            const safeUrl = createSafeLink(hrefText);

            if (safeUrl && autolink.urlText) {
                const anchor = document.createElement('a');
                anchor.className = 'resource-note-link';
                anchor.href = safeUrl;
                anchor.target = '_blank';
                anchor.rel = 'noopener noreferrer';
                anchor.textContent = autolink.urlText;
                parent.appendChild(anchor);

                if (autolink.suffix) {
                    parent.appendChild(document.createTextNode(autolink.suffix));
                }
            } else {
                parent.appendChild(document.createTextNode(rawToken));
            }

            cursor = urlPattern.lastIndex;
        }

        if (cursor < source.length) {
            parent.appendChild(document.createTextNode(source.slice(cursor)));
        }
    }

    function appendInlineFormattedText(parent, text) {
        const source = String(text || '');
        const pattern = /(\*\*([\s\S]+?)\*\*)|(__([\s\S]+?)__)|(~~([\s\S]+?)~~)|(`([^`\n]+?)`)|(\*([^*\n]+?)\*)/g;
        let cursor = 0;
        let match;

        while ((match = pattern.exec(source))) {
            if (match.index > cursor) {
                appendLinkedText(parent, source.slice(cursor, match.index));
            }

            let element;
            let content = '';
            let shouldAutolink = true;

            if (match[2]) {
                element = document.createElement('strong');
                content = match[2];
            } else if (match[4]) {
                element = document.createElement('span');
                element.className = 'resource-note-underline';
                content = match[4];
            } else if (match[6]) {
                element = document.createElement('s');
                content = match[6];
            } else if (match[8]) {
                element = document.createElement('code');
                element.className = 'resource-note-inline-code';
                content = match[8];
                shouldAutolink = false;
            } else {
                element = document.createElement('em');
                content = match[10] || '';
            }

            if (shouldAutolink) {
                appendLinkedText(element, content);
            } else {
                element.textContent = content;
            }

            parent.appendChild(element);
            cursor = pattern.lastIndex;
        }

        if (cursor < source.length) {
            appendLinkedText(parent, source.slice(cursor));
        }
    }

    function createFormattedParagraph(lines) {
        const paragraph = document.createElement('p');
        paragraph.className = 'resource-note-text';
        appendInlineFormattedText(paragraph, lines.join('\n').trim());
        return paragraph;
    }

    function createFormattedList(lines) {
        const list = document.createElement('ul');
        list.className = 'resource-note-list';

        lines.forEach((line) => {
            const item = document.createElement('li');
            appendInlineFormattedText(item, line.replace(/^\s*-\s+/, '').trim());
            list.appendChild(item);
        });

        return list;
    }

    function createFormattedQuote(lines) {
        const quote = document.createElement('blockquote');
        quote.className = 'resource-note-quote';
        const quoteText = lines.map((line) => line.replace(/^\s*>\s?/, '')).join('\n').trim();
        appendInlineFormattedText(quote, quoteText);
        return quote;
    }

    function appendResourceTextBlocks(container, text) {
        const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
        let paragraphLines = [];
        let listLines = [];
        let quoteLines = [];

        const flushParagraph = () => {
            if (!paragraphLines.length) return;
            container.appendChild(createFormattedParagraph(paragraphLines));
            paragraphLines = [];
        };

        const flushList = () => {
            if (!listLines.length) return;
            container.appendChild(createFormattedList(listLines));
            listLines = [];
        };

        const flushQuote = () => {
            if (!quoteLines.length) return;
            container.appendChild(createFormattedQuote(quoteLines));
            quoteLines = [];
        };

        lines.forEach((line) => {
            if (!line.trim()) {
                flushParagraph();
                flushList();
                flushQuote();
                return;
            }

            if (/^\s*-\s+/.test(line)) {
                flushParagraph();
                flushQuote();
                listLines.push(line);
                return;
            }

            if (/^\s*>\s?/.test(line)) {
                flushParagraph();
                flushList();
                quoteLines.push(line);
                return;
            }

            flushList();
            flushQuote();
            paragraphLines.push(line);
        });

        flushParagraph();
        flushList();
        flushQuote();
    }

    function createCopyableCodeBlock(segment) {
        const block = document.createElement('div');
        block.className = 'resource-copy-block';

        const header = document.createElement('div');
        header.className = 'resource-copy-head';

        const label = document.createElement('span');
        label.className = 'resource-copy-label';
        label.textContent = segment.label || 'Command';

        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'resource-copy-button';
        copyButton.textContent = 'Copy';

        const pre = document.createElement('pre');
        pre.className = 'resource-code resource-copy-code';
        pre.tabIndex = 0;
        pre.setAttribute('role', 'button');
        pre.setAttribute('aria-label', 'Copy code block');

        const code = document.createElement('code');
        code.textContent = segment.text;
        pre.appendChild(code);

        let feedbackTimer = null;

        const setFeedback = (text, className) => {
            window.clearTimeout(feedbackTimer);
            block.classList.remove('is-copied', 'is-error');
            if (className) block.classList.add(className);
            copyButton.textContent = text;

            feedbackTimer = window.setTimeout(() => {
                block.classList.remove('is-copied', 'is-error');
                copyButton.textContent = 'Copy';
            }, 1400);
        };

        const handleCopy = async () => {
            copyButton.disabled = true;

            try {
                await copyTextToClipboard(segment.text);
                setFeedback('Copied', 'is-copied');
            } catch (error) {
                console.warn('Unable to copy archive code block:', error);
                setFeedback('Failed', 'is-error');
            } finally {
                copyButton.disabled = false;
            }
        };

        copyButton.addEventListener('click', (event) => {
            event.stopPropagation();
            handleCopy();
        });

        pre.addEventListener('click', handleCopy);
        pre.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            handleCopy();
        });

        header.appendChild(label);
        header.appendChild(copyButton);
        block.appendChild(header);
        block.appendChild(pre);
        return block;
    }

    function createResourceNotesContent(notes) {
        const segments = parseResourceNotes(notes);
        const hasCopyBlocks = segments.some((segment) => segment.type === 'code');
        const hasRichFormatting = segments.some((segment) => segment.type === 'text' && textHasRichFormatting(segment.text));

        if (!hasCopyBlocks && !hasRichFormatting) {
            return createPlainNotesBlock(notes);
        }

        const richNotes = document.createElement('div');
        richNotes.className = 'resource-note-rich';

        segments.forEach((segment) => {
            if (segment.type === 'code') {
                richNotes.appendChild(createCopyableCodeBlock(segment));
                return;
            }

            appendResourceTextBlocks(richNotes, segment.text);
        });

        return richNotes.childElementCount ? richNotes : createPlainNotesBlock(notes);
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
        const attachmentCount = Array.isArray(box.attachments) ? box.attachments.length : 0;
        eyebrow.textContent = attachmentCount
            ? attachmentCount + (attachmentCount === 1 ? ' File' : ' Files')
            : (box.published ? 'Published Note' : 'Draft');

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

            notesBlock.appendChild(notesLabel);
            notesBlock.appendChild(createResourceNotesContent(box.notes));
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

        if (Array.isArray(box.attachments) && box.attachments.length) {
            const filesBlock = document.createElement('div');
            filesBlock.className = 'resource-attachments-block';

            const filesLabel = document.createElement('p');
            filesLabel.className = 'resource-block-label';
            filesLabel.textContent = 'Files';
            filesBlock.appendChild(filesLabel);

            const filesGrid = document.createElement('div');
            filesGrid.className = 'resource-attachments-grid';

            box.attachments.forEach((attachment) => {
                const card = createArchiveAttachmentCard(attachment);
                if (card) {
                    filesGrid.appendChild(card);
                }
            });

            if (filesGrid.childElementCount) {
                filesBlock.appendChild(filesGrid);
                panelInner.appendChild(filesBlock);
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
                        setKnowledgeStatus('Archive API is temporarily unavailable. Please try again soon.');
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
                    setKnowledgeStatus('Archive loader failed to initialize. Please try again soon.');
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


    const yearElement = document.getElementById('year');
    if (yearElement) {
        yearElement.textContent = new Date().getFullYear();
    }


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
        if (element.closest('[data-carousel]')) return;
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


    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js').then((registration) => {
                console.log('ServiceWorker registration successful with scope: ', registration.scope);
            }).catch((error) => {
                console.log('ServiceWorker registration failed: ', error);
            });
        });
    }

})();
