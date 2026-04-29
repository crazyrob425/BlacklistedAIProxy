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
function getInterfaceSelect(){ return el('pg-interface-select'); }
function getInput()          { return el('pg-input'); }
function getSendBtn()        { return el('pg-send-btn'); }
function getMessages()       { return el('pg-messages'); }
function getEmpty()          { return el('pg-empty'); }
function getAttachPreview()  { return el('pg-attachments-preview'); }
function getSystemInput()    { return el('pg-system-input'); }
function getTempSlider()     { return el('pg-temp-slider'); }
function getTempVal()        { return el('pg-temp-val'); }
function getMaxTokens()      { return el('pg-max-tokens'); }
function getStreamCheckbox() { return el('pg-stream-checkbox'); }

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
        if (e.target.id === 'pg-model-select') {
            updateInputState();
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target.id === 'pg-interface-select') {
            const isChat = e.target.value === 'chat';
            const streamBox = getStreamCheckbox();
            if (streamBox) {
                streamBox.disabled = !isChat;
                const wrap = streamBox.closest('.pg-stream-toggle-wrap');
                if (wrap) wrap.style.opacity = isChat ? '1' : '0.5';
            }
        }
    });

    document.addEventListener('input', (e) => {
        if (e.target.id === 'pg-temp-slider') {
            const val = getTempVal();
            if (val) val.textContent = e.target.value;
        }
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
            e.target.style.height = Math.min(e.target.scrollHeight, 240) + 'px';
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
    const ready = !!(provider && model && !isStreaming);

    const input = getInput();
    const sendBtn = getSendBtn();
    if (input) input.disabled = !ready;
    if (sendBtn) sendBtn.disabled = !ready;

    // Update status indicator
    const indicator = el('pg-active-indicator');
    const statusText = el('pg-status-text');
    if (indicator && statusText) {
        if (ready) {
            indicator.className = 'pg-indicator active';
            statusText.textContent = t('playground.status.ready');
        } else {
            indicator.className = 'pg-indicator inactive';
            statusText.textContent = isStreaming ? t('playground.generating') : t('playground.status.unready');
        }
    }
}

// ── Chat logic ────────────────────────────────────────────────────────────────

async function handleSend() {
    if (isStreaming) return;

    const provider = getProviderSelect()?.value;
    const model = getModelSelect()?.value;
    const interfaceType = getInterfaceSelect()?.value || 'chat';
    const input = getInput();
    const text = input?.value.trim();

    if (!provider || !model || (!text && pendingFiles.length === 0)) return;
    if (!apiKey) return;

    const sysPrompt = getSystemInput()?.value.trim();
    const temp = parseFloat(getTempSlider()?.value || '0.7');
    const maxTokens = parseInt(getMaxTokens()?.value || '4096');
    const useStream = getStreamCheckbox()?.checked ?? true;

    // Build history for request
    const requestMessages = [];
    if (sysPrompt) requestMessages.push({ role: 'system', content: sysPrompt });
    messages.slice(-20).forEach(m => requestMessages.push(m));

    const filesToSend = [...pendingFiles];
    const userContent = buildUserContent(text, filesToSend);
    requestMessages.push({ role: 'user', content: userContent });

    // UI: User message
    const displayText = [
        text,
        ...filesToSend.map(f => `[附件: ${f.name}]`)
    ].filter(Boolean).join('\n');
    appendMessage('user', displayText);

    // Save to history
    messages.push({ role: 'user', content: userContent });

    if (input) { input.value = ''; input.style.height = 'auto'; }
    pendingFiles = [];
    renderAttachmentPreview();

    const assistantBubble = appendMessage('assistant', '');
    
    if (interfaceType === 'image' || interfaceType === 'image-edit') {
        await imageResponse(provider, model, text, filesToSend, assistantBubble, interfaceType);
    } else if (useStream) {
        await streamResponse(provider, model, assistantBubble, {
            messages: requestMessages,
            temperature: temp,
            max_tokens: maxTokens
        });
    } else {
        await unaryResponse(provider, model, assistantBubble, {
            messages: requestMessages,
            temperature: temp,
            max_tokens: maxTokens
        });
    }
}

function buildUserContent(text, files) {
    if (files.length === 0) return text;
    const parts = [];
    if (text) parts.push({ type: 'text', text });
    files.forEach(f => {
        if (f.type.startsWith('image/')) {
            parts.push({ type: 'image_url', image_url: { url: f.dataUrl } });
        } else {
            parts.push({ type: 'text', text: `[File: ${f.name}]\n${f.dataUrl}` });
        }
    });
    return parts;
}

function dataUrlToBlob(dataUrl) {
    const [meta, data] = dataUrl.split(',');
    const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/png';
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    return new Blob([bytes], {type: mime});
}

async function imageResponse(provider, model, prompt, files, bubble, interfaceType) {
    isStreaming = true;
    updateInputState();
    
    const msgWrapper = bubble.closest('.pg-message');
    if (msgWrapper) msgWrapper.style.display = 'flex'; // Image response doesn't need to hide

    let errorMsg = '';
    try {
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        let response;
        
        // 如果显式选择了 image-edit，或者选了 image 且带了图片附件，则走 edits 接口
        const isEdit = interfaceType === 'image-edit' || (interfaceType === 'image' && imageFiles.length > 0);
        
        if (isEdit) {
            if (imageFiles.length === 0) throw new Error('请先上传需要修改的图片');
            
            const formData = new FormData();
            formData.append('model', model);
            formData.append('prompt', prompt || '');
            formData.append('response_format', 'b64_json');
            imageFiles.forEach(f => formData.append('image', dataUrlToBlob(f.dataUrl), f.name));

            response = await fetch('/v1/images/edits', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${apiKey}`, 'model-provider': provider },
                body: formData
            });
        } else {
            response = await fetch('/v1/images/generations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}`, 'model-provider': provider },
                body: JSON.stringify({model, prompt, response_format: 'b64_json'})
            });
        }

        if (!response.ok) {
            errorMsg = await parseResponseError(response);
            throw new Error(errorMsg);
        }
        
        const json = await response.json();
        const images = json.data || [];
        if (images.length === 0) throw new Error(t('playground.reqFailed'));

        bubble.innerHTML = images.map((img, i) => {
            const src = img.b64_json ? `data:image/png;base64,${img.b64_json}` : img.url;
            return `<img src="${src}" alt="generated" style="max-width:100%;border-radius:12px;margin:0.5rem 0;display:block">`;
        }).join('');

    } catch (e) {
        errorMsg = e.message || t('playground.reqFailed');
    } finally {
        if (errorMsg) {
            bubble.textContent = errorMsg;
            bubble.closest('.pg-message')?.classList.add('error');
        }
        isStreaming = false;
        updateInputState();
        scrollToBottom();
    }
}

