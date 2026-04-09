import { showToast, getProviderConfigs } from './utils.js';
import { t } from './i18n.js';
import { executeGenerateAuthUrl } from './provider-manager.js';

const OAUTH_PROVIDERS = [
    { id: 'gemini-cli-oauth', name: 'Gemini CLI OAuth' },
    { id: 'gemini-antigravity', name: 'Gemini Antigravity' },
    { id: 'claude-kiro-oauth', name: 'Claude Kiro OAuth' },
    { id: 'openai-qwen-oauth', name: 'Qwen OAuth' },
    { id: 'openai-codex-oauth', name: 'Codex OAuth' }
];

let currentStep = 1;

function getTagValues(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return [];
    return Array.from(container.querySelectorAll('.provider-tag.selected'))
        .map((tag) => tag.getAttribute('data-value'));
}

function setTagValues(containerId, values = []) {
    const container = document.getElementById(containerId);
    if (!container) return;
    const selected = new Set(values);
    container.querySelectorAll('.provider-tag').forEach((tag) => {
        const value = tag.getAttribute('data-value');
        if (selected.has(value)) {
            tag.classList.add('selected');
        } else {
            tag.classList.remove('selected');
        }
    });
}

function renderOauthMatrix() {
    const matrix = document.getElementById('workspaceOauthMatrix');
    if (!matrix) return;
    matrix.innerHTML = OAUTH_PROVIDERS.map((provider) => `
        <div class="oauth-item">
            <strong>${provider.name}</strong>
            <button class="btn btn-sm btn-primary workspace-oauth-btn" data-provider="${provider.id}">连接</button>
        </div>
    `).join('');

    matrix.querySelectorAll('.workspace-oauth-btn').forEach((btn) => {
        btn.addEventListener('click', async () => {
            const providerType = btn.getAttribute('data-provider');
            btn.disabled = true;
            btn.textContent = '处理中...';
            try {
                await executeGenerateAuthUrl(providerType, {});
                btn.textContent = '已触发';
                btn.classList.remove('btn-primary');
                btn.classList.add('btn-success');
            } catch (error) {
                btn.disabled = false;
                btn.textContent = '重试';
                showToast(t('common.error'), `OAuth 启动失败: ${error.message}`, 'error');
            }
        });
    });
}

function applyProviderSyncFromModel() {
    const selected = getTagValues('modelProvider');
    if (selected.length === 0) {
        showToast(t('common.warning'), '请先在配置管理中选择模型提供商', 'warning');
        return;
    }
    setTagValues('proxyProviders', selected);
    setTagValues('tlsSidecarProviders', selected);
    setTagValues('scheduledHealthCheckProviders', selected);
    showToast(t('common.success'), '已融合并同步重复设置项', 'success');
}

function applyPreset(mode) {
    const mappings = {
        balanced: { retries: 3, switchRetries: 5, maxError: 10, warmup: 2, refreshConcurrency: 2, interval: 600000 },
        performance: { retries: 2, switchRetries: 8, maxError: 14, warmup: 6, refreshConcurrency: 4, interval: 300000 },
        reliability: { retries: 4, switchRetries: 5, maxError: 8, warmup: 3, refreshConcurrency: 2, interval: 900000 }
    };
    const preset = mappings[mode] || mappings.balanced;

    const setNumber = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };
    setNumber('requestMaxRetries', preset.retries);
    setNumber('credentialSwitchMaxRetries', preset.switchRetries);
    setNumber('maxErrorCount', preset.maxError);
    setNumber('warmupTarget', preset.warmup);
    setNumber('refreshConcurrencyPerProvider', preset.refreshConcurrency);
    setNumber('scheduledHealthCheckInterval', preset.interval);
}

function generateCheatSheet() {
    const host = document.getElementById('host')?.value || '127.0.0.1';
    const port = document.getElementById('port')?.value || '3000';
    const apiKey = document.getElementById('apiKey')?.value || '******';
    const providers = getTagValues('modelProvider');
    const providerNames = getProviderConfigs(providers).filter((p) => providers.includes(p.id)).map((p) => p.name);
    const base = `http://${host}:${port}`;

    return [
        '# AI Proxy Quick Credential Cheat Sheet',
        `Base URL: ${base}`,
        `API Key: ${apiKey}`,
        '',
        'OpenAI Compatible',
        `- ${base}/v1/chat/completions`,
        `- ${base}/v1/responses`,
        `- ${base}/v1/models`,
        '',
        'Claude Compatible',
        `- ${base}/v1/messages`,
        '',
        'Gemini Compatible',
        `- ${base}/v1beta/models/{model}:generateContent`,
        '',
        `Preferred Providers: ${providerNames.join(', ') || providers.join(', ') || 'N/A'}`,
        '',
        'Tips:',
        '- Use Model-Provider header to force a provider type per request',
        '- Use /{provider}/v1/... path prefix for routing override',
        '- Keep this key private'
    ].join('\n');
}

