/**
 * Marketplace Manager — Frontend
 *
 * Manages the Plugin Marketplace section UI.  Fetches catalog from the backend,
 * renders cards in a VSCode-style grid, and drives a detail side-panel.
 */

import { apiClient } from './auth.js';

// ── State ─────────────────────────────────────────────────────────────────────

let _catalog       = [];
let _categories    = [];
let _activeTab     = 'all';
let _searchQuery   = '';
let _sortBy        = 'featured';
let _selectedId    = null;

// ── DOM refs (resolved after componentsLoaded) ────────────────────────────────

function $(id) { return document.getElementById(id); }

// ── Initialisation ────────────────────────────────────────────────────────────

export function initMarketplaceManager() {
    window.addEventListener('componentsLoaded', () => {
        _bind();
        // Load when user clicks the marketplace sidebar nav item
        const navItem = document.querySelector('[data-section="marketplace"]');
        navItem?.addEventListener('click', _loadIfNeeded);

        // Also load immediately when the page is opened directly to the
        // marketplace section via ?section=marketplace or #marketplace
        if (_isMarketplaceSectionActive()) {
            void _loadIfNeeded();
        }

        // Handle hash-based navigation (e.g. clicking a direct link)
        window.addEventListener('hashchange', () => {
            if (_isMarketplaceSectionActive()) void _loadIfNeeded();
        });
    });
}

