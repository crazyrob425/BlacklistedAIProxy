/**
 * 自定义模型管理类 - 修复版
 */
import { getProviderConfigs } from './utils.js';

export class CustomModelsManager {
    constructor() {
        this.models = [];
        this.providers = []; // 存储带名称的配置对象
        this.initEventListeners();
        console.log('✅ [Custom Models] Manager Initialized');
    }

    /**
     * 极简事件绑定，处理全局点击
     */
    initEventListeners() {
        document.addEventListener('click', (e) => {
            // 添加按钮
            const addBtn = e.target.closest('#addCustomModelBtn');
            if (addBtn) {
                this.openAddModal();
                return;
            }

            // 保存按钮
            const saveBtn = e.target.closest('#saveCustomModelBtn');
            if (saveBtn) {
                this.saveModel();
                return;
            }

            // 关闭按钮
            const closeBtn = e.target.closest('#customModelModal .modal-close, #customModelModal .close-modal');
            if (closeBtn) {
                this.closeModal('customModelModal');
                return;
            }

            // 编辑按钮
            const editBtn = e.target.closest('.edit-model-btn');
            if (editBtn) {
                this.openEditModal(editBtn.dataset.id);
                return;
            }

            // 删除按钮
            const delBtn = e.target.closest('.delete-model-btn');
            if (delBtn) {
                this.deleteModel(delBtn.dataset.id);
                return;
            }
        });
    }

    async load() {
        try {
            await Promise.all([
                this.loadModels(),
                this.loadProviders()
            ]);
            this.render();
        } catch (error) {
            console.error('[Custom Models] Load error:', error);
        }
    }

    async loadModels() {
        const client = window.apiClient;
        if (!client) return;
        try {
            const data = await client.get('/custom-models');
            this.models = data || [];
        } catch (e) { console.error(e); }
    }

    async loadProviders() {
        const client = window.apiClient;
        if (!client) return;
        try {
            const response = await client.get('/providers');
            if (response && response.supportedProviders) {
                // 使用 utils 中的标准方法处理提供商列表，获取友好名称
                this.providers = getProviderConfigs(response.supportedProviders);
                this.updateProviderOptions();
            }
        } catch (e) { console.error(e); }
    }

