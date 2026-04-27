// Playground 管理模块

import { getAuthHeaders } from './auth.js';
import { t } from './i18n.js';

let providerModels = {};   // { providerType: [model1, model2, ...] }
let apiKey = '';           // REQUIRED_API_KEY, used for /v1/chat/completions auth
let messages = [];         // current conversation history
let pendingFiles = [];     // { name, type, dataUrl }
let isStreaming = false;
let currentAbortController = null;

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(id) {
    return document.getElementById(id);
}

function getProviderSelect() { return el('pg-provider-select'); }
function getModelSelect()    { return el('pg-model-select'); }
function getInput()          { return el('pg-input'); }
function getSendBtn()        { return el('pg-send-btn'); }
function getMessages()       { return el('pg-messages'); }
function getEmpty()          { return el('pg-empty'); }
function getAttachPreview()  { return el('pg-attachments-preview'); }

// ── Initialisation ───────────────────────────────────────────────────────────

export function initPlaygroundManager() {
    loadProviderData();
    bindEvents();
}

async function loadProviderData() {
    try {
        const headers = getAuthHeaders();

        const [accessRes, modelsRes] = await Promise.all([
            fetch('/api/access-info', { headers }),
            fetch('/api/provider-models', { headers })
        ]);

        if (accessRes.ok) {
            const data = await accessRes.json();
            apiKey = data.apiKey || '';
            renderProviderOptions(data.providers || []);
        }

        if (modelsRes.ok) {
            providerModels = await modelsRes.json();
        }
    } catch (e) {
        console.error('[Playground] Failed to load provider data:', e);
    } finally {
        // re-evaluate send button state after data loads
        updateInputState();
    }
}

function renderProviderOptions(providers) {
    const sel = getProviderSelect();
    if (!sel) return;

    sel.innerHTML = `<option value="">${t('playground.selectProvider')}</option>`;

    providers
        .filter(p => (p.usableNodes || 0) > 0)
        .forEach(p => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = `● ${p.id} (${p.usableNodes}/${p.totalNodes})`;
            sel.appendChild(opt);
        });
}

// ── Events ───────────────────────────────────────────────────────────────────