async function unaryResponse(provider, model, bubble, params) {
    isStreaming = true;
    updateInputState();

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
                messages: params.messages,
                temperature: params.temperature,
                max_tokens: params.max_tokens,
                stream: false
            })
        });

        if (!response.ok) {
            errorMsg = await parseResponseError(response);
            throw new Error(errorMsg);
        }

        const json = await response.json();
        const content = json.choices?.[0]?.message?.content || '';
        const reasoning = json.choices?.[0]?.message?.reasoning_content || json.choices?.[0]?.message?.thinking || '';

        bubble.innerHTML = '';
        const msgWrapper = bubble.closest('.pg-message');
        if (msgWrapper) msgWrapper.style.display = 'flex';

        if (reasoning) {
            const resDiv = document.createElement('div');
            resDiv.className = 'pg-reasoning';
            resDiv.innerHTML = `<div class="pg-reasoning-title"><i class="fas fa-brain"></i>${t('playground.thinking')}</div><div class="pg-reasoning-content"></div>`;
            resDiv.querySelector('.pg-reasoning-content').textContent = reasoning;
            bubble.appendChild(resDiv);
        }

        if (content) {
            const contentDiv = document.createElement('div');
            contentDiv.innerHTML = renderMarkdown(content);
            while (contentDiv.firstChild) bubble.appendChild(contentDiv.firstChild);
            
            const historyContent = content.replace(/data:[^;]+;base64,[A-Za-z0-9+/=]+/g, '[图片]');
            messages.push({role: 'assistant', content: historyContent});
        }

    } catch (e) {
        console.error('[Playground] Unary error:', e.message);
        errorMsg = e.message || t('playground.reqFailed');
    } finally {
        if (errorMsg) {
            bubble.textContent = errorMsg;
            bubble.closest('.pg-message')?.classList.add('error');
            const msgWrapper = bubble.closest('.pg-message');
            if (msgWrapper) msgWrapper.style.display = 'flex';
        }
        isStreaming = false;
        updateInputState();
        scrollToBottom();
    }
}