    updateProviderOptions() {
        ['customModelProvider', 'customModelActualProvider'].forEach(selectId => {
            const select = document.getElementById(selectId);
            if (!select || select.tagName !== 'SELECT') return;

            select.innerHTML = '';

            // 遵循 getProviderConfigs 返回的预设顺序，不再手动进行字母排序
            this.providers
                .filter(p => p.visible !== false)
                .forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    select.appendChild(opt);
                });
        });
    }

    formatNumber(num) {
        if (num === undefined || num === null || num === '') return '';
        const value = Number(num);
        if (!Number.isFinite(value)) return num;

        const absValue = Math.abs(value);
        const formatScaled = (scaled) => String(Math.round(scaled * 10) / 10);

        if (absValue >= 1000000 && value % 1000000 === 0) return `${formatScaled(value / 1000000)}M`;
        if (absValue >= 1024 * 1024 && value % (1024 * 1024) === 0) {
            return `${formatScaled(value / (1024 * 1024))}M`;
        }
        if (absValue >= 1000 && value % 1000 === 0) return `${formatScaled(value / 1000)}K`;
        if (absValue >= 1024 && value % 1024 === 0) return `${formatScaled(value / 1024)}K`;
        if (absValue >= 1000000) return `${formatScaled(value / 1000000)}M`;
        if (absValue >= 1000) return `${formatScaled(value / 1000)}K`;
        return String(value);
    }

    getProviderDisplayName(providerId) {
        if (!providerId) return '-';
        const config = this.providers.find(p => p.id === providerId || p.name === providerId);
        return config ? config.name : providerId;
    }

    renderProviderCell(model) {
        const displayProvider = model.provider || '';
        const displayName = this.getProviderDisplayName(displayProvider);

        return `
            <div class="provider-route-cell">
                <span class="model-list-chip" title="${displayProvider}">
                    <span class="chip-icon"><i class="fas fa-server"></i></span>
                    <span class="chip-text">${displayName}</span>
                </span>
            </div>
        `;
    }

    renderActualRouteCell(model) {
        const actualProvider = model.actualProvider || model.provider || '';
        const actualName = this.getProviderDisplayName(actualProvider);
        const actualModel = model.actualModel || model.id;

        return `
            <div class="actual-route-cell">
                <span class="model-list-chip" title="${actualProvider}">
                    <span class="chip-icon"><i class="fas fa-server"></i></span>
                    <span class="chip-text">${actualName}</span>
                </span>
                <span class="model-list-chip" title="${actualModel}">
                    <span class="chip-icon"><i class="fas fa-cube"></i></span>
                    <code class="chip-text actual-id-code">${actualModel}</code>
                </span>
            </div>
        `;
    }

    render() {
        const tbody = document.getElementById('customModelsTableBody');
        if (!tbody) return;

        if (this.models.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="table-empty-state">
                        <div class="empty-icon"><i class="fas fa-cubes"></i></div>
                        <div class="empty-text" data-i18n="customModels.noModels">暂无自定义模型</div>
                        <div class="empty-hint">点击“添加模型”按钮开始创建</div>
                    </td>
                </tr>`;
            if (window.i18n) window.i18n.translateElement(tbody);
            return;
        }

        tbody.innerHTML = this.models.map(model => `
            <tr>
                <td>
                    <div class="model-id-cell">
                        <span class="main-id">${model.id}</span>
                        ${model.alias ? `<span class="alias-tag"><i class="fas fa-link"></i> ${model.alias}</span>` : ''}
                    </div>
                </td>
                <td class="model-name-cell"><span>${model.name || '-'}</span></td>
                <td>${this.renderProviderCell(model)}</td>
                <td>${this.renderActualRouteCell(model)}</td>
                <td>
                    <div class="params-group">
                        ${model.contextLength ? `<span class="param-pill ctx" title="Context Length"><i class="fas fa-align-left"></i> ${this.formatNumber(model.contextLength)}</span>` : ''}
                        ${model.maxTokens ? `<span class="param-pill tokens" title="Max Tokens"><i class="fas fa-outdent"></i> ${this.formatNumber(model.maxTokens)}</span>` : ''}
                        ${(model.temperature !== undefined && model.temperature !== null && !isNaN(model.temperature)) ? `<span class="param-pill temp" title="Temperature"><i class="fas fa-thermometer-half"></i> ${model.temperature}</span>` : ''}
                        ${(model.topP !== undefined && model.topP !== null && !isNaN(model.topP)) ? `<span class="param-pill topp" title="Top P"><i class="fas fa-percentage"></i> ${model.topP}</span>` : ''}
                    </div>
                </td>
                <td>
                    <div class="action-buttons">
                        <button class="icon-btn edit edit-model-btn" data-id="${model.id}" title="编辑模型">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="icon-btn delete delete-model-btn" data-id="${model.id}" title="删除模型">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    }

    showModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.add('show');
        }
    }

    closeModal(id) {
        const modal = document.getElementById(id);
        if (modal) {
            modal.classList.remove('show');
        }
    }

    openAddModal() {
        this.updateProviderOptions();
        const form = document.getElementById('customModelForm');
        if (form) form.reset();
        
        const idInput = document.getElementById('modelId');
        if (idInput) {
            idInput.disabled = false;
            idInput.value = '';
        }
        
        const origIdInput = document.getElementById('editModelOriginalId');
        if (origIdInput) origIdInput.value = '';
        
        this.showModal('customModelModal');
    }

    openEditModal(id) {
        const model = this.models.find(m => m.id === id);
        if (!model) return;

        this.updateProviderOptions();
        
        const origIdInput = document.getElementById('editModelOriginalId');
        if (origIdInput) origIdInput.value = model.id;
        
        const idInput = document.getElementById('modelId');
        if (idInput) {
            idInput.value = model.id;
            idInput.disabled = true;
        }

        const fields = {
            'modelName': 'name',
            'modelAlias': 'alias',
            'customModelProvider': 'provider',
            'customModelActualProvider': 'actualProvider',
            'actualModel': 'actualModel',
            'contextLength': 'contextLength',
            'maxTokens': 'maxTokens',
            'temperature': 'temperature',
            'topP': 'topP',
            'modelDescription': 'description'
        };
        
        Object.keys(fields).forEach(fieldId => {
            const el = document.getElementById(fieldId);
            if (!el) return;
            if (fieldId === 'customModelActualProvider') {
                el.value = model.actualProvider || model.provider || '';
                return;
            }
            el.value = model[fields[fieldId]] ?? '';
        });

        this.showModal('customModelModal');
    }

    async saveModel() {
        const form = document.getElementById('customModelForm');
        if (!form || !form.checkValidity()) {
            form?.reportValidity();
            return;
        }

        const getVal = (id) => document.getElementById(id)?.value ?? '';
        const getNum = (id, isFloat = false) => {
            const val = getVal(id).trim();
            if (val === '') return null;

            const parsed = isFloat ? parseFloat(val) : parseInt(val, 10);
            return Number.isNaN(parsed) ? null : parsed;
        };
        const origId = document.getElementById('editModelOriginalId').value;

        const data = {
            id: getVal('modelId'),
            name: getVal('modelName'),
            alias: getVal('modelAlias'),
            provider: getVal('customModelProvider'),
            actualProvider: getVal('customModelActualProvider'),
            actualModel: getVal('actualModel'),
            contextLength: getNum('contextLength'),
            maxTokens: getNum('maxTokens'),
            temperature: getNum('temperature', true),
            topP: getNum('topP', true),
            description: getVal('modelDescription')
        };

        if (!origId) {
            ['contextLength', 'maxTokens', 'temperature', 'topP'].forEach(key => {
                if (data[key] === null) delete data[key];
            });
        }

        try {
            if (origId) {
                await window.apiClient.put(`/custom-models/${encodeURIComponent(origId)}`, data);
            } else {
                await window.apiClient.post('/custom-models', data);
            }
            this.closeModal('customModelModal');
            await this.load();
        } catch (e) { alert(e.message); }
    }

    async deleteModel(id) {
        if (!confirm('确定删除该自定义模型吗？')) return;
        try {
            await window.apiClient.delete(`/custom-models/${encodeURIComponent(id)}`);
            await this.load();
        } catch (e) { alert(e.message); }
    }
}