function bindEvents() {
    document.addEventListener('change', (e) => {
        if (e.target.id === 'pg-provider-select') onProviderChange(e.target.value);
    });

    document.addEventListener('change', (e) => {
        if (e.target.id === 'pg-model-select') updateInputState();
    });

    document.addEventListener('keydown', (e) => {
        if (e.target.id === 'pg-input' && e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    document.addEventListener('input', (e) => {
        if (e.target.id === 'pg-input') {
            e.target.style.height = 'auto';
            e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px';
        }
    });

    document.addEventListener('click', (e) => {
        if (e.target.closest('#pg-send-btn')) handleSend();
        if (e.target.closest('#pg-clear-btn')) clearChat();
        if (e.target.closest('#pg-attach-btn')) el('pg-file-input')?.click();
    });

    document.addEventListener('change', (e) => {
        if (e.target.id === 'pg-file-input') handleFiles(e.target.files);
    });
}

function onProviderChange(providerType) {
    const modelSel = getModelSelect();
    if (!modelSel) return;

    if (!providerType) {
        modelSel.innerHTML = `<option value="">${t('playground.providerFirst')}</option>`;
        modelSel.disabled = true;
        updateInputState();
        return;
    }

    const models = providerModels[providerType] || [];
    modelSel.innerHTML = `<option value="">${t('playground.selectModel')}</option>`;
    models.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        opt.textContent = m;
        modelSel.appendChild(opt);
    });
    modelSel.disabled = false;
    updateInputState();
}

function updateInputState() {
    const provider = getProviderSelect()?.value;
    const model = getModelSelect()?.value;
    const selected = !!(provider && model);
    const ready = selected && !isStreaming;

    const input = getInput();
    const sendBtn = getSendBtn();
    if (input) input.disabled = !ready;
    if (sendBtn) sendBtn.disabled = !ready;

    const inputArea = document.querySelector('.playground-input-area');
    const hint = el('pg-hint');
    if (inputArea) inputArea.classList.toggle('pg-input-disabled', !ready);
    if (hint) {
        if (ready) {
            hint.textContent = t('playground.hint');
        } else if (isStreaming) {
            hint.textContent = t('playground.generating');
        } else {
            hint.textContent = t('playground.selectFirst');
        }
    }
}

// ── Chat logic ────────────────────────────────────────────────────────────────

async function handleSend() {
    if (isStreaming) return;

    const provider = getProviderSelect()?.value;
    const model = getModelSelect()?.value;
    const input = getInput();
    const text = input?.value.trim();

    if (!provider || !model || (!text && pendingFiles.length === 0)) return;
    if (!apiKey) {
        console.warn('[Playground] API key not loaded yet, aborting send');
        return;
    }

    const userContent = buildUserContent(text, pendingFiles);
    messages.push({ role: 'user', content: userContent });

    const displayText = [
        text,
        ...pendingFiles.map(f => `${t('playground.attachPrefix')}${f.name}]`)
    ].filter(Boolean).join('\n');
    appendMessage('user', displayText);

    if (input) { input.value = ''; input.style.height = 'auto'; }
    pendingFiles = [];
    renderAttachmentPreview();

    const assistantBubble = appendMessage('assistant', '');
    await streamResponse(provider, model, assistantBubble);
}

function buildUserContent(text, files) {
    if (files.length === 0) return text;

    const parts = [];
    if (text) parts.push({ type: 'text', text });

    files.forEach(f => {
        if (f.type.startsWith('image/')) {
            parts.push({
                type: 'image_url',
                image_url: { url: f.dataUrl }
            });
        } else {
            parts.push({ type: 'text', text: `[File: ${f.name}]\n${f.dataUrl}` });
        }
    });

    return parts;
}

async function streamResponse(provider, model, bubble) {
    isStreaming = true;
    updateInputState();

    const cursor = document.createElement('span');
    cursor.className = 'pg-cursor';
    bubble.appendChild(cursor);

    currentAbortController = new AbortController();
    let accumulated = '';
    let errorMsg = '';

    try {
        const response = await fetch('/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'model-provider': provider
            },
            body: JSON.stringify({
                model,
                messages,
                stream: true
            }),
            signal: currentAbortController.signal
        });

        if (!response.ok) {
            const errText = await response.text();
            let msg = `${t('playground.reqFailed')} (${response.status})`;
            try { msg = JSON.parse(errText)?.error?.message || msg; } catch {}
            throw new Error(msg);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        let streamDone = false;
        outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            // buffer across chunks so a large data: line isn't split mid-JSON
            sseBuffer += decoder.decode(value, {stream: true});
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop(); // keep the (possibly incomplete) last line

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') {
                    streamDone = true;
                    break outer;
                }

                try {
                    const json = JSON.parse(data);
                    // detect server-side stream error event
                    if (json.error) {
                        throw new Error(json.error.message || t('playground.reqFailed'));
                    }
                    const delta = json.choices?.[0]?.delta?.content || '';
                    if (delta) {
                        accumulated += delta;
                        bubble.textContent = accumulated;
                        bubble.appendChild(cursor);
                        scrollToBottom();
                    }
                } catch (parseErr) {
                    if (parseErr.message && !parseErr.message.startsWith('Unexpected')) {
                        // re-throw real stream errors, swallow JSON parse errors
                        throw parseErr;
                    }
                }
            }
        }

        // flush whatever remains in the buffer
        if (!streamDone && sseBuffer.trim().startsWith('data: ')) {
            const data = sseBuffer.slice(6).trim();
            if (data && data !== '[DONE]') {
                try {
                    const json = JSON.parse(data);
                    if (json.error) throw new Error(json.error.message || t('playground.reqFailed'));
                    const delta = json.choices?.[0]?.delta?.content || '';
                    if (delta) accumulated += delta;
                } catch (parseErr) {
                    if (parseErr.message && !parseErr.message.startsWith('Unexpected')) throw parseErr;
                }
            }
        }

        // strip base64 data URLs before storing in history to avoid context overflow
        const historyContent = accumulated.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, '[图片]');
        messages.push({role: 'assistant', content: historyContent});

    } catch (e) {
        if (e.name === 'AbortError') {
            accumulated = accumulated || t('playground.aborted');
        } else {
            console.error('[Playground] Stream error:', e.message);
            errorMsg = e.message || t('playground.reqFailed');
        }
    } finally {
        cursor.remove();
        if (errorMsg) {
            bubble.textContent = errorMsg;
            bubble.closest('.pg-message')?.classList.add('error');
        } else if (accumulated) {
            bubble.innerHTML = renderMarkdown(accumulated);
        }
        isStreaming = false;
        currentAbortController = null;
        updateInputState();
        scrollToBottom();
    }
}

// ── Markdown renderer ─────────────────────────────────────────────────────────

