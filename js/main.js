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
            label: 'Drawing back the curtain...',
            status: 'STUDY LIT',
            logIndex: 0
        },
        {
            threshold: 26,
            label: 'Arranging notes, sketches, and correspondence...',
            status: 'PAGES SORTED',
            logIndex: 1
        },
        {
            threshold: 54,
            label: 'Composing the opening impression...',
            status: 'SCENE FORMING',
            logIndex: 2
        },
        {
            threshold: 82,
            label: 'Setting every detail in its place...',
            status: 'FINAL TOUCHES',
            logIndex: 3
        },
        {
            threshold: 100,
            label: 'The portfolio is ready. Welcome in.',
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
        const magneticElements = document.querySelectorAll('.cta-button, .card-link, .social-link');

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
                    const rotateY = ((x / rect.width) - 0.5) * 8;
                    const rotateX = (0.5 - (y / rect.height)) * 8;

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
                    element.style.transform = `translate(${(x * 0.06).toFixed(1)}px, ${(y * 0.10).toFixed(1)}px)`;
                });

                element.addEventListener('pointerleave', resetElement);
                element.addEventListener('blur', resetElement);
            });
        }
    }

    initSiteInteractions();

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
        element.style.transform = 'translateY(20px)';
        element.style.transition = 'opacity 0.6s ease, transform 0.6s ease';
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
