document.getElementById('year').textContent = new Date().getFullYear();

document.addEventListener('DOMContentLoaded', () => {
    const orbs = document.querySelectorAll('.orb');
        const parallaxElements = document.querySelectorAll('.parallax-element');
    
        let ticking = false;

        function updateParallax() {
            const scrolled = window.pageYOffset;
                
            if (orbs.length >= 3) {
                orbs[0].style.transform = `translateY(${scrolled * 0.3}px)`;
                orbs[1].style.transform = `translateY(${scrolled * -0.15}px)`;
                orbs[2].style.transform = `translate(-50%, ${scrolled * 0.4}px)`;
            }

            parallaxElements.forEach(el => {
                const speed = parseFloat(el.getAttribute('data-parallax-speed')) || 0.1;
                const rect = el.getBoundingClientRect();
                    
                if (rect.top < window.innerHeight && rect.bottom > 0) {
                    const centerOffset = (rect.top + rect.height / 2) - (window.innerHeight / 2);
                    const yPos = centerOffset * speed;
                    el.style.transform = `translateY(${yPos}px)`;
                }
            });
                
            ticking = false;
        }
            
        updateParallax();

        window.addEventListener('scroll', () => {
            if (!ticking) {
                window.requestAnimationFrame(updateParallax);
                ticking = true;
            }
        }, { passive: true });

        const revealElements = document.querySelectorAll('.about-content p, .about-content h3, .about-content h4, .tech-tag, .timeline-content, .setup-card, .section-header, .exploring-list li, .ending-section p');
            
        revealElements.forEach((el, i) => {
            el.classList.add('reveal');
            if (el.classList.contains('tech-tag') || el.tagName.toLowerCase() === 'li') {
                el.style.animationDelay = `${(i % 10) * 0.05}s`;
            }
        });

        const revealObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    entry.target.classList.add('active');
                    setTimeout(() => {
                        entry.target.classList.remove('reveal', 'active');
                        entry.target.style.opacity = '1';
                        entry.target.style.animationDelay = '';
                    }, 1000);
                    revealObserver.unobserve(entry.target);
                }
            });
        }, {
            root: null,
            threshold: 0.1,
            rootMargin: '0px 0px -30px 0px'
        });

    revealElements.forEach(el => revealObserver.observe(el));
});