async function streamResponse(provider, model, bubble, params) {
    isStreaming = true;
    updateInputState();

    const cursor = document.createElement('span');
    cursor.className = 'pg-cursor';
    
    currentAbortController = new AbortController();
    let accumulated = '';
    let accumulatedReasoning = '';
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
                messages: params.messages,
                temperature: params.temperature,
                max_tokens: params.max_tokens,
                stream: true
            }),
            signal: currentAbortController.signal
        });
 
        if (!response.ok) {
            errorMsg = await parseResponseError(response);
            throw new Error(errorMsg);
        }
 
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';

        outer: while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, {stream: true});
            const lines = sseBuffer.split('\n');
            sseBuffer = lines.pop();

            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (data === '[DONE]') break outer;

                try {
                    const json = JSON.parse(data);
                    if (json.error) throw new Error(json.error.message || t('playground.reqFailed'));
                    
                    const delta = json.choices?.[0]?.delta;
                    const content = delta?.content || '';
                    const reasoning = delta?.reasoning_content || delta?.thinking || '';
                    
                    if (content || reasoning) {
                        if (!accumulated && !accumulatedReasoning) {
                            const msgWrapper = bubble.closest('.pg-message');
                            if (msgWrapper) msgWrapper.style.display = 'flex';
                        }
                        
                        if (reasoning) accumulatedReasoning += reasoning;
                        if (content) accumulated += content;
                        
                        let html = '';
                        if (accumulatedReasoning) {
                            html += `<div class="pg-reasoning">
                                <div class="pg-reasoning-title"><i class="fas fa-brain"></i>${t('playground.thinking')}</div>
                                <div class="pg-reasoning-content"></div>
                            </div>`;
                        }
                        
                        bubble.innerHTML = html;
                        if (accumulatedReasoning) {
                            const resContent = bubble.querySelector('.pg-reasoning-content');
                            resContent.textContent = accumulatedReasoning;
                            if (!accumulated) {
                                resContent.appendChild(cursor);
                            }
                        }
                        
                        if (accumulated || !accumulatedReasoning) {
                            const contentSpan = document.createElement('span');
                            contentSpan.textContent = accumulated;
                            bubble.appendChild(contentSpan);
                            bubble.appendChild(cursor);
                        }
                        scrollToBottom();
                    }
                } catch (e) {
                    if (e.message && !e.message.startsWith('Unexpected')) throw e;
                }
            }
        }

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
        const msgWrapper = bubble.closest('.pg-message');
        if (msgWrapper) msgWrapper.style.display = 'flex';

        if (errorMsg) {
            bubble.textContent = errorMsg;
            bubble.closest('.pg-message')?.classList.add('error');
        } else {
            bubble.innerHTML = '';
            if (accumulatedReasoning) {
                const resDiv = document.createElement('div');
                resDiv.className = 'pg-reasoning';
                resDiv.innerHTML = `<div class="pg-reasoning-title"><i class="fas fa-brain"></i>${t('playground.thinking')}</div><div class="pg-reasoning-content"></div>`;
                resDiv.querySelector('.pg-reasoning-content').textContent = accumulatedReasoning;
                bubble.appendChild(resDiv);
            }
            if (accumulated) {
                const contentDiv = document.createElement('div');
                contentDiv.innerHTML = renderMarkdown(accumulated);
                while (contentDiv.firstChild) bubble.appendChild(contentDiv.firstChild);
            }
        }
        isStreaming = false;
        currentAbortController = null;
        updateInputState();
        scrollToBottom();
    }
}

// ── UI helpers ────────────────────────────────────────────────────────────────

async function parseResponseError(response) {
    const status = response.status;
    const defaultMsg = `${t('playground.reqFailed')} (${status})`;
    try {
        const text = await response.text();
        try {
            const json = JSON.parse(text);
            return json.error?.message || json.message || text || defaultMsg;
        } catch (e) {
            return text || defaultMsg;
        }
    } catch (e) {
        return defaultMsg;
    }
}

