document.addEventListener('DOMContentLoaded', () => {
    // Inject chat widget HTML
    const chatWidgetHTML = `
        <div class="chat-widget-container">
            <button class="chat-widget-toggle" id="chatWidgetToggle" aria-label="Open AI Assistant">
                <svg viewBox="0 0 24 24">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
            </button>

            <div class="chat-window" id="chatWindow" role="dialog" aria-label="Hunterstar AI Assistant">
                <div class="chat-header">
                    <div class="chat-title-wrapper">
                        <div class="chat-avatar-wrap">
                            <img src="assets/hunterrealpic.png" alt="Hunterstar AI" class="chat-avatar" onerror="this.src='assets/logo.png'">
                        </div>
                        <div class="chat-identity">
                            <h3 class="chat-title">Hunterstar AI</h3>
                            <p class="chat-subtitle">ai.assistant / online</p>
                        </div>
                    </div>
                    <div class="chat-header-actions">
                        <button class="chat-close" id="chatClose" aria-label="Close chat">
                            <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                        </button>
                    </div>
                </div>

                <div class="chat-messages" id="chatMessages">
                    <div class="chat-message assistant">
                        Hey! I'm Hunterstar's AI — ask me anything about his work, stack, or projects.
                    </div>
                </div>

                <div class="chat-input-container">
                    <form class="chat-form" id="chatForm" autocomplete="off">
                        <input type="text" class="chat-input" id="chatInput" placeholder="Ask me anything..." required>
                        <button type="submit" class="chat-submit" id="chatSubmit" aria-label="Send">
                            <svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', chatWidgetHTML);

    const toggleBtn = document.getElementById('chatWidgetToggle');
    const chatWindow = document.getElementById('chatWindow');
    const closeBtn = document.getElementById('chatClose');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const submitBtn = document.getElementById('chatSubmit');

    let isChatOpen = false;
    let messages = [];

    // Toggle chat window
    function toggleChat() {
        isChatOpen = !isChatOpen;
        if (isChatOpen) {
            chatWindow.classList.add('open');
            toggleBtn.classList.add('is-open');
            chatInput.focus();
        } else {
            chatWindow.classList.remove('open');
            toggleBtn.classList.remove('is-open');
        }
    }

    toggleBtn.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);

    // Add message to UI
    function appendMessage(role, content) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `chat-message ${role}`;
        
        // Escape HTML to prevent XSS
        const escapedContent = content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;")
            .replace(/\n/g, '<br>');
            
        msgDiv.innerHTML = escapedContent;
        chatMessages.appendChild(msgDiv);
        scrollToBottom();
    }

    function showLoading() {
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'chat-loading';
        loadingDiv.id = 'chatLoading';
        loadingDiv.innerHTML = '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';
        chatMessages.appendChild(loadingDiv);
        scrollToBottom();
    }

    function removeLoading() {
        const loadingDiv = document.getElementById('chatLoading');
        if (loadingDiv) {
            loadingDiv.remove();
        }
    }

    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Handle form submission
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const text = chatInput.value.trim();
        if (!text) return;
        
        // Add user message
        appendMessage('user', text);
        messages.push({ role: 'user', content: text });
        
        // Clear input and disable
        chatInput.value = '';
        chatInput.disabled = true;
        submitBtn.disabled = true;
        
        showLoading();

        try {
            let apiUrl = 'https://api.hunterstar.uz/api/chat';
            if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
                apiUrl = 'http://localhost:3001/api/chat';
            } else if (window.location.hostname.includes('hunterstaronline.online')) {
                const match = window.location.pathname.match(/^\/s\/([^\/]+)/);
                if (match) {
                    apiUrl = `https://${window.location.hostname}/s/api-${match[1]}/api/chat`;
                }
            }

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ messages })
            });

            const data = await response.json();
            
            removeLoading();
            
            if (response.ok && data.ok) {
                const aiMsg = data.data.choices[0].message.content;
                appendMessage('assistant', aiMsg);
                messages.push({ role: 'assistant', content: aiMsg });
            } else {
                appendMessage('assistant', 'Sorry, I encountered an error: ' + (data.error || 'Unknown error'));
            }
        } catch (error) {
            removeLoading();
            appendMessage('assistant', 'Sorry, I am unable to connect to the server right now.');
            console.error('Chat error:', error);
        } finally {
            chatInput.disabled = false;
            submitBtn.disabled = false;
            chatInput.focus();
        }
    });
});
