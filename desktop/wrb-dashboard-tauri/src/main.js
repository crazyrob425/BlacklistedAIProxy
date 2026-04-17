import './style.css';
import 'gsap';
import '@shoelace-style/shoelace/dist/themes/dark.css';
import '@shoelace-style/shoelace/dist/components/tab-group/tab-group.js';
import '@shoelace-style/shoelace/dist/components/tab/tab.js';
import '@shoelace-style/shoelace/dist/components/tab-panel/tab-panel.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import { computePosition, offset, flip, shift } from '@floating-ui/dom';
import { Chart, LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler } from 'chart.js';
import { createIcons, icons } from 'lucide';
import VanillaTilt from 'vanilla-tilt';
import { gsap } from 'gsap';
import { getCurrentWindow } from '@tauri-apps/api/window';

Chart.register(LineController, LineElement, PointElement, LinearScale, CategoryScale, Tooltip, Filler);

const WRB_BASE_URL = 'http://127.0.0.1:3000/index.html';
const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: 'gauge' },
  { id: 'workspace', label: 'Workspace', icon: 'layout-dashboard' },
  { id: 'providers', label: 'Providers', icon: 'plug' },
  { id: 'config', label: 'Config', icon: 'sliders-horizontal' },
  { id: 'usage', label: 'Usage', icon: 'activity' },
  { id: 'logs', label: 'Logs', icon: 'scroll-text' },
  { id: 'plugins', label: 'Plugins', icon: 'sparkles' }
];

const escapeHtml = (v) => v.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

function tabUrl(id) {
  return `${WRB_BASE_URL}?section=${encodeURIComponent(id)}`;
}

function renderApp() {
  document.querySelector('#app').innerHTML = `
    <main class="shell">
      <header class="topbar glass tilt-card">
        <div class="brand-wrap">
          <div class="brand-orb"></div>
          <div class="brand-copy">
            <h1>WRB Dashboard</h1>
            <p>BlacklistedAIProxy native luxury cockpit</p>
          </div>
        </div>
        <div class="meta">
          <canvas id="healthSparkline" width="140" height="40" aria-label="Health telemetry trend"></canvas>
          <sl-button id="openBrowserBtn" variant="primary" size="small" pill>
            <i data-lucide="external-link"></i>
            Open in Browser
          </sl-button>
        </div>
      </header>

      <sl-tab-group id="tabGroup" placement="top" class="lux-tabs">
        ${tabs.map((t, i) => `
          <sl-tab slot="nav" panel="${escapeHtml(t.id)}" ${i === 0 ? 'active' : ''}>
            <i data-lucide="${escapeHtml(t.icon)}"></i>
            ${escapeHtml(t.label)}
          </sl-tab>
          <sl-tab-panel name="${escapeHtml(t.id)}" ${i === 0 ? 'active' : ''}>
            <section class="tab-surface glass">
              <div class="tab-header">
                <h2>${escapeHtml(t.label)}</h2>
                <p>Polished, flowing control surface for ${escapeHtml(t.label.toLowerCase())}.</p>
              </div>
              <iframe
                title="WRB ${escapeHtml(t.label)}"
                loading="eager"
                src="${escapeHtml(tabUrl(t.id))}"
                data-tab-id="${escapeHtml(t.id)}"
                class="wrb-frame"
              ></iframe>
            </section>
          </sl-tab-panel>
        `).join('')}
      </sl-tab-group>
      <div id="tooltip" role="tooltip" class="tooltip">Switch section</div>
    </main>
  `;
}

function initIconography() {
  createIcons({ icons });
}

function initSparkline() {
  const canvas = document.getElementById('healthSparkline');
  if (!canvas) return;
  new Chart(canvas, {
    type: 'line',
    data: {
      labels: ['0', '1', '2', '3', '4', '5', '6'],
      datasets: [{
        data: [95, 98, 97, 99, 100, 99, 100],
        borderColor: 'rgba(99, 241, 255, 0.95)',
        backgroundColor: 'rgba(99, 241, 255, 0.18)',
        pointRadius: 0,
        fill: true,
        tension: 0.45
      }]
    },
    options: {
      responsive: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, min: 90, max: 101 } }
    }
  });
}

function animateShell() {
  gsap.from('.glass', { y: 18, opacity: 0, stagger: 0.06, duration: 0.45, ease: 'power3.out' });
}

async function syncWindowTitle(activeTabId) {
  const tab = tabs.find((t) => t.id === activeTabId);
  const win = getCurrentWindow();
  await win.setTitle(`BlacklistedAIProxy WRB — ${tab ? tab.label : 'Dashboard'}`);
}

function initTooltip() {
  const tooltip = document.getElementById('tooltip');
  const navTabs = Array.from(document.querySelectorAll('sl-tab[slot="nav"]'));
  navTabs.forEach((tab) => {
    tab.addEventListener('mouseenter', async () => {
      const label = tab.textContent?.trim() || 'Section';
      tooltip.textContent = `Open ${label}`;
      tooltip.dataset.show = 'true';
      const { x, y } = await computePosition(tab, tooltip, {
        placement: 'bottom',
        middleware: [offset(10), flip(), shift({ padding: 8 })]
      });
      Object.assign(tooltip.style, { left: `${x}px`, top: `${y}px` });
    });
    tab.addEventListener('mouseleave', () => {
      delete tooltip.dataset.show;
    });
  });
}

function initTabBehaviors() {
  const tabGroup = document.getElementById('tabGroup');
  tabGroup.addEventListener('sl-tab-show', async (event) => {
    const panel = event.detail.name;
    await syncWindowTitle(panel);
    const activePanel = document.querySelector(`sl-tab-panel[name="${panel}"]`);
    if (activePanel) {
      gsap.fromTo(activePanel, { opacity: 0.5, y: 10 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' });
    }
  });
}

function initCardEffects() {
  VanillaTilt.init(document.querySelectorAll('.tilt-card'), {
    max: 5,
    speed: 450,
    glare: true,
    'max-glare': 0.22
  });
}

function initActions() {
  const btn = document.getElementById('openBrowserBtn');
  btn.addEventListener('click', () => {
    window.open(tabUrl('dashboard'), '_blank', 'noopener');
  });
}

function init() {
  renderApp();
  initIconography();
  initSparkline();
  initCardEffects();
  initTabBehaviors();
  initTooltip();
  initActions();
  animateShell();
  syncWindowTitle('dashboard');
}

init();