function _isMarketplaceSectionActive() {
    const params = new URLSearchParams(window.location.search);
    const hash   = window.location.hash.replace(/^#/, '');
    return params.get('section') === 'marketplace' || hash === 'marketplace';
}

let _loaded = false;

async function _loadIfNeeded() {
    if (_loaded) return;
    _loaded = true;
    await loadMarketplace();
}

// ── Data loading ──────────────────────────────────────────────────────────────

export async function loadMarketplace() {
    try {
        const resp = await apiClient.get('/api/marketplace/catalog');
        if (!resp.success) throw new Error(resp.error?.message ?? 'Failed');

        _catalog    = resp.data.catalog    ?? [];
        _categories = resp.data.categories ?? [];

        _renderCategories(resp.data.stats);
        _renderStats(resp.data.stats);
        _renderGrid();
    } catch (err) {
        console.error('[Marketplace] Load error:', err.message);
        const grid = $('marketplaceGrid');
        if (grid) {
            grid.innerHTML = `
                <div class="marketplace-empty">
                    <i class="fas fa-exclamation-triangle"></i>
                    <span>Failed to load marketplace: ${err.message}</span>
                </div>`;
        }
    }
}

// ── Render categories ─────────────────────────────────────────────────────────

function _renderCategories(stats) {
    const tabs = $('marketplaceTabs');
    if (!tabs) return;

    // Count per category
    const counts = {};
    for (const p of _catalog) {
        counts[p.category] = (counts[p.category] ?? 0) + 1;
    }
    const totalInstalled = _catalog.filter(p => p.installed).length;
    const totalFeatured  = _catalog.filter(p => p.featured).length;

    const catData = [
        { id: 'all',       label: 'All',       icon: 'fa-grid-2',       count: _catalog.length },
        { id: 'installed', label: 'Installed',  icon: 'fa-check-circle', count: totalInstalled },
        { id: 'featured',  label: 'Featured',   icon: 'fa-star',         count: totalFeatured },
        ...(_categories
            .filter(c => c.id !== 'all' && c.id !== 'installed' && c.id !== 'featured')
            .map(c => ({ ...c, count: counts[c.id] ?? 0 }))
        ),
    ];

    tabs.innerHTML = catData.map(c => `
        <button class="mtab${c.id === _activeTab ? ' active' : ''}"
                data-cat="${c.id}"
                role="tab"
                aria-selected="${c.id === _activeTab}">
            <i class="fas ${c.icon}" aria-hidden="true"></i>
            ${c.label}
            ${c.count != null ? `<span class="mtab-count">${c.count}</span>` : ''}
        </button>
    `).join('');

    tabs.querySelectorAll('.mtab').forEach(btn => {
        btn.addEventListener('click', () => {
            _activeTab = btn.dataset.cat;
            tabs.querySelectorAll('.mtab').forEach(b => {
                b.classList.toggle('active', b.dataset.cat === _activeTab);
                b.setAttribute('aria-selected', b.dataset.cat === _activeTab);
            });
            _renderGrid();
        });
    });
}

// ── Render stats bar ──────────────────────────────────────────────────────────

function _renderStats(stats) {
    const s = stats ?? {};
    const t = $('mstatTotal');     if (t) t.textContent = s.total     ?? _catalog.length;
    const i = $('mstatInstalled'); if (i) i.textContent = s.installed ?? '–';
    const f = $('mstatFeatured');  if (f) f.textContent = s.featured  ?? '–';
    const e = $('mstatEnabled');   if (e) e.textContent = s.enabled   ?? '–';
}

// ── Render grid ───────────────────────────────────────────────────────────────

function _renderGrid() {
    const grid = $('marketplaceGrid');
    if (!grid) return;

    // Filter
    let visible = _catalog.filter(p => {
        if (_activeTab === 'installed') return p.installed;
        if (_activeTab === 'featured')  return p.featured;
        if (_activeTab !== 'all')       return p.category === _activeTab;
        return true;
    });

    if (_searchQuery) {
        const q = _searchQuery.toLowerCase();
        visible = visible.filter(p =>
            p.name.toLowerCase().includes(q) ||
            p.description.toLowerCase().includes(q) ||
            (p.tags ?? []).some(t => t.toLowerCase().includes(q))
        );
    }

    // Sort
    visible = [...visible].sort((a, b) => {
        if (_sortBy === 'name')     return a.name.localeCompare(b.name);
        if (_sortBy === 'rating')   return (b.rating?.score ?? 0) - (a.rating?.score ?? 0);
        if (_sortBy === 'installs') return (b.installs ?? 0) - (a.installs ?? 0);
        // featured: installed first, then featured, then rest
        const aScore = (a.installed ? 2 : 0) + (a.featured ? 1 : 0);
        const bScore = (b.installed ? 2 : 0) + (b.featured ? 1 : 0);
        return bScore - aScore;
    });

    if (visible.length === 0) {
        grid.innerHTML = `
            <div class="marketplace-empty">
                <i class="fas fa-search"></i>
                <span>No plugins match your search.</span>
            </div>`;
        return;
    }

    grid.innerHTML = visible.map(p => _cardHtml(p)).join('');

    grid.querySelectorAll('.mcard').forEach(card => {
        card.addEventListener('click', () => _showDetail(card.dataset.id));
        card.querySelector('.mcard-btn-detail')?.addEventListener('click', e => {
            e.stopPropagation();
            _showDetail(card.dataset.id);
        });
        card.querySelector('.mcard-btn-dash')?.addEventListener('click', e => {
            e.stopPropagation();
            const plugin = _catalog.find(p => p.id === card.dataset.id);
            if (plugin?.dashboardUrl) window.open(plugin.dashboardUrl, '_blank');
        });
    });
}

// ── Card HTML ─────────────────────────────────────────────────────────────────

function _cardHtml(p) {
    const trust = {
        official:  { cls: 'mbadge-official',  label: 'Official'  },
        verified:  { cls: 'mbadge-verified',   label: 'Verified'  },
        community: { cls: 'mbadge-community',  label: 'Community' },
    }[p.trustTier] ?? { cls: 'mbadge-community', label: 'Community' };

    const stars = _starsHtml(p.rating?.score ?? 0);

    const badgesHtml = [
        `<span class="mbadge ${trust.cls}">${trust.label}</span>`,
        p.installed ? '<span class="mbadge mbadge-installed">Installed</span>' : '',
        p.featured  ? '<span class="mbadge mbadge-featured">Featured</span>'   : '',
    ].filter(Boolean).join('');

    const dashBtn = p.dashboardUrl
        ? `<button class="mcard-btn mcard-btn-dash" title="Open Dashboard"><i class="fas fa-external-link-alt"></i></button>`
        : '';

    return `
        <article class="mcard${p.id === _selectedId ? ' selected' : ''}"
                 data-id="${p.id}"
                 role="listitem"
                 tabindex="0"
                 aria-label="${_esc(p.name)} plugin">
            <div class="mcard-header">
                <span class="mcard-icon" style="background:${p.iconColor ?? '#6b7280'}">
                    <i class="fas ${p.icon ?? 'fa-puzzle-piece'}"></i>
                </span>
                <div class="mcard-meta">
                    <div class="mcard-name">
                        ${_esc(p.name)}
                        <span class="mcard-version">v${_esc(p.version)}</span>
                    </div>
                    <div class="mcard-author">${_esc(p.author?.name ?? '')}</div>
                </div>
            </div>
            <p class="mcard-desc">${_esc(p.description)}</p>
            <div class="mcard-footer">
                <div class="mcard-badges">${badgesHtml}</div>
                <div class="mcard-actions">
                    ${stars}
                    <button class="mcard-btn mcard-btn-detail" title="Details"><i class="fas fa-info-circle"></i></button>
                    ${dashBtn}
                </div>
            </div>
        </article>`;
}

// ── Detail panel ──────────────────────────────────────────────────────────────

function _showDetail(id) {
    const plugin = _catalog.find(p => p.id === id);
    if (!plugin) return;

    _selectedId = id;
    // Rerender cards to show selection
    document.querySelectorAll('.mcard').forEach(c => {
        c.classList.toggle('selected', c.dataset.id === id);
    });

    const panel = $('marketplaceDetail');
    if (!panel) return;
    panel.hidden = false;

    // Header
    const iconEl = $('detailIcon');
    if (iconEl) {
        iconEl.style.background = plugin.iconColor ?? '#6b7280';
        iconEl.innerHTML = `<i class="fas ${plugin.icon ?? 'fa-puzzle-piece'}"></i>`;
    }
    const nameEl   = $('detailName');   if (nameEl)   nameEl.textContent   = plugin.name;
    const authorEl = $('detailAuthor'); if (authorEl) authorEl.textContent = `${plugin.author?.name ?? ''} · v${plugin.version}`;

    const badgesEl = $('detailBadges');
    if (badgesEl) {
        const trust = { official: 'Official', verified: 'Verified', community: 'Community' }[plugin.trustTier] ?? 'Community';
        const tcls  = { official: 'mbadge-official', verified: 'mbadge-verified', community: 'mbadge-community' }[plugin.trustTier] ?? 'mbadge-community';
        badgesEl.innerHTML = [
            `<span class="mbadge ${tcls}">${trust}</span>`,
            plugin.installed ? '<span class="mbadge mbadge-installed">Installed</span>' : '',
            plugin.enabled   ? '<span class="mbadge mbadge-enabled">Active</span>'      : '',
            plugin.featured  ? '<span class="mbadge mbadge-featured">Featured</span>'   : '',
        ].filter(Boolean).join('');
    }

    // Actions
    const actionsEl = $('detailActions');
    if (actionsEl) {
        const dashBtn = plugin.dashboardUrl
            ? `<a class="detail-action-btn secondary" href="${plugin.dashboardUrl}" target="_blank"><i class="fas fa-external-link-alt"></i> Dashboard</a>`
            : '';
        const repoBtn = plugin.repository
            ? `<a class="detail-action-btn secondary" href="${plugin.repository}" target="_blank"><i class="fab fa-github"></i> Source</a>`
            : '';
        actionsEl.innerHTML = `${dashBtn}${repoBtn}`;
    }

    // Activate Overview tab
    _activateDetailTab('overview', plugin);

    panel.querySelectorAll('.dtab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === 'overview');
        tab.onclick = () => {
            panel.querySelectorAll('.dtab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            _activateDetailTab(tab.dataset.tab, plugin);
        };
    });

    // Close button
    const closeBtn = $('detailClose');
    if (closeBtn) {
        closeBtn.onclick = () => {
            panel.hidden = true;
            _selectedId  = null;
            document.querySelectorAll('.mcard').forEach(c => c.classList.remove('selected'));
        };
    }
}

function _activateDetailTab(tab, plugin) {
    const content = $('detailContent');
    if (!content) return;

    if (tab === 'overview') {
        const capsHtml = (plugin.capabilities ?? [])
            .map(c => `<span class="detail-cap">${c}</span>`)
            .join('');
        const tagsHtml = (plugin.tags ?? [])
            .map(t => `<code>${_esc(t)}</code>`)
            .join(' ');
        content.innerHTML = `
            <h4>Description</h4>
            <p>${_esc(plugin.description)}</p>
            ${plugin.longDescription ? `<div class="detail-long-desc">${_renderMarkdown(plugin.longDescription)}</div>` : ''}
            <h4>Capabilities</h4>
            <div class="detail-caps">${capsHtml || '—'}</div>
            <h4>Tags</h4>
            <p>${tagsHtml || '—'}</p>
            <h4>Details</h4>
            <table style="width:100%;font-size:0.8rem;border-collapse:collapse">
                <tr><td style="color:var(--text-secondary);padding:0.2rem 0.5rem 0.2rem 0">Category</td><td>${_esc(plugin.category)}</td></tr>
                <tr><td style="color:var(--text-secondary);padding:0.2rem 0.5rem 0.2rem 0">License</td><td>${_esc(plugin.license ?? '—')}</td></tr>
                <tr><td style="color:var(--text-secondary);padding:0.2rem 0.5rem 0.2rem 0">Size</td><td>${_esc(plugin.size ?? '—')}</td></tr>
                <tr><td style="color:var(--text-secondary);padding:0.2rem 0.5rem 0.2rem 0">Min version</td><td>${_esc(plugin.minCoreVersion ?? '—')}</td></tr>
            </table>`;
    } else if (tab === 'changelog') {
        const entries = plugin.changelog ?? [];
        content.innerHTML = entries.length === 0
            ? '<p>No changelog available.</p>'
            : entries.map(e => `
                <div class="changelog-entry">
                    <span class="changelog-version">v${_esc(e.version)}</span>
                    <span class="changelog-date">${_esc(e.date ?? '')}</span>
                    <p class="changelog-notes">${_esc(e.notes ?? '')}</p>
                </div>`).join('');
    } else if (tab === 'settings') {
        content.innerHTML = plugin.configurable && plugin.dashboardUrl
            ? `<p>This plugin has a dedicated configuration dashboard.</p>
               <a class="detail-settings-link" href="${plugin.dashboardUrl}" target="_blank">
                   <i class="fas fa-external-link-alt"></i> Open Plugin Dashboard
               </a>`
            : (plugin.configurable
                ? '<p>This plugin can be configured via the REST API. See the API documentation.</p>'
                : '<p>This plugin has no configurable settings.</p>');
    }
}

// ── Bind event handlers ───────────────────────────────────────────────────────

function _bind() {
    const search = $('marketplaceSearch');
    if (search) {
        search.addEventListener('input', () => {
            _searchQuery = search.value.trim();
            _renderGrid();
        });
    }

    const sort = $('marketplaceSort');
    if (sort) {
        sort.addEventListener('change', () => {
            _sortBy = sort.value;
            _renderGrid();
        });
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _starsHtml(score) {
    const full  = Math.floor(score);
    const half  = score - full >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return `<span class="mcard-rating">
        ${'<i class="fas fa-star"></i>'.repeat(full)}
        ${half ? '<i class="fas fa-star-half-alt"></i>' : ''}
        ${'<i class="far fa-star"></i>'.repeat(empty)}
        <span class="rating-num">${score.toFixed(1)}</span>
    </span>`;
}

function _esc(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Very basic markdown → safe HTML (headers, bold, code, lists) */
function _renderMarkdown(md) {
    if (!md) return '';
    return md
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm,  '<h3 style="font-size:0.9rem;margin:0.75rem 0 0.3rem">$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`]+)`/g,      '<code>$1</code>')
        .replace(/^- (.+)$/gm,      '<li>$1</li>')
        .replace(/(<li>[\s\S]+?<\/li>)/g, '<ul>$1</ul>')
        .replace(/\n{2,}/g, '<br><br>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
}