function appendMessage(role, text) {
    const empty = getEmpty();
    if (empty) empty.style.display = 'none';

    const container = getMessages();
    if (!container) return document.createElement('span');

    const wrapper = document.createElement('div');
    wrapper.className = `pg-message ${role}`;

    // Avatar
    const avatar = document.createElement('div');
    avatar.className = 'pg-avatar';
    avatar.innerHTML = role === 'user' ? '<i class="fas fa-user"></i>' : '<i class="fas fa-microchip"></i>';
    wrapper.appendChild(avatar);

    const contentWrapper = document.createElement('div');
    contentWrapper.className = 'pg-message-content';

    const bubble = document.createElement('div');
    bubble.className = 'pg-message-bubble';
    
    if (role === 'assistant' && !text) {
        bubble.innerHTML = '<div class="pg-thinking"><span></span><span></span><span></span></div>';
    } else {
        bubble.textContent = text;
    }
    
    contentWrapper.appendChild(bubble);

    if (role === 'assistant') {
        const actions = document.createElement('div');
        actions.className = 'pg-message-actions';
        actions.innerHTML = `
            <div class="pg-action-link btn-copy-msg" title="复制文本">
                <i class="fas fa-copy"></i>
            </div>
        `;
        actions.querySelector('.btn-copy-msg').addEventListener('click', async () => {
            const rawText = bubble.innerText;
            const success = await copyToClipboard(rawText);
            if (success) {
                const icon = actions.querySelector('.fa-copy');
                const oldClass = icon.className;
                icon.className = 'fas fa-check';
                setTimeout(() => icon.className = oldClass, 2000);
            }
        });
        contentWrapper.appendChild(actions);
    }

    wrapper.appendChild(contentWrapper);
    container.appendChild(wrapper);
    scrollToBottom();
    return bubble;
}

async function copyToClipboard(text) {
    if (!text) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (e) {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textArea);
        return ok;
    }
}

function clearChat() {
    messages = [];
    pendingFiles = [];
    renderAttachmentPreview();
    const container = getMessages();
    if (container) {
        container.innerHTML = '';
        container.appendChild(createEmptyState());
    }
    const empty = getEmpty();
    if (empty) empty.style.display = 'flex';
    if (currentAbortController) {
        currentAbortController.abort();
        currentAbortController = null;
    }
    updateInputState();
}

function createEmptyState() {
    const empty = document.createElement('div');
    empty.className = 'pg-welcome';
    empty.id = 'pg-empty';
    empty.innerHTML = `
        <div class="welcome-card">
            <div class="welcome-icon">
                <i class="fas fa-microchip"></i>
            </div>
            <h3 data-i18n="playground.welcome">${t('playground.welcome')}</h3>
            <p data-i18n="playground.emptyHint">${t('playground.emptyHint')}</p>
        </div>
    `;
    if (window.i18n) window.i18n.translateElement(empty);
    return empty;
}

function scrollToBottom() {
    const container = getMessages();
    if (container) container.scrollTop = container.scrollHeight;
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

function isSafeImageUrl(url) {
    return url.startsWith('data:image/') || /^https?:\/\//.test(url);
}

function renderMarkdown(text) {
    const blocks = [];
    // Protect code blocks
    text = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const escaped = escapeHtml(code.trimEnd());
        const langAttr = lang ? ` class="language-${escapeHtml(lang)}"` : '';
        blocks.push(`<pre style="background:var(--bg-tertiary);padding:1rem;border-radius:8px;overflow-x:auto;margin:0.5rem 0"><code${langAttr}>${escaped}</code></pre>`);
        return `\x00BLOCK${blocks.length - 1}\x00`;
    });

    text = escapeHtml(text);

    // Inline code
    text = text.replace(/`([^`]+)`/g, '<code style="background:var(--bg-tertiary);padding:0.1em 0.3em;border-radius:4px">$1</code>');

    // Bold/Italic
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Basic images/links
    text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        if (!isSafeImageUrl(url)) return match;
        return `<img src="${url}" alt="${alt}" style="max-width:100%;border-radius:8px;margin:0.5rem 0;display:block">`;
    });
    text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');

    // Newlines
    text = text.replace(/\n/g, '<br>');

    // Restore code blocks
    text = text.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => blocks[+i]);

    return text;
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
    return new Promise((r, j) => {
        const reader = new FileReader();
        reader.onload = e => r(e.target.result);
        reader.onerror = j;
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
        tag.style = "display:inline-flex;align-items:center;background:var(--bg-tertiary);padding:4px 10px;border-radius:8px;margin-right:8px;font-size:0.8rem;border:1px solid var(--border-color);";
        tag.innerHTML = `<i class="fas fa-file" style="margin-right:6px"></i><span>${f.name}</span><button style="border:none;background:none;margin-left:6px;cursor:pointer;color:var(--text-tertiary)">×</button>`;
        tag.querySelector('button').onclick = () => {
            pendingFiles.splice(i, 1);
            renderAttachmentPreview();
        };
        preview.appendChild(tag);
    });
}
