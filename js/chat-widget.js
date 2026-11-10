/* The companion is the chat launcher; answers stay beside the character. */
(() => {
    'use strict';
    const PET_API = 'https://image.hunterstar.uz/api/pet/chat';

    async function readReply(response, onToken, signal) {
        if (!response.headers?.get('content-type')?.includes('text/event-stream')) {
            const data = await response.json();
            return { ...data, answer: data?.data?.choices?.[0]?.message?.content };
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '', answer = '', completed = false;
        try {
            while (!completed) {
                const { value, done } = await reader.read();
                if (signal.aborted) throw new Error('Chat request cancelled');
                buffer += decoder.decode(value, { stream: !done });
                if (buffer.length > 65536) throw new Error('Invalid chat stream');
                let boundary;
                while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
                    const frame = buffer.slice(0, boundary.index);
                    buffer = buffer.slice(boundary.index + boundary[0].length);
                    const lines = frame.split(/\r?\n/);
                    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
                    const raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
                    if (!raw) continue;
                    const data = JSON.parse(raw);
                    if (event === 'error') return data;
                    if (event === 'token' && typeof data.token === 'string') {
                        answer += data.token;
                        if (answer.length > 16000) throw new Error('Invalid chat stream');
                        onToken(answer);
                    } else if (event === 'done') {
                        if (!data.ok || !answer.trim()) throw new Error('Empty chat stream');
                        completed = true;
                        break;
                    }
                }
                if (done && !completed) throw new Error('Incomplete chat stream');
            }
            return { ok: true, answer };
        } finally {
            try { await reader.cancel(); } finally { reader.releaseLock(); }
        }
    }

    function mount() {
        const dialog = document.createElement('dialog');
        dialog.id = 'petTalkDialog';
        dialog.className = 'pet-talk-dialog';
        dialog.setAttribute('aria-labelledby', 'petTalkTitle');
        dialog.innerHTML = `
            <form class="pet-talk-form">
                <div class="pet-talk-heading">
                    <h2 id="petTalkTitle">Talk to Hunterstar</h2>
                    <button type="button" data-chat="cancel" class="pet-chat-close" aria-label="Close message dialog">×</button>
                </div>
                <label for="petTalkInput">What's on your mind?</label>
                <textarea id="petTalkInput" rows="3" maxlength="2000" placeholder="Ask about my work, projects, or stack…" required autofocus></textarea>
                <p class="pet-talk-hint">Enter to send · Shift + Enter for a new line</p>
                <div class="pet-talk-actions">
                    <button type="button" data-chat="cancel">Cancel</button>
                    <button type="submit" class="pet-talk-send">Send message <span aria-hidden="true">↗</span></button>
                </div>
            </form>`;

        const bubble = document.createElement('section');
        bubble.className = 'pet-speech';
        bubble.hidden = true;
        bubble.setAttribute('aria-label', 'Hunterstar reply');
        bubble.innerHTML = `
            <button type="button" class="pet-chat-close" data-chat="dismiss" aria-label="Dismiss reply">×</button>
            <div class="pet-speech-text" role="status" aria-live="polite" aria-atomic="true" tabindex="0"></div>
            <div class="pet-speech-footer">
                <span class="pet-speech-name">Little Hunterstar</span>
                <nav class="pet-speech-history" aria-label="Previous replies">
                    <button type="button" data-chat="previous" aria-label="Previous reply">←</button>
                    <span class="pet-speech-count"></span>
                    <button type="button" data-chat="next" aria-label="Next reply">→</button>
                </nav>
                <button type="button" data-chat="ask">Ask again</button>
            </div>`;
        document.body.append(dialog, bubble);

        const form = dialog.querySelector('form');
        const input = dialog.querySelector('textarea');
        const text = bubble.querySelector('.pet-speech-text');
        const historyNav = bubble.querySelector('nav');
        const counter = bubble.querySelector('.pet-speech-count');
        const previous = bubble.querySelector('[data-chat="previous"]');
        const next = bubble.querySelector('[data-chat="next"]');
        const ask = bubble.querySelector('[data-chat="ask"]');
        const dismissButton = bubble.querySelector('[data-chat="dismiss"]');
        let pet = null;
        let request = null;
        let messages = [];
        const replies = [];
        let replyIndex = -1;
        let restoreReplyOnClose = false;
        let replyTimer = null;

        function clearReplyTimer() {
            clearTimeout(replyTimer);
            replyTimer = null;
        }

        function syncPet() {
            document.dispatchEvent(new CustomEvent('hunterstar:chat-state', {
                detail: { active: dialog.open || (!bubble.hidden && bubble.dataset.mode !== 'comment'), thinking: Boolean(request) }
            }));
        }

        function setBubbleMode(mode) {
            bubble.dataset.mode = mode;
            bubble.setAttribute('aria-label', mode === 'comment' ? 'Hunterstar comment' : 'Hunterstar reply');
            dismissButton.setAttribute('aria-label', mode === 'comment' ? 'Dismiss comment' : 'Dismiss reply');
            ask.textContent = mode === 'comment' ? 'Talk' : 'Ask again';
        }

        function layoutBubble() {
            if (bubble.hidden || !pet || pet.hidden) return;
            const rect = pet.getBoundingClientRect();
            const width = bubble.offsetWidth, height = bubble.offsetHeight;
            const center = rect.left + rect.width / 2;
            const left = Math.max(12, Math.min(innerWidth - width - 12, center - width * .3));
            const above = rect.top - height + 28;
            const below = rect.bottom + 12;
            const fitsBelow = below + height <= innerHeight - 12;
            const placement = above < 12 && fitsBelow ? 'below' : 'above';
            const top = placement === 'below' ? below : Math.max(12, Math.min(innerHeight - height - 12, above));
            bubble.style.left = `${left}px`;
            bubble.style.top = `${top}px`;
            bubble.style.setProperty('--pet-tail-left', `${Math.max(22, Math.min(width - 22, center - left))}px`);
            bubble.dataset.placement = placement;
        }

        function showReply() {
            const reply = replies[replyIndex];
            if (!reply) return;
            clearReplyTimer();
            setBubbleMode('reply');
            bubble.hidden = false;
            bubble.dataset.error = String(reply.error);
            bubble.removeAttribute('aria-busy');
            text.textContent = reply.text;
            text.scrollTop = 0;
            historyNav.hidden = replies.length < 2;
            counter.textContent = `${replyIndex + 1} / ${replies.length}`;
            previous.disabled = replyIndex <= 0;
            next.disabled = replyIndex >= replies.length - 1;
            ask.disabled = false;
            layoutBubble(); syncPet();
            replyTimer = setTimeout(() => dismiss(false), 20000);
        }

        function addReply(content, error = false) {
            replies.push({ text: content, error });
            if (replies.length > 20) replies.shift();
            replyIndex = replies.length - 1;
            showReply();
        }

        function focusPet() { pet?.querySelector('.pet-character')?.focus({ preventScroll: true }); }

        function openTalk() {
            if (!pet || pet.hidden || request || dialog.open) return;
            clearReplyTimer();
            restoreReplyOnClose = !bubble.hidden && bubble.dataset.mode === 'reply' && replyIndex >= 0;
            bubble.hidden = true;
            dialog.showModal();
            input.focus({ preventScroll: true });
            syncPet();
        }

        function cancelDialog() { dialog.close(); }
        dialog.querySelectorAll('[data-chat="cancel"]').forEach(button => button.addEventListener('click', cancelDialog));
        dialog.addEventListener('close', () => {
            if (restoreReplyOnClose && !pet?.hidden && !request && replyIndex >= 0) showReply();
            restoreReplyOnClose = false;
            syncPet(); focusPet();
        });
        input.addEventListener('keydown', event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
                event.preventDefault(); form.requestSubmit();
            }
        });

        function dismiss(restoreFocus = true) {
            const wasComment = bubble.dataset.mode === 'comment';
            clearReplyTimer();
            if (!wasComment) {
                request?.abort();
                request = null;
            }
            bubble.hidden = true;
            bubble.removeAttribute('aria-busy');
            if (!wasComment) syncPet();
            if (restoreFocus && !wasComment) focusPet();
        }
        dismissButton.addEventListener('click', () => dismiss());
        ask.addEventListener('click', openTalk);
        previous.addEventListener('click', () => { if (replyIndex > 0) { replyIndex--; showReply(); } });
        next.addEventListener('click', () => { if (replyIndex < replies.length - 1) { replyIndex++; showReply(); } });
        bubble.addEventListener('keydown', event => { if (event.key === 'Escape') dismiss(); });
        document.addEventListener('keydown', event => {
            if (event.key === 'Escape' && !dialog.open && !bubble.hidden) dismiss();
        });
        document.addEventListener('hunterstar:pet-talk', event => {
            pet = event.detail.pet;
            openTalk();
        });
        document.addEventListener('hunterstar:pet-comment', event => {
            const detail = event.detail;
            if (!detail) return;
            detail.accepted = false;
            if (!detail.pet || detail.pet.hidden || document.hidden || dialog.open || request
                || (!bubble.hidden && bubble.dataset.mode !== 'comment')
                || detail.pet.querySelector('.pet-panel')?.hidden === false
                || typeof detail.text !== 'string' || !detail.text.trim()) return;
            pet = detail.pet;
            clearReplyTimer();
            setBubbleMode('comment');
            bubble.dataset.commentKind = typeof detail.kind === 'string' ? detail.kind.slice(0, 32) : 'comment';
            bubble.dataset.error = 'false';
            bubble.removeAttribute('aria-busy');
            text.textContent = detail.text.trim().slice(0, 300);
            text.scrollTop = 0;
            historyNav.hidden = true;
            counter.textContent = '';
            previous.disabled = true;
            next.disabled = true;
            ask.disabled = false;
            bubble.hidden = false;
            layoutBubble();
            const duration = Number.isFinite(detail.duration) ? Math.max(1500, Math.min(10000, detail.duration)) : 6500;
            replyTimer = setTimeout(() => dismiss(false), duration);
            detail.accepted = true;
        });
        document.addEventListener('hunterstar:pet-move', layoutBubble);
        document.addEventListener('hunterstar:pet-controls', () => { if (!bubble.hidden) dismiss(); });
        document.addEventListener('hunterstar:pet-hidden', () => {
            restoreReplyOnClose = false;
            if (dialog.open) dialog.close();
            dismiss(false);
        });
        document.addEventListener('visibilitychange', () => {
            if (document.hidden && !bubble.hidden && bubble.dataset.mode === 'comment') dismiss(false);
        });
        window.addEventListener('resize', layoutBubble);

        form.addEventListener('submit', async event => {
            event.preventDefault();
            const prompt = input.value.trim();
            if (!prompt || request) return;
            clearReplyTimer();
            const controller = new AbortController();
            request = controller;
            const encoder = new TextEncoder();
            let historyBytes = encoder.encode(prompt).length;
            const recent = [];
            for (const message of messages.slice(-7).reverse()) {
                const size = encoder.encode(message.content).length;
                if (historyBytes + size > 6000) break;
                recent.unshift(message); historyBytes += size;
            }
            while (recent[0]?.role === 'assistant') recent.shift();
            const conversation = [...recent, { role: 'user', content: prompt }];
            restoreReplyOnClose = false;
            dialog.close();
            setBubbleMode('reply');
            bubble.hidden = false;
            bubble.dataset.error = 'false';
            bubble.setAttribute('aria-busy', 'true');
            text.textContent = 'Let me think about that…';
            historyNav.hidden = true;
            ask.disabled = true;
            layoutBubble(); syncPet(); focusPet();
            const timer = setTimeout(() => controller.abort(), 125000);
            let failureMessage = 'I can’t reach the chat service right now. Double-tap me to try again.';
            try {
                const response = await fetch(PET_API, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
                    body: JSON.stringify({ messages: conversation, stream: true }), signal: controller.signal
                });
                const data = await readReply(response, answer => {
                    if (request !== controller || controller.signal.aborted) return;
                    text.textContent = answer;
                    text.scrollTop = text.scrollHeight;
                    layoutBubble();
                }, controller.signal);
                if (request !== controller) return;
                if (controller.signal.aborted) throw new Error('Chat request timed out');
                const answer = data.answer;
                if (!response.ok || !data.ok || typeof answer !== 'string' || !answer.trim()) {
                    if (data?.retryable === true && typeof data.error === 'string') failureMessage = data.error.slice(0, 240);
                    else if ([400, 413].includes(response.status)) failureMessage = 'Please shorten your message and try again.';
                    throw new Error('Chat service unavailable');
                }
                messages = [...conversation, { role: 'assistant', content: answer }].slice(-20);
                input.value = '';
                request = null;
                addReply(answer);
            } catch {
                if (request !== controller) return; // Dismissing also cancels the pending answer.
                request = null;
                addReply(controller.signal.aborted
                    ? 'That took too long. Double-tap me to try again.'
                    : failureMessage, true);
            } finally { clearTimeout(timer); }
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
})();
