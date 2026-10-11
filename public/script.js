/**
 * script.js - FitBuddy AI Client Controller
 * College Prompt Engineering Assignment No. 11: Design, Test & Break Your AI Assistant
 * 
 * Handles client-side chat state, safe rendering, modal dialogs,
 * keyboard events, server connectivity, and interactive testing.
 */

document.addEventListener('DOMContentLoaded', () => {
  // --- DOM Element References ---
  const chatMessages = document.getElementById('chat-messages');
  const welcomeContainer = document.getElementById('welcome-container');
  const chatForm = document.getElementById('chat-form');
  const userInput = document.getElementById('user-input');
  const sendBtn = document.getElementById('send-btn');
  const charCounter = document.getElementById('char-counter');
  const typingIndicator = document.getElementById('typing-indicator');
  const errorBanner = document.getElementById('error-banner');
  const errorMessageText = document.getElementById('error-message-text');
  const dismissErrorBtn = document.getElementById('dismiss-error-btn');
  const systemStatus = document.getElementById('system-status');
  const statusLabel = document.getElementById('status-label');

  // Modals & Buttons
  const clearChatBtn = document.getElementById('clear-chat-btn');
  const clearModal = document.getElementById('clear-modal');
  const closeClearModalBtn = document.getElementById('close-clear-modal-btn');
  const cancelClearBtn = document.getElementById('cancel-clear-btn');
  const confirmClearBtn = document.getElementById('confirm-clear-btn');

  const openTestModalBtn = document.getElementById('open-test-modal-btn');
  const testModal = document.getElementById('test-modal');
  const closeTestModalBtn = document.getElementById('close-test-modal-btn');
  const closeTestDrawerBottomBtn = document.getElementById('close-test-drawer-bottom-btn');

  // --- State in Browser Memory (No Database) ---
  let conversationHistory = []; // Array of { role: 'user' | 'model', text: string }
  let isGenerating = false;

  // --- Initialize Application ---
  checkServerHealth();
  setupSuggestedPrompts();
  setupTestLabButtons();

  // --- Textarea Auto-Resize & Character Counter ---
  userInput.addEventListener('input', () => {
    // Auto resize height up to 140px
    userInput.style.height = 'auto';
    userInput.style.height = `${Math.min(userInput.scrollHeight, 140)}px`;

    // Update character counter
    const length = userInput.value.length;
    charCounter.textContent = `${length} / 2000`;

    if (length > 1900) {
      charCounter.classList.add('limit-reached');
      charCounter.classList.remove('limit-near');
    } else if (length > 1600) {
      charCounter.classList.add('limit-near');
      charCounter.classList.remove('limit-reached');
    } else {
      charCounter.classList.remove('limit-near', 'limit-reached');
    }
  });

  // Enter to send, Shift + Enter for newline
  userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isGenerating && userInput.value.trim().length > 0) {
        handleMessageSubmit();
      }
    }
  });

  // Form submission
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!isGenerating && userInput.value.trim().length > 0) {
      handleMessageSubmit();
    }
  });

  // --- Server Health & Status Checking ---
  async function checkServerHealth() {
    try {
      const response = await fetch('/api/health');
      if (!response.ok) throw new Error('Health check failed');
      const data = await response.json();

      if (data.apiKeyConfigured) {
        systemStatus.className = 'status-pill online';
        statusLabel.textContent = `Online • ${data.model}`;
        systemStatus.title = `FitBuddy AI Connected. Active model: ${data.model}`;
      } else {
        systemStatus.className = 'status-pill offline';
        statusLabel.textContent = 'API Key Missing';
        systemStatus.title = 'Please configure your GEMINI_API_KEY in the .env file.';
        showError('Setup Notice: Gemini API Key is missing. Please add your key to the .env file.');
      }
    } catch (err) {
      systemStatus.className = 'status-pill offline';
      statusLabel.textContent = 'Server Offline';
      systemStatus.title = 'Cannot connect to FitBuddy AI backend server.';
    }
  }

  // --- Sending & Receiving Messages ---
  async function handleMessageSubmit(customText = null) {
    const rawText = customText !== null ? customText : userInput.value;
    const text = rawText.trim();

    if (!text || isGenerating) return;

    // Reset input fields
    userInput.value = '';
    userInput.style.height = 'auto';
    charCounter.textContent = '0 / 2000';
    charCounter.classList.remove('limit-near', 'limit-reached');
    hideError();

    // Hide welcome screen when conversation starts
    if (welcomeContainer) {
      welcomeContainer.classList.add('hidden');
    }

    // Append User Message to UI
    appendMessage('user', text);

    // Save turn to in-memory conversation history
    conversationHistory.push({ role: 'user', text });

    // Set UI to Generating State
    setGeneratingState(true);
    scrollToBottom();

    try {
      // Send message and recent conversation context to backend
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          message: text,
          history: conversationHistory.slice(0, -1) // Send previous turns excluding current
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || `Server returned error (${response.status})`);
      }

      const botReply = data.reply || "I'm ready for your next fitness question!";

      // Append Assistant Message to UI
      appendMessage('assistant', botReply);

      // Save assistant reply to memory
      conversationHistory.push({ role: 'model', text: botReply });

    } catch (err) {
      console.error('Chat error:', err);
      showError(err.message || 'Failed to communicate with FitBuddy AI. Please try again.');
      
      // Also show friendly error bubble in chat
      appendMessage(
        'assistant',
        `⚠️ **Error Notice:** ${err.message || 'Unable to fetch response from server. Check that your local Node.js server and Gemini API key are active.'}`
      );
    } finally {
      setGeneratingState(false);
      scrollToBottom();
      userInput.focus();
    }
  }

  // --- UI State Management ---
  function setGeneratingState(generating) {
    isGenerating = generating;
    userInput.disabled = generating;
    sendBtn.disabled = generating;

    if (generating) {
      typingIndicator.classList.remove('hidden');
    } else {
      typingIndicator.classList.add('hidden');
    }
  }

  function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  // --- Safe Markdown & HTML Rendering ---
  function escapeHtml(string) {
    return String(string)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatMarkdown(text) {
    // 1. First escape all raw HTML to prevent XSS injection
    let safe = escapeHtml(text);

    // 2. Bold: **text**
    safe = safe.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

    // 3. Italic: *text*
    safe = safe.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 4. Inline code: `code`
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 5. Line-by-line formatting for lists, blockquotes, paragraphs
    const lines = safe.split('\n');
    let formattedHtml = '';
    let inList = false;
    let listType = 'ul';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for bullet list item (- or *)
      const bulletMatch = line.match(/^[-*]\s+(.*)$/);
      // Check for numbered list item (1., 2.)
      const numberMatch = line.match(/^(\d+)\.\s+(.*)$/);

      if (bulletMatch) {
        if (!inList || listType !== 'ul') {
          if (inList) formattedHtml += `</${listType}>`;
          formattedHtml += '<ul>';
          inList = true;
          listType = 'ul';
        }
        formattedHtml += `<li>${bulletMatch[1]}</li>`;
      } else if (numberMatch) {
        if (!inList || listType !== 'ol') {
          if (inList) formattedHtml += `</${listType}>`;
          formattedHtml += '<ol>';
          inList = true;
          listType = 'ol';
        }
        formattedHtml += `<li>${numberMatch[2]}</li>`;
      } else {
        if (inList) {
          formattedHtml += `</${listType}>`;
          inList = false;
        }

        if (line.startsWith('&gt;')) {
          // Blockquote
          formattedHtml += `<blockquote>${line.substring(4).trim()}</blockquote>`;
        } else if (line.length > 0) {
          formattedHtml += `<p>${line}</p>`;
        }
      }
    }

    if (inList) {
      formattedHtml += `</${listType}>`;
    }

    return formattedHtml;
  }

  // --- Render Message Bubble to DOM ---
  function appendMessage(role, text) {
    const messageRow = document.createElement('div');
    messageRow.className = `message-row ${role}-row`;

    const now = new Date();
    const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (role === 'user') {
      messageRow.innerHTML = `
        <div class="avatar user-avatar" title="You">YOU</div>
        <div class="message-bubble-wrapper">
          <div class="bubble user-bubble">${escapeHtml(text)}</div>
          <div class="message-meta">
            <span>${timeString}</span>
          </div>
        </div>
      `;
    } else {
      const formattedContent = formatMarkdown(text);
      messageRow.innerHTML = `
        <div class="avatar assistant-avatar" title="FitBuddy AI">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6.5 6.5 11 11"/>
            <path d="m18 22 4-4"/>
            <path d="m2 6 4-4"/>
          </svg>
        </div>
        <div class="message-bubble-wrapper">
          <div class="bubble assistant-bubble">${formattedContent}</div>
          <div class="message-meta">
            <span>FitBuddy AI • ${timeString}</span>
            <button class="copy-btn" title="Copy response to clipboard">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
              <span>Copy</span>
            </button>
          </div>
        </div>
      `;

      // Copy to clipboard functionality
      const copyBtn = messageRow.querySelector('.copy-btn');
      if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(text);
            const span = copyBtn.querySelector('span');
            span.textContent = 'Copied!';
            setTimeout(() => {
              span.textContent = 'Copy';
            }, 2000);
          } catch (e) {
            console.error('Copy failed:', e);
          }
        });
      }
    }

    chatMessages.appendChild(messageRow);
    scrollToBottom();
  }

  // --- Suggested Prompts Configuration ---
  function setupSuggestedPrompts() {
    const promptChips = document.querySelectorAll('.prompt-chip');
    promptChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-prompt');
        if (query) {
          handleMessageSubmit(query);
        }
      });
    });
  }

  // --- Error Banner Management ---
  function showError(msg) {
    errorMessageText.textContent = msg;
    errorBanner.classList.remove('hidden');
  }

  function hideError() {
    errorBanner.classList.add('hidden');
    errorMessageText.textContent = '';
  }

  dismissErrorBtn.addEventListener('click', hideError);

  // --- Clear Chat Modal Controls ---
  clearChatBtn.addEventListener('click', () => {
    clearModal.classList.remove('hidden');
  });

  closeClearModalBtn.addEventListener('click', () => {
    clearModal.classList.add('hidden');
  });

  cancelClearBtn.addEventListener('click', () => {
    clearModal.classList.add('hidden');
  });

  // Clicking outside modal closes it
  clearModal.addEventListener('click', (e) => {
    if (e.target === clearModal) {
      clearModal.classList.add('hidden');
    }
  });

  // Confirm Clear Chat
  confirmClearBtn.addEventListener('click', () => {
    // 1. Wipe in-memory conversation history
    conversationHistory = [];

    // 2. Clear UI message bubbles
    const messageRows = chatMessages.querySelectorAll('.message-row');
    messageRows.forEach(row => row.remove());

    // 3. Restore welcome card
    if (welcomeContainer) {
      welcomeContainer.classList.remove('hidden');
    }

    // 4. Close modal & reset input
    clearModal.classList.add('hidden');
    hideError();
    userInput.value = '';
    userInput.style.height = 'auto';
    charCounter.textContent = '0 / 2000';
    userInput.focus();
  });

  // --- Assignment Test Suite Modal Controls ---
  openTestModalBtn.addEventListener('click', () => {
    testModal.classList.remove('hidden');
  });

  closeTestModalBtn.addEventListener('click', () => {
    testModal.classList.add('hidden');
  });

  closeTestDrawerBottomBtn.addEventListener('click', () => {
    testModal.classList.add('hidden');
  });

  testModal.addEventListener('click', (e) => {
    if (e.target === testModal) {
      testModal.classList.add('hidden');
    }
  });

  function setupTestLabButtons() {
    const runTestBtns = document.querySelectorAll('.run-test-btn');
    runTestBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const query = btn.getAttribute('data-query');
        if (query) {
          testModal.classList.add('hidden');
          handleMessageSubmit(query);
        }
      });
    });
  }
});