function escapeHtml(str) {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function isSafeImageUrl(url) {
    return url.startsWith('data:image/') || /^https?:\/\//.test(url);
}

function renderMarkdown(text) {
    const blocks = [];

    // pull out fenced code blocks first to protect them from further processing
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const escaped = escapeHtml(code.trimEnd());
        const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        const html = `<pre style="background:var(--code-bg,#1e1e1e);color:var(--code-text,#d4d4d4);padding:0.75rem;border-radius:0.375rem;overflow-x:auto;font-size:0.8rem;margin:0.5rem 0;white-space:pre"><code${langAttr}>${escaped}</code></pre>`;
        blocks.push(html);
        return `\x00BLOCK${blocks.length - 1}\x00`;
    });

    // inline code `...`
    text = text.replace(/`([^`]+)`/g, (_, code) =>
        `<code style="background:var(--code-bg,#1e1e1e);color:var(--code-text,#d4d4d4);padding:0.1em 0.3em;border-radius:3px;font-size:0.85em">${escapeHtml(code)}</code>`
    );

    // markdown images ![alt](url) — only render safe URLs as <img>
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        if (!isSafeImageUrl(url)) return escapeHtml(match);
        const safeAlt = escapeHtml(alt);
        const safeUrl = url.startsWith('data:image/') ? url : escapeHtml(url);
        return `<img src="${safeUrl}" alt="${safeAlt}" style="max-width:100%;border-radius:0.375rem;margin:0.25rem 0;display:block">`;
    });

    // markdown links [text](url)
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) =>
        `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
    );

    // **bold** and *italic*
    text = text.replace(/\*\*([^*]+)\*\*/g, (_, s) => `<strong>${escapeHtml(s)}</strong>`);
    text = text.replace(/\*([^*\n]+)\*/g, (_, s) => `<em>${escapeHtml(s)}</em>`);

    // newlines → <br>
    text = text.replace(/\n/g, '<br>');

    // restore protected code blocks
    text = text.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => blocks[+i]);

    return text;
}

// ── UI helpers ────────────────────────────────────────────────────────────────

function appendMessage(role, text) {
    const empty = getEmpty();
    if (empty) empty.style.display = 'none';

    const container = getMessages();
    if (!container) return document.createElement('span');

    const wrapper = document.createElement('div');
    wrapper.className = `pg-message ${role}`;

    const roleLabel = document.createElement('div');
    roleLabel.className = 'pg-message-role';
    roleLabel.textContent = role === 'user' ? t('playground.you') : 'AI';
    wrapper.appendChild(roleLabel);

    const bubble = document.createElement('div');
    bubble.className = 'pg-message-bubble';
    bubble.textContent = text;
    wrapper.appendChild(bubble);

    container.appendChild(wrapper);
    scrollToBottom();
    return bubble;
}

function clearChat() {
    messages = [];
    pendingFiles = [];
    renderAttachmentPreview();

    const container = getMessages();
    if (!container) return;
    container.innerHTML = '';

    const empty = document.createElement('div');
    empty.className = 'playground-empty';
    empty.id = 'pg-empty';
    empty.innerHTML = `<i class="fas fa-comment-dots"></i><p>${t('playground.emptyHint')}</p>`;
    container.appendChild(empty);

    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
}

function scrollToBottom() {
    const container = getMessages();
    if (container) container.scrollTop = container.scrollHeight;
}

// ── File handling ─────────────────────────────────────────────────────────────

async function handleFiles(fileList) {
    if (!fileList?.length) return;

    for (const file of fileList) {
        const dataUrl = await readFileAsDataUrl(file);
        pendingFiles.push({ name: file.name, type: file.type, dataUrl });
    }

    const fileInput = el('pg-file-input');
    if (fileInput) fileInput.value = '';

    renderAttachmentPreview();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function renderAttachmentPreview() {
    const preview = getAttachPreview();
    if (!preview) return;
    preview.innerHTML = '';

    pendingFiles.forEach((f, i) => {
        const tag = document.createElement('div');
        tag.className = 'pg-attachment-tag';
        tag.innerHTML = `
            <i class="fas ${f.type.startsWith('image/') ? 'fa-image' : 'fa-file-pdf'}"></i>
            <span>${f.name}</span>
            <button data-index="${i}" title="×">×</button>
        `;
        tag.querySelector('button').addEventListener('click', () => {
            pendingFiles.splice(i, 1);
            renderAttachmentPreview();
        });
        preview.appendChild(tag);
    });
}
