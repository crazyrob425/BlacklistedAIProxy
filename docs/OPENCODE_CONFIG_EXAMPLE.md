# OpenCode Configuration Example and Key Notes

This document provides a typical `opencode` configuration file example and explains the most important fields so you can quickly configure multiple AI service providers.

## Configuration Example (`config.json`)

```json
{
    "plugin": [],
    "provider": {
        "kiro": {
            "npm": "@ai-sdk/anthropic",
            "name": "BlacklistedAPI-kiro",
            "options": {
                "baseURL": "http://localhost:3000/claude-kiro-oauth/v1",
                "apiKey": "123456"
            },
            "models": {
                "claude-opus-4-5": {
                    "name": "Claude Opus 4.5 Kiro"
                },
                "claude-sonnet-4-5-20250929": {
                    "name": "Claude Sonnet 4.5 Kiro"
                }
            }
        },
        "qwen": {
            "npm": "@ai-sdk/openai-compatible",
            "name": "BlacklistedAPI-qwen",
            "options": {
                "baseURL": "http://localhost:3000/openai-qwen-oauth/v1",
                "apiKey": "123456"
            },
            "models": {
                "qwen3-coder-plus": {
                    "name": "Qwen3 Coder Plus OpenAI"
                }
            }
        },
        "gemini-antigravity": {
            "npm": "@ai-sdk/google",
            "name": "BlacklistedAPI-antigravity",
            "options": {
                "baseURL": "http://localhost:3000/gemini-antigravity/v1beta",
                "apiKey": "123456"
            },
            "models": {
                "gemini-2.5-flash-preview": {
                    "name": "gemini-2.5-flash-antigravity"
                },
                "gemini-3-flash-preview": {
                    "name": "gemini-3-flash-antigravity"
                },
                "gemini-3-pro-preview": {
                    "name": "gemini-3-pro-antigravity"
                }
            }
        },
        "gemini-cli": {
            "npm": "@ai-sdk/google",
            "name": "BlacklistedAPI-geminicli",
            "options": {
                "baseURL": "http://localhost:3000/v1beta",
                "apiKey": "123456"
            },
            "models": {
                "gemini-2.5-flash-preview": {
                    "name": "gemini-2.5-flash-geminicli"
                },
                "gemini-3-flash-preview": {
                    "name": "gemini-3-flash-geminicli"
                },
                "gemini-3-pro-preview": {
                    "name": "gemini-3-pro-geminicli"
                }
            }
        }
    },
    "$schema": "https://opencode.ai/config.json"
}
```

## Key Configuration Details

### 1. `provider` (Service Provider Configuration)
This is the core section of the configuration. Each key (for example, `kiro`, `qwen`, `gemini-cli`) represents an independent provider instance.

- **`npm` (SDK adapter)**
  - Specifies the underlying AI SDK. For example:
    - `@ai-sdk/anthropic`: Anthropic (Claude) models.
    - `@ai-sdk/openai-compatible`: OpenAI-compatible models (such as Qwen).
    - `@ai-sdk/google`: Google Gemini models.
  - **Important:** The `npm` adapter must match the provider protocol, or requests may fail.

- **`options` (Connection parameters)**
  - **`baseURL`**: The API endpoint.
  - **`apiKey`**: The authentication key required by the endpoint.

- **`models` (Model mapping)**
  - Defines available models for this provider.
  - **Key (ID):** The model ID used in requests (for example, `claude-opus-4-5`).
  - **`name`:** The user-friendly name shown in the UI.
  - **Important:** Model IDs must match what the backend gateway actually supports.

### 2. Distinguish Multiple Instances of the Same Provider Type
In this example, there are two Gemini-related providers: `gemini-antigravity` and `gemini-cli`.
- Both use `@ai-sdk/google`.
- They are separated by different `baseURL` values.

This lets you connect similar model families from different gateways or environments in one config and distinguish them by custom model display names.

### 3. `$schema`
- Provides JSON schema validation.
- In supported editors (such as VS Code), this enables autocomplete and real-time validation feedback.
