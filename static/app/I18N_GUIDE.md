# Localization Guide

## Overview

This project supports localization through a centralized translation system. If you plan to add or maintain localized text, use the guidance below to keep translations consistent and maintainable.

## File Structure

```
static/app/
├── i18n.js                 # Localization configuration (all translation strings)
├── language-switcher.js    # Language switcher component
└── I18N_GUIDE.md           # This guide
```

## How to Use

### 1. Add localization hooks in HTML

Mark translatable elements with `data-i18n`:

```html
<!-- Text content -->
<h1 data-i18n="header.title">BlacklistedAPI Admin Console</h1>

<!-- Button text -->
<button data-i18n="common.save">Save</button>

<!-- Input placeholder -->
<input type="text" data-i18n="config.apiKeyPlaceholder" placeholder="Please enter API key">

<!-- Parameterized translation -->
<span data-i18n="upload.count" data-i18n-params='{"count": "10"}'>10 config files</span>
```

### 2. Use translations in JavaScript

```javascript
import { t } from './i18n.js';

// Simple translation
const title = t('header.title');

// Parameterized translation
const message = t('upload.count', { count: 10 });

// Use in toast
showToast(t('common.success'), t('config.saved'), 'success');
```

### 3. Add new translation keys

Add keys under `translations` in `i18n.js`:

```javascript
const translations = {
    'en-US': {
        'your.key': 'Your English translation'
        // ...
    }
};
```

### 4. Translate dynamic content

For dynamic DOM content, apply `data-i18n` and call `t()` when creating elements:

```javascript
const element = document.createElement('div');
element.setAttribute('data-i18n', 'your.translation.key');
element.textContent = t('your.translation.key');
```

## Translation Key Naming

Use dot-separated hierarchical keys:

- `header.*` - Header
- `nav.*` - Navigation
- `dashboard.*` - Dashboard
- `config.*` - Configuration
- `providers.*` - Providers
- `upload.*` - Upload configuration
- `usage.*` - Usage
- `logs.*` - Logs
- `common.*` - Shared/common text

## Implemented Capabilities

- Automatically detect and persist user language preference
- Preserve language selection after page refresh
- Auto-translate dynamically added elements
- Support parameterized translations
- Refresh page text in real time when language changes

## Areas That Typically Need Additional Coverage

In larger pages, confirm these areas consistently include `data-i18n` keys:

1. Form labels and hints in configuration pages
2. Detailed provider-pool metadata
3. Configuration list row fields
4. Usage statistics details
5. Real-time log control buttons

## Example: Fully Localized Form

```html
<div class="form-group">
    <label data-i18n="config.apiKey">API Key</label>
    <input
        type="password"
        id="apiKey"
        class="form-control"
        data-i18n="config.apiKeyPlaceholder"
        placeholder="Please enter API key"
    >
</div>
```

Matching translation keys:

```javascript
'en-US': {
    'config.apiKey': 'API Key',
    'config.apiKeyPlaceholder': 'Please enter API key'
}
```

## Notes

1. Every translation key should exist in each supported language pack.
2. Parameterized translations use `{paramName}` placeholders.
3. For rich HTML content, use `data-i18n-html`.
4. Language switching triggers the `languageChanged` event.
5. Newly inserted DOM nodes should be processed by the translation system.

## Debugging

In the browser console:

```javascript
// Get current language
import { getCurrentLanguage } from './app/i18n.js';
console.log(getCurrentLanguage());

// Switch language manually
import { setLanguage } from './app/i18n.js';
setLanguage('en-US');
```
