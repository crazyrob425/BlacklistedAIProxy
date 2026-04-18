# BlacklistedAPI Provider Integration Guide

This guide explains how to integrate a new model provider into BlacklistedAPI, including backend services, adapter registration, provider pool setup, and frontend UI updates.

## 1. Integration Flow Overview

1. **Backend constants**: Add provider identifiers in `src/utils/common.js`.
2. **Core provider service**: Implement provider request logic under `src/providers/`.
3. **Adapter registration**: Register and implement the provider adapter in `src/providers/adapter.js`.
4. **Models and provider-pool config**: Update `src/providers/provider-models.js` and `src/providers/provider-pool-manager.js`.
5. **Frontend UI updates**:
   - `static/app/provider-manager.js`: provider-pool display and ordering
   - `static/app/file-upload.js`: upload path mapping
   - `static/app/modal.js`: config field ordering
   - `static/app/utils.js`: field metadata definitions
   - `static/components/section-config.html`: config buttons
   - `static/components/section-guide.html`: user guide content
   - `static/app/routing-examples.js`: routing examples
6. **System-level mapping (required)**: Add mapping support in OAuth handlers, credential association utilities, usage reporting, and related modules.

---

## 2. Backend Core Implementation

### 2.1 Define constants
Update [`src/utils/common.js`](src/utils/common.js) and add a new key to `MODEL_PROVIDER` (recommended format: `protocol-name-type`).

### 2.2 Implement the core service
Create a new provider directory under `src/providers/` and implement `NewProviderApiService`.

**Required methods**:
- `constructor(config)`
- `initialize()`
- `listModels()`
- `generateContent()`
- `generateContentStream()`

**Optional methods**:
- `getUsageLimits()` if usage-quota lookup is supported
- `countTokens()` if token counting is supported

### 2.3 Register the adapter
In [`src/providers/adapter.js`](src/providers/adapter.js):
1. Extend `ApiServiceAdapter` and implement a provider-specific adapter class.
2. Override adapter methods as needed (`generateContent`, `generateContentStream`, `listModels`, `getUsageLimits`, `countTokens`, `refreshToken`) and delegate to the core service.
3. Add a matching `switch` case in `getServiceAdapter` and return the proper adapter instance based on `MODEL_PROVIDER`.

### 2.4 Add model and provider-pool defaults
- **Model list**: Add default model IDs in `PROVIDER_MODELS` in [`src/providers/provider-models.js`](src/providers/provider-models.js).
- **Health-check defaults**: Update [`src/providers/provider-pool-manager.js`](src/providers/provider-pool-manager.js):
  - `DEFAULT_HEALTH_CHECK_MODELS`: default model used for health checks
  - `checkAndRefreshExpiringNodes`: credential path key mapping
  - `_buildHealthCheckRequests`: provider-specific health-check request format (if needed)

---

## 3. Frontend UI Updates

### 3.1 Field definitions and metadata ([`static/app/utils.js`](static/app/utils.js))
In `getProviderTypeFields`, define provider-specific config fields (for example API key, base URL, credential path), including input type and placeholder text.

### 3.2 Field display order ([`static/app/modal.js`](static/app/modal.js))
In `getFieldOrder`, add the provider-specific field ordering under `fieldOrderMap`.

### 3.3 Provider-pool display logic ([`static/app/provider-manager.js`](static/app/provider-manager.js))
- **Display order**: Add provider identifiers and display names to `providerConfigs`.
- **Auth button**: If OAuth is supported, add the provider to `oauthProviders` in `generateAuthButton`.
- **Auth flow**: If OAuth or bulk import is supported, add trigger logic in `handleGenerateAuthUrl`.

### 3.4 Credential upload routing ([`static/app/file-upload.js`](static/app/file-upload.js))
Update `getProviderKey` and map provider IDs to `configs/` subdirectory names (for example: `new-provider-api` -> `new-provider`).

### 3.5 Credential-file management filters
Add support in all three locations below:

#### 3.5.1 HTML filter option ([`static/components/section-upload-config.html`](static/components/section-upload-config.html))
Add a new `<option>` inside the `<select id="configProviderFilter">` element:
```html
<option value="new-provider-type" data-i18n="upload.providerFilter.newProvider">New Provider OAuth</option>
```

#### 3.5.2 JavaScript provider mapping ([`static/app/upload-config-manager.js`](static/app/upload-config-manager.js))
In `detectProviderFromPath()`, add a mapping entry:
```javascript
{
    patterns: ['configs/new-provider/', '/new-provider/'],
    providerType: 'new-provider-type',
    displayName: 'New Provider OAuth',
    shortName: 'new-provider-oauth'
}
```

#### 3.5.3 Translation strings ([`static/app/i18n.js`](static/app/i18n.js))
Add the required provider filter, config labels, and auth-step strings to the translation map.

### 3.6 Config management UI ([`static/components/section-config.html`](static/components/section-config.html))
- **Required**: Add a provider-tag button in `#modelProvider` (provider initialization section).
- **Optional**: Also add it in `#proxyProviders` (proxy toggle section).

### 3.7 Routing examples ([`static/app/routing-examples.js`](static/app/routing-examples.js))
Add the provider route definition to `routingConfigs` and protocol conversion details in `generateCurlExample`.

### 3.8 Guide/tutorial content ([`static/components/section-guide.html`](static/components/section-guide.html))
- Add provider support details under “Supported Model Providers.”
- Add client path guidance under “Client Configuration Guide.”

---

## 4. Global System Mapping (Critical)

To ensure complete provider support (such as multi-account switching and usage monitoring), add mappings in all of the following:

### 4.1 Credential path key mapping ([`src/services/service-manager.js`](src/services/service-manager.js))
Add the provider’s credential path key to `credPathKey` mapping used around `getServiceAdapter` logic.

### 4.2 Auto-association utility ([`src/utils/provider-utils.js`](src/utils/provider-utils.js))
Add a rule to `CONFIG_FILE_PATTERNS` so credential files are detected and linked automatically:
```javascript
{
    patterns: ['configs/new-dir/', '/new-dir/'],
    providerType: 'new-provider-api',
    credPathKey: 'NEW_PROVIDER_CREDS_FILE_PATH'
}
```

### 4.3 Usage reporting mapping ([`src/ui-modules/usage-api.js`](src/ui-modules/usage-api.js))
- Add the provider ID to `supportedProviders`.
- Add the provider credential path key to `credPathKey` mapping.
- Add provider-specific formatting in `getAdapterUsage` when needed.

### 4.4 OAuth handlers
- **Handler export**: Export the provider handler in `src/auth/oauth-handlers.js`.
- **Route dispatch**: Dispatch requests in `handleGenerateAuthUrl` in [`src/ui-modules/oauth-api.js`](src/ui-modules/oauth-api.js).
- **Callback handling**: If HTTP callbacks are required, implement the callback server logic under `src/auth/`.

---

## 5. Implementation Notes

1. **Protocol alignment**: This project internally defaults to Gemini protocol. If an upstream provider uses OpenAI protocol, add conversion logic under `src/convert/` or normalize in the core service.
2. **Security**: Do not hardcode API keys in core code; always read credentials from runtime config.
3. **Error handling**: Core services should throw normalized errors (including HTTP status) so provider-pool logic can quarantine invalid accounts. `401`/`403` often trigger UUID refresh or credential switching.
4. **Async refresh**: Use the V2 read/write split architecture and run expensive auth logic in `refreshToken` asynchronously.
