# BlacklistedAIProxy WRB Desktop (Tauri)

Native Windows wrapper for the WRB dashboard with a premium tabbed cockpit layout.

## Features

- Native Tauri desktop shell for WRB dashboard
- High-end tabbed UX (Dashboard, Workspace, Providers, Config, Usage, Logs, Plugins)
- Smooth animations, glow effects, glass styling, and interaction polish
- Loads existing WRB web dashboard sections via deep-link section routing

## Third-party OSS GitHub repositories integrated

1. **Tauri** — https://github.com/tauri-apps/tauri  
   Native Windows app shell and window APIs.
## Six additional GitHub OSS repos used for premium UI/UX

1. **GSAP** — https://github.com/greensock/GSAP  
   Motion choreography for premium interaction feel.
2. **Shoelace** — https://github.com/shoelace-style/shoelace  
   Modern Web Component tab primitives and controls.
3. **Floating UI** — https://github.com/floating-ui/floating-ui  
   Smart tooltip positioning for polished micro-interactions.
4. **Chart.js** — https://github.com/chartjs/Chart.js  
   Header sparkline telemetry widget.
5. **Lucide** — https://github.com/lucide-icons/lucide  
   Consistent iconography for tab navigation and actions.
6. **VanillaTilt.js** — https://github.com/micku7zu/vanilla-tilt.js  
   Subtle depth/tilt effect on glass panels.

> Note: The UI stack intentionally combines multiple lightweight OSS components to create a luxury dashboard aesthetic.

## Run

```bash
cd desktop/wrb-dashboard-tauri
npm install
npm run tauri:dev
```

## Build

```bash
cd desktop/wrb-dashboard-tauri
npm run tauri:build
```