function updateStepView() {
    for (let i = 1; i <= 4; i++) {
        const step = document.getElementById(`workspaceWizardStep${i}`);
        if (step) step.classList.toggle('active', i === currentStep);
    }
    const stepLabel = document.getElementById('wizardStepLabel');
    if (stepLabel) stepLabel.textContent = `步骤 ${currentStep} / 4`;
}

async function saveRolloutSettings() {
    const gatewayUrl = document.getElementById('workspaceGatewayUrl')?.value?.trim() || '';
    const canaryPercent = parseInt(document.getElementById('workspaceRolloutPercent')?.value || '0', 10);
    const cacheEnabled = document.getElementById('workspaceGatewayCacheEnabled')?.checked === true;

    await window.apiClient.post('/config', {
        HYBRID_GATEWAY_ENABLED: Boolean(gatewayUrl),
        HYBRID_GATEWAY_URL: gatewayUrl,
        HYBRID_GATEWAY_CANARY_PERCENT: Math.max(0, Math.min(100, Number.isFinite(canaryPercent) ? canaryPercent : 0)),
        HYBRID_GATEWAY_CACHE_ENABLED: cacheEnabled
    });
    await window.apiClient.post('/reload-config');
}

function bindWorkspaceEvents() {
    document.getElementById('syncFromModelProvidersBtn')?.addEventListener('click', applyProviderSyncFromModel);
    document.getElementById('syncPerformancePresetBtn')?.addEventListener('click', () => {
        applyPreset('performance');
        showToast(t('common.success'), '已应用高性能融合预设', 'success');
    });
    document.getElementById('syncReliabilityPresetBtn')?.addEventListener('click', () => {
        applyPreset('reliability');
        showToast(t('common.success'), '已应用高可靠融合预设', 'success');
    });

    document.getElementById('wizardNextStep')?.addEventListener('click', () => {
        if (currentStep < 4) currentStep += 1;
        updateStepView();
    });
    document.getElementById('wizardPrevStep')?.addEventListener('click', () => {
        if (currentStep > 1) currentStep -= 1;
        updateStepView();
    });

    document.querySelectorAll('input[name="workspaceMode"]').forEach((radio) => {
        radio.addEventListener('change', (event) => {
            applyPreset(event.target.value);
        });
    });

    document.getElementById('applyWorkspaceTuningBtn')?.addEventListener('click', () => {
        const mode = document.querySelector('input[name="workspaceMode"]:checked')?.value || 'balanced';
        applyPreset(mode);
        applyProviderSyncFromModel();
        showToast(t('common.success'), '融合调优已应用，请点击“保存配置”生效', 'success');
    });

    document.getElementById('saveWorkspaceRolloutBtn')?.addEventListener('click', async () => {
        try {
            await saveRolloutSettings();
            showToast(t('common.success'), 'Canary / Gateway 设置已保存', 'success');
        } catch (error) {
            showToast(t('common.error'), `保存失败: ${error.message}`, 'error');
        }
    });

    document.getElementById('generateWorkspaceCheatSheetBtn')?.addEventListener('click', () => {
        const area = document.getElementById('workspaceCheatSheet');
        if (area) area.value = generateCheatSheet();
        showToast(t('common.success'), '速查表已生成', 'success');
    });

    document.getElementById('copyWorkspaceCheatSheetBtn')?.addEventListener('click', async () => {
        const area = document.getElementById('workspaceCheatSheet');
        if (!area || !area.value) {
            showToast(t('common.warning'), '请先生成速查表', 'warning');
            return;
        }
        await navigator.clipboard.writeText(area.value);
        showToast(t('common.success'), '速查表已复制', 'success');
    });
}

function loadWorkspaceDefaultsFromConfig() {
    const gatewayUrlInput = document.getElementById('workspaceGatewayUrl');
    const canaryInput = document.getElementById('workspaceRolloutPercent');
    const cacheToggle = document.getElementById('workspaceGatewayCacheEnabled');

    window.apiClient.get('/config')
        .then((config) => {
            if (gatewayUrlInput) gatewayUrlInput.value = config.HYBRID_GATEWAY_URL || '';
            if (canaryInput) canaryInput.value = config.HYBRID_GATEWAY_CANARY_PERCENT ?? 30;
            if (cacheToggle) cacheToggle.checked = config.HYBRID_GATEWAY_CACHE_ENABLED !== false;
            const area = document.getElementById('workspaceCheatSheet');
            if (area) area.value = generateCheatSheet();
        })
        .catch(() => {
            const area = document.getElementById('workspaceCheatSheet');
            if (area) area.value = generateCheatSheet();
        });
}

function initWorkspaceManager() {
    if (!document.getElementById('workspace')) return;
    renderOauthMatrix();
    bindWorkspaceEvents();
    loadWorkspaceDefaultsFromConfig();
    updateStepView();
}

export { initWorkspaceManager };
