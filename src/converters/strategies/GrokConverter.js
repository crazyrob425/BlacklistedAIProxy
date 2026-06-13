/**
 * Grok转换器
 * 处理Grok协议与其他协议之间的转换
 */

import { v4 as uuidv4 } from 'uuid';
import logger from '../../utils/logger.js';
import { countTextTokens } from '../../utils/token-utils.js';
import { BaseConverter } from '../BaseConverter.js';
import { MODEL_PROTOCOL_PREFIX } from '../../utils/common.js';
import { ConverterFactory } from '../ConverterFactory.js';

/**
 * Grok转换器类
 * 实现Grok协议到其他协议的转换
 */
export class GrokConverter extends BaseConverter {
    // 静态属性，确保所有实例共享最新的基础 URL 和 UUID 配置
    static sharedRequestBaseUrl = "";
    static sharedUuid = null;

    constructor() {
        super('grok');
        // 用于跟踪每个请求的状态
        this.requestStates = new Map();
        /** @type {Map<string, boolean>} 流式 Claude 转换是否已发送 message_start（按 streamRequestId） */
        this._claudeMsgStartSent = new Map();
    }

    /**
     * 设置请求的基础 URL
     */
    setRequestBaseUrl(baseUrl) {
        if (baseUrl) {
            GrokConverter.sharedRequestBaseUrl = baseUrl;
        }
    }

    /**
     * 设置账号的 UUID
     */
    setUuid(uuid) {
        if (uuid) {
            GrokConverter.sharedUuid = uuid;
        }
    }

    /**
     * 为 assets.grok.com 域名的资源 URL 添加 uuid 参数，并转换为本地代理 URL
     */
    _appendSsoToken(url, state = null) {
        const requestBaseUrl = state?.requestBaseUrl || GrokConverter.sharedRequestBaseUrl;
        const uuid = state?.uuid || GrokConverter.sharedUuid;

        if (!url || !uuid) return url;
        
        // 检查是否为 Grok 资源域名或相对路径
        const isGrokAsset = url.includes('assets.grok.com') || 
                           url.includes('imagine-public.x.ai') || 
                           url.includes('grok.com') ||
                           (!url.startsWith('http') && !url.startsWith('data:'));
        
        if (!isGrokAsset) return url;

        // 构造完整的原始 URL
        let originalUrl = url;
        if (!url.startsWith('http')) {
            originalUrl = `https://assets.grok.com${url.startsWith('/') ? '' : '/'}${url}`;
        }

        // 返回本地代理接口 URL
        // 使用 uuid 以提高安全性，防止 token 泄露在链接中
        const authParam = `uuid=${encodeURIComponent(uuid)}`;

        const proxyPath = `/api/grok/assets?url=${encodeURIComponent(originalUrl)}&${authParam}`;
        if (requestBaseUrl) {
            return `${requestBaseUrl}${proxyPath}`;
        }
        return proxyPath;
    }

    /**
     * 在文本中查找并替换所有 Grok 资源链接为绝对代理链接
     */
    _processGrokAssetsInText(text, state = null) {
        const uuid = state?.uuid || GrokConverter.sharedUuid;
        if (!text || !uuid) return text;
        
        // 匹配 assets.grok.com, imagine-public.x.ai 或 grok.com 的 URL
        const grokUrlRegex = /https?:\/\/(assets\.grok\.com|imagine-public\.x\.ai|grok\.com)\/[^\s\)\"\'\>]+/g;
        
        return text.replace(grokUrlRegex, (url) => {
            return this._appendSsoToken(url, state);
        });
    }

    /**
     * 获取或初始化请求状态
     */
    _getState(requestId) {
        if (!this.requestStates.has(requestId)) {
            this.requestStates.set(requestId, {
                think_opened: false,
                image_think_active: false,
                video_think_active: false,
                role_sent: false,
                tool_buffer: "",
                last_is_thinking: false,
                fingerprint: "",
                content_buffer: "", // 用于缓存内容以解析工具调用
                has_tool_call: false,
                rollout_id: "",
                in_tool_call: false, // 是否处于 <tool_call> 块内
                content_started: false, // 是否已经开始输出正式内容
                requestBaseUrl: "",
                uuid: null,
                seen_images: new Set(), // 用于去重已输出的图片
                pending_text_buffer: "", // 用于处理流式输出中被截断的 URL
                usageAcc: null, // 流式过程中最后一次解析到的上游用量（末包常为合成 isDone 无用量）
                usageEstimatePayload: null, // grok-core 注入的 prompt/tools 文本，用于本地估算
                streamIncludeUsage: false // OpenAI stream_options.include_usage 兼容
            });
        }
        return this.requestStates.get(requestId);
    }

    _nTok(v) {
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    }

    _packOpenAIUsage(prompt, completion, total) {
        const pt = this._nTok(prompt);
        const ct = this._nTok(completion);
        let tt = this._nTok(total);
        if (!tt && (pt || ct)) tt = pt + ct;
        if (!pt && !ct && !tt) return null;
        return { prompt_tokens: pt, completion_tokens: ct, total_tokens: tt || pt + ct };
    }

    _usageFromUsageLike(u) {
        if (!u || typeof u !== "object") return null;
        return this._packOpenAIUsage(
            u.prompt_tokens ?? u.input_tokens ?? u.promptTokens ?? u.inputTokens
                ?? u.prompt_token_count ?? u.input_token_count,
            u.completion_tokens ?? u.output_tokens ?? u.completionTokens ?? u.outputTokens
                ?? u.completion_token_count ?? u.output_token_count,
            u.total_tokens ?? u.totalTokens ?? u.total_token_count
        );
    }

    _usageFromLlmInfoLike(li) {
        if (!li || typeof li !== "object") return null;
        return this._packOpenAIUsage(
            li.inputTokens ?? li.promptTokens ?? li.prompt_tokens ?? li.input_tokens
                ?? li.prompt_token_count ?? li.input_token_count,
            li.outputTokens ?? li.completionTokens ?? li.completion_tokens ?? li.output_tokens
                ?? li.completion_token_count ?? li.output_token_count,
            li.totalTokens ?? li.total_tokens ?? li.total_token_count
        );
    }

    _usageRank(u) {
        return u ? (u.total_tokens || u.prompt_tokens + u.completion_tokens) : 0;
    }

    _usageFromRecord(node) {
        if (!node || typeof node !== "object") return null;
        return this._usageFromUsageLike(node.usage)
            || this._usageFromUsageLike(node.tokenUsage)
            || this._usageFromLlmInfoLike(node.llmInfo)
            || this._usageFromLlmInfoLike(node.llm_info);
    }

    _bestUsageFromNodes(nodes) {
        let best = null;
        for (const node of nodes) {
            const u = this._usageFromRecord(node);
            if (u && this._usageRank(u) >= this._usageRank(best)) best = u;
        }
        return best;
    }

    _preferHigherUsage(a, b) {
        if (this._usageRank(b) > this._usageRank(a)) return b || a;
        return a || b;
    }

    /**
     * 上游无有效 usage 时，用 Claude tokenizer 估算（与 Grok/xAI 官方计费可能不一致，仅作展示/配额参考）
     */
    _fillUsageWithEstimateIfNeeded(upstream, payload, completionText) {
        if (process.env.GROK_DISABLE_USAGE_ESTIMATE === '1' || /^true$/i.test(process.env.GROK_DISABLE_USAGE_ESTIMATE || '')) {
            return upstream && typeof upstream === 'object'
                ? upstream
                : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        }
        const u = upstream && typeof upstream === 'object'
            ? upstream
            : { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
        if (this._usageRank(u) > 0) {
            return {
                prompt_tokens: u.prompt_tokens,
                completion_tokens: u.completion_tokens,
                total_tokens: u.total_tokens || u.prompt_tokens + u.completion_tokens,
            };
        }
        const promptStr = `${payload?.promptText ?? ''}${payload?.toolsJson ?? ''}`;
        const pt = countTextTokens(promptStr);
        const ct = countTextTokens(completionText || '');
        return {
            prompt_tokens: pt,
            completion_tokens: ct,
            total_tokens: pt + ct,
        };
    }

    /**
     * 在整块 JSON 内深度查找类 usage 对象（Grok 上游字段位置不固定时兜底）
     */
    _deepFindUsage(obj, depth = 0, maxDepth = 6) {
        if (!obj || typeof obj !== "object" || depth > maxDepth) return null;
        if (Array.isArray(obj)) {
            let best = null;
            const lim = Math.min(obj.length, 80);
            for (let i = 0; i < lim; i++) {
                const u = this._deepFindUsage(obj[i], depth + 1, maxDepth);
                best = this._preferHigherUsage(best, u);
            }
            return best;
        }
        const direct = this._usageFromUsageLike(obj) || this._usageFromLlmInfoLike(obj);
        if (direct) return direct;
        let best = null;
        const keys = Object.keys(obj);
        const lim = Math.min(keys.length, 80);
        for (let i = 0; i < lim; i++) {
            const v = obj[keys[i]];
            if (v == null || typeof v !== "object") continue;
            const u = this._deepFindUsage(v, depth + 1, maxDepth);
            best = this._preferHigherUsage(best, u);
        }
        return best;
    }

    /**
     * 从 Grok app-chat 流式块解析用量（兼容 result 层、response、modelResponse.metadata.llm_info 等）
     */
    _extractGrokUsageFromChunk(grokChunk, resp) {
        const nodes = [];
        if (grokChunk?.result) nodes.push(grokChunk.result);
        if (resp) nodes.push(resp);
        if (resp?.modelResponse) {
            nodes.push(resp.modelResponse);
            const md = resp.modelResponse.metadata;
            if (md) {
                nodes.push(md);
                if (md.llm_info) nodes.push(md.llm_info);
            }
        }
        const shallow = this._bestUsageFromNodes(nodes);
        const deep = this._deepFindUsage(grokChunk, 0, 6);
        return this._preferHigherUsage(shallow, deep);
    }

    /**
     * 从非流式聚合结果解析用量
     */
    _extractGrokUsageFromCollected(grokResponse) {
        const nodes = [grokResponse, grokResponse?.modelResponse];
        if (grokResponse?.usage) nodes.push({ usage: grokResponse.usage });
        const md = grokResponse?.modelResponse?.metadata;
        if (md) {
            nodes.push(md);
            if (md.llm_info) nodes.push(md.llm_info);
        }
        if (grokResponse?.llmInfo) nodes.push(grokResponse.llmInfo);
        const shallow = this._bestUsageFromNodes(nodes);
        const deep = this._deepFindUsage(grokResponse, 0, 6);
        return this._preferHigherUsage(shallow, deep);
    }

    /**
     * 部署后验证用量：环境变量 GROK_LOG_USAGE=1（或 true）时，每次完成响应打一行 info，默认关闭。
     */
    _maybeLogGrokUsage(kind, model, responseId, usage) {
        const flag = process.env.GROK_LOG_USAGE;
        if (flag !== '1' && !/^true$/i.test(String(flag || ''))) return;
        if (!usage) return;
        logger.info(
            `[Grok usage] ${kind} model=${model ?? '?'} id=${responseId ?? '?'} ` +
            `in=${usage.prompt_tokens} out=${usage.completion_tokens} total=${usage.total_tokens}`
        );
    }

    /**
     * 构建工具系统提示词 (build_tool_prompt)
     */
    buildToolPrompt(tools, toolChoice = "auto", parallelToolCalls = true) {
        if (!tools || tools.length === 0 || toolChoice === "none") {
            return "";
        }

        const lines = [
            "# Available Tools",
            "",
            "You have access to the following tools. To call a tool, output a <tool_call> block with a JSON object containing \"name\" and \"arguments\".",
            "",
            "Format:",
            "<tool_call>",
            '{"name": "function_name", "arguments": {"param": "value"}}',
            "</tool_call>",
            "",
        ];

        if (parallelToolCalls) {
            lines.push("You may make multiple tool calls in a single response by using multiple <tool_call> blocks.");
            lines.push("");
        }

        lines.push("## Tool Definitions");
        lines.push("");
        for (const tool of tools) {
            if (tool.type !== "function") continue;
            const func = tool.function || {};
            lines.push(`### ${func.name}`);
            if (func.description) lines.push(func.description);
            if (func.parameters) lines.push(`Parameters: ${JSON.stringify(func.parameters)}`);
            lines.push("");
        }

        if (toolChoice === "required") {
            lines.push("IMPORTANT: You MUST call at least one tool in your response. Do not respond with only text.");
        } else if (typeof toolChoice === 'object' && toolChoice.function?.name) {
            lines.push(`IMPORTANT: You MUST call the tool "${toolChoice.function.name}" in your response.`);
        } else {
            lines.push("Decide whether to call a tool based on the user's request. If you don't need a tool, respond normally with text only.");
        }

        lines.push("");
        lines.push("When you call a tool, you may include text before or after the <tool_call> blocks, but the tool call blocks must be valid JSON.");

        return lines.join("\n");
    }

    /**
     * 格式化工具历史 (format_tool_history)
     */
    formatToolHistory(messages) {
        const result = [];
        for (const msg of messages) {
            const role = msg.role;
            const content = msg.content;
            const toolCalls = msg.tool_calls;

            if (role === "assistant" && toolCalls && toolCalls.length > 0) {
                const parts = [];
                if (content) parts.push(typeof content === 'string' ? content : JSON.stringify(content));
                for (const tc of toolCalls) {
                    const func = tc.function || {};
                    parts.push(`<tool_call>{"name":"${func.name}","arguments":${func.arguments || "{}"}}</tool_call>`);
                }
                result.push({ role: "assistant", content: parts.join("\n") });
            } else if (role === "tool") {
                const toolName = msg.name || "unknown";
                const callId = msg.tool_call_id || "";
                const contentStr = typeof content === 'string' ? content : JSON.stringify(content);
                result.push({
                    role: "user",
                    content: `tool (${toolName}, ${callId}): ${contentStr}`
                });
            } else {
                result.push(msg);
            }
        }
        return result;
    }

    /**
     * 解析工具调用 (parse_tool_calls)
     */
    parseToolCalls(content) {
        if (!content) return { text: content, toolCalls: null };

        const toolCallRegex = /<tool_call>\s*(.*?)\s*<\/tool_call>/gs;
        const matches = [...content.matchAll(toolCallRegex)];
        
        if (matches.length === 0) return { text: content, toolCalls: null };

        const toolCalls = [];
        for (const match of matches) {
            try {
                const parsed = JSON.parse(match[1].trim());
                if (parsed.name) {
                    let args = parsed.arguments || {};
                    const argumentsStr = typeof args === 'string' ? args : JSON.stringify(args);
                    
                    toolCalls.push({
                        id: `call_${uuidv4().replace(/-/g, '').slice(0, 24)}`,
                        type: "function",
                        function: {
                            name: parsed.name,
                            arguments: argumentsStr
                        }
                    });
                }
            } catch (e) {
                // 忽略解析失败的块
            }
        }

        if (toolCalls.length === 0) return { text: content, toolCalls: null };

        // 提取文本内容
        let text = content;
        for (const match of matches) {
            text = text.replace(match[0], "");
        }
        text = text.trim() || null;

        return { text, toolCalls };
    }

    /**
     * 转换请求
     */
    convertRequest(data, targetProtocol) {
        switch (targetProtocol) {
            default:
                return data;
        }
    }

    /**
     * 转换响应
     */
    convertResponse(data, targetProtocol, model) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return this.toCodexResponse(data, model);
            case MODEL_PROTOCOL_PREFIX.CLAUDE: {
                const openaiRes = this.toOpenAIResponse(data, model);
                if (!openaiRes) return data;
                const openaiConverter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
                return openaiConverter.toClaudeResponse(openaiRes, model);
            }
            default:
                return data;
        }
    }

    /**
     * 转换流式响应块
     */
    convertStreamChunk(chunk, targetProtocol, model, requestId) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIStreamChunk(chunk, model, requestId);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiStreamChunk(chunk, model, requestId);
            case MODEL_PROTOCOL_PREFIX.OPENAI_RESPONSES:
                return this.toOpenAIResponsesStreamChunk(chunk, model, requestId);
            case MODEL_PROTOCOL_PREFIX.CODEX:
                return this.toCodexStreamChunk(chunk, model, requestId);
            case MODEL_PROTOCOL_PREFIX.CLAUDE:
                return this.toClaudeStreamChunk(chunk, model, requestId);
            default:
                return chunk;
        }
    }

    /**
     * 转换模型列表
     */
    convertModelList(data, targetProtocol) {
        switch (targetProtocol) {
            case MODEL_PROTOCOL_PREFIX.OPENAI:
                return this.toOpenAIModelList(data);
            case MODEL_PROTOCOL_PREFIX.GEMINI:
                return this.toGeminiModelList(data);
            default:
                return data;
        }
    }

    /**
     * 构建工具覆盖配置 (build_tool_overrides)
     */
    buildToolOverrides(tools) {
        if (!tools || !Array.isArray(tools)) {
            return {};
        }

        const toolOverrides = {};
        for (const tool of tools) {
            if (tool.type !== "function") continue;
            const func = tool.function || {};
            const name = func.name;
            if (!name) continue;
            
            toolOverrides[name] = {
                "enabled": true,
                "description": func.description || "",
                "parameters": func.parameters || {}
            };
        }

        return toolOverrides;
    }

    /**
     * 递归收集响应中的图片 URL
     */
    _collectImages(obj) {
        const urls = [];
        const seen = new Set();

        const add = (url) => {
            if (!url || seen.has(url)) return;
            seen.add(url);
            urls.push(url);
        };

        const walk = (value) => {
            if (value && typeof value === 'object') {
                if (Array.isArray(value)) {
                    value.forEach(walk);
                } else {
                    for (const [key, item] of Object.entries(value)) {
                        if (key === "generatedImageUrls" || key === "imageUrls" || key === "imageURLs") {
                            if (Array.isArray(item)) {
                                item.forEach(url => typeof url === 'string' && add(url));
                            } else if (typeof item === 'string') {
                                add(item);
                            }
                            continue;
                        }
                        if (key === "cardAttachmentsJson" && Array.isArray(item)) {
                            item.forEach(jsonStr => {
                                if (typeof jsonStr !== 'string') return;
                                try {
                                    const card = JSON.parse(jsonStr);
                                    const url = card.image?.original || card.image_chunk?.imageUrl;
                                    if (this._isPart0(url)) return;
                                    if (url) add(url);
                                } catch (e) {}
                            });
                            continue;
                        }
                        if (key === "jsonData" && typeof item === "string") {
                            try {
                                const card = JSON.parse(item);
                                const url = card.image?.original || card.image_chunk?.imageUrl;
                                if (url) add(url);
                            } catch (e) {}
                            continue;
                        }
                        walk(item);
                    }
                }
            }
        };

        walk(obj);
        return urls;
    }

    /**
     * 渲染图片为 Markdown
     */
    _renderImage(url, imageId = "image", state = null) {
        let finalUrl = url;
        if (!url.startsWith('http')) {
            finalUrl = `https://assets.grok.com${url.startsWith('/') ? '' : '/'}${url}`;
        }
        finalUrl = this._appendSsoToken(finalUrl, state);
        return `![${imageId}](${finalUrl})`;
    }

    /**
     * 渲染视频为 Markdown/HTML (render_video)
     */
    _renderVideo(videoUrl, thumbnailImageUrl = "", state = null) {
        let finalVideoUrl = videoUrl;
        if (!videoUrl.startsWith('http')) {
            finalVideoUrl = `https://assets.grok.com${videoUrl.startsWith('/') ? '' : '/'}${videoUrl}`;
        }
        
        let finalThumbUrl = thumbnailImageUrl;
        if (thumbnailImageUrl && !thumbnailImageUrl.startsWith('http')) {
            finalThumbUrl = `https://assets.grok.com${thumbnailImageUrl.startsWith('/') ? '' : '/'}${thumbnailImageUrl}`;
        }

        const defaultThumb = 'https://assets.grok.com/favicon.ico';
        return `\n[![video](${finalThumbUrl || defaultThumb})](${finalVideoUrl})\n[Play Video](${finalVideoUrl})\n`;
    }

    /**
     * 提取工具卡片文本 (extract_tool_text)
     */
    _extractToolText(raw, rolloutId = "") {
        if (!raw) return "";
        
        const nameMatch = raw.match(/<xai:tool_name>(.*?)<\/xai:tool_name>/s);
        const argsMatch = raw.match(/<xai:tool_args>(.*?)<\/xai:tool_args>/s);

        let name = nameMatch ? nameMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim() : "";
        let args = argsMatch ? argsMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1").trim() : "";

        let payload = null;
        if (args) {
            try {
                payload = JSON.parse(args);
            } catch (e) {
                payload = null;
            }
        }

        let label = name;
        let text = args;
        const prefix = rolloutId ? `[${rolloutId}]` : "";

        if (name === "web_search") {
            label = `${prefix}[WebSearch]`;
            if (payload && typeof payload === 'object') {
                text = payload.query || payload.q || "";
            }
        } else if (name === "search_images") {
            label = `${prefix}[SearchImage]`;
            if (payload && typeof payload === 'object') {
                text = payload.image_description || payload.description || payload.query || "";
            }
        } else if (name === "chatroom_send") {
            label = `${prefix}[AgentThink]`;
            if (payload && typeof payload === 'object') {
                text = payload.message || "";
            }
        }

        if (label && text) return `${label} ${text}`.trim();
        if (label) return label;
        if (text) return text;
        return raw.replace(/<[^>]+>/g, "").trim();
    }

    /**
     * 过滤特殊标签
     */
    _filterToken(token, requestId = "") {
        if (!token) return token;
        
        let filtered = token;

        // 移除 xai:tool_usage_card 及其内容，不显示工具调用的过程输出
        filtered = filtered.replace(/<xai:tool_usage_card[^>]*>.*?<\/xai:tool_usage_card>/gs, "");
        filtered = filtered.replace(/<xai:tool_usage_card[^>]*\/>/gs, "");
        
        // 移除其他内部标签，包括渲染标签（流式模式下我们通过卡片逻辑单独渲染图片）
        const tagsToFilter = ["rolloutId", "responseId", "isThinking", "grok:render"];
        for (const tag of tagsToFilter) {
            const pattern = new RegExp(`<${tag}[^>]*>.*?<\\/${tag}>|<${tag}[^>]*\\/>`, 'gs');
            filtered = filtered.replace(pattern, "");
        }

        return filtered;
    }

    /**
     * Grok响应 -> OpenAI响应
     */
    toOpenAIResponse(grokResponse, model) {
        if (!grokResponse) return null;

        const responseId = grokResponse.responseId || `chatcmpl-${uuidv4()}`;
        let content = grokResponse.message || "";
        const modelHash = grokResponse.llmInfo?.modelHash || "";
        
        const state = this._getState(this._formatResponseId(responseId));
        if (grokResponse._requestBaseUrl) {
            state.requestBaseUrl = grokResponse._requestBaseUrl;
        }
        if (grokResponse._uuid) {
            state.uuid = grokResponse._uuid;
        }

        // 过滤内容并处理其中的 Grok 资源链接
        content = this._filterToken(content, responseId);
        content = this._processGrokAssetsInText(content, state);

        // 处理 cardMap (已由 grok-core 预先提取映射关系)
        const cardMap = new Map();
        if (grokResponse.cardMap && typeof grokResponse.cardMap === 'object') {
            for (const [id, data] of Object.entries(grokResponse.cardMap)) {
                cardMap.set(id, data);
            }
        }
        
        const modelResponse = grokResponse.modelResponse || {};

        // 替换正文中的 <grok:render> 标签为 Markdown 图片
        const renderedCardIds = new Set();
        if (content && cardMap.size > 0) {
            content = content.replace(/<grok:render[^>]*card_id="([^"]+)"[^>]*>.*?<\/grok:render>/gs, (match, cardId) => {
                const item = cardMap.get(cardId);
                if (!item) return "";
                renderedCardIds.add(cardId);
                return this._renderImage(item.original, item.title || "image", state);
            });
        }

        // 收集所有图片并追加（排除已在正文中渲染过的）
        const imageUrls = this._collectImages(grokResponse);
        if (imageUrls.length > 0) {
            const renderedUrls = new Set();
            for (const cardId of renderedCardIds) {
                const item = cardMap.get(cardId);
                if (item) renderedUrls.add(item.original);
            }
            
            let appendContent = "";
            for (const url of imageUrls) {
                if (!renderedUrls.has(url)) {
                    appendContent += this._renderImage(url, "image", state) + "\n";
                    renderedUrls.add(url); // 防止重复追加同一张图
                }
            }
            if (appendContent) content += (content ? "\n" : "") + appendContent;
        }

        // 处理视频 (非流式模式)
        if (grokResponse.finalVideoUrl) {
            content += this._renderVideo(grokResponse.finalVideoUrl, grokResponse.finalThumbnailUrl, state);
        }

        // 解析工具调用
        const contentForTokenCount = content;
        const { text, toolCalls } = this.parseToolCalls(content);

        let usage = this._extractGrokUsageFromCollected(grokResponse) || {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
        };
        usage = this._fillUsageWithEstimateIfNeeded(
            usage,
            grokResponse._grokUsageEstimatePayload,
            contentForTokenCount
        );

        const result = {
            id: responseId,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: model,
            system_fingerprint: modelHash,
            choices: [{
                index: 0,
                message: {
                    role: "assistant",
                    content: text,
                },
                finish_reason: toolCalls ? "tool_calls" : "stop",
            }],
            usage,
        };

        if (toolCalls) {
            result.choices[0].message.tool_calls = toolCalls;
        }

        this._maybeLogGrokUsage('unary', model, result.id, result.usage);
        return result;
    }

    _formatResponseId(id) {
        if (!id) return `chatcmpl-${uuidv4()}`;
        if (id.startsWith('chatcmpl-')) return id;
        return `chatcmpl-${id}`;
    }

    /**
     * Grok流式响应块 -> OpenAI流式响应块
     */
    toOpenAIStreamChunk(grokChunk, model, requestId = null) {
        if (!grokChunk || !grokChunk.result || !grokChunk.result.response) {
            return null;
        }

        const resp = grokChunk.result.response;
        const rawResponseId = resp.responseId || (requestId ? `stream-${requestId}` : "");
        const responseId = this._formatResponseId(rawResponseId);
        const state = this._getState(responseId);
        
        // 从响应块中同步 uuid 和基础 URL
        if (resp._requestBaseUrl) {
            state.requestBaseUrl = resp._requestBaseUrl;
        }
        if (resp._uuid) {
            state.uuid = resp._uuid;
        }

        if (resp.llmInfo?.modelHash && !state.fingerprint) {
            state.fingerprint = resp.llmInfo.modelHash;
        }
        if (resp.rolloutId) {
            state.rollout_id = String(resp.rolloutId);
        }

        const usageHere = this._extractGrokUsageFromChunk(grokChunk, resp);
        if (usageHere && this._usageRank(usageHere) >= this._usageRank(state.usageAcc)) {
            state.usageAcc = usageHere;
        }
        const est = grokChunk.result?._grokUsageEstimatePayload;
        if (est && !state.usageEstimatePayload) {
            state.usageEstimatePayload = est;
        }
        if (est?.includeUsage === true) {
            state.streamIncludeUsage = true;
        }

        const chunks = [];

        // 0. 发送角色信息（仅第一次）
        if (!state.role_sent) {
            chunks.push({
                id: responseId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                system_fingerprint: state.fingerprint,
                choices: [{
                    index: 0,
                    delta: { role: "assistant", content: "" },
                    finish_reason: null
                }]
            });
            state.role_sent = true;
        }

        // 处理结束标志
        if (resp.isDone) {
            let finalContent = "";
            
            // 如果思考块未关闭，在此关闭
            if (state.think_opened) {
                finalContent += "\n</think>\n";
                state.think_opened = false;
            }

            // 处理剩余的缓冲区
            if (state.pending_text_buffer) {
                finalContent += this._processGrokAssetsInText(state.pending_text_buffer, state);
                state.pending_text_buffer = "";
            }

            // 处理 buffer 中的工具调用
            const { text, toolCalls } = this.parseToolCalls(state.content_buffer);
            
            let terminalUsage = state.usageAcc || usageHere || {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
            };
            terminalUsage = this._fillUsageWithEstimateIfNeeded(
                terminalUsage,
                state.usageEstimatePayload,
                state.content_buffer || ''
            );
            this._maybeLogGrokUsage('stream', model, responseId, terminalUsage);
            if (toolCalls) {
                chunks.push({
                    id: responseId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    system_fingerprint: state.fingerprint,
                    usage: terminalUsage,
                    choices: [{
                        index: 0,
                        delta: { 
                            content: (finalContent + (text || "")).trim() || null,
                            tool_calls: toolCalls 
                        },
                        finish_reason: "tool_calls"
                    }]
                });
            } else {
                chunks.push({
                    id: responseId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    system_fingerprint: state.fingerprint,
                    usage: terminalUsage,
                    choices: [{
                        index: 0,
                        delta: { content: finalContent || null },
                        finish_reason: "stop"
                    }]
                });
            }

            if (state.streamIncludeUsage) {
                chunks.push({
                    id: responseId,
                    object: "chat.completion.chunk",
                    created: Math.floor(Date.now() / 1000),
                    model: model,
                    system_fingerprint: state.fingerprint,
                    choices: [],
                    usage: terminalUsage
                });
            }

            // 清理状态
            this.requestStates.delete(responseId);
            return chunks;
        }

        let deltaContent = "";
        let deltaReasoning = "";

        // 1. 处理图片生成进度
        if (resp.streamingImageGenerationResponse) {
            const img = resp.streamingImageGenerationResponse;
            state.image_think_active = true;
            /* 
            if (!state.think_opened) {
                deltaReasoning += "<think>\n";
                state.think_opened = true;
            }
            */
            const idx = (img.imageIndex || 0) + 1;
            const progress = img.progress || 0;
            deltaReasoning += `正在生成第${idx}张图片中，当前进度${progress}%\n`;
        }

        // 2. 处理视频生成进度 (VideoStreamProcessor)
        if (resp.streamingVideoGenerationResponse) {
            const vid = resp.streamingVideoGenerationResponse;
            state.video_think_active = true;
            /*
            if (!state.think_opened) {
                deltaReasoning += "<think>\n";
                state.think_opened = true;
            }
            */
            const progress = vid.progress || 0;
            deltaReasoning += `正在生成视频中，当前进度${progress}%\n`;

            if (progress === 100 && vid.videoUrl) {
                /*
                if (state.think_opened) {
                    deltaContent += "\n</think>\n";
                    state.think_opened = false;
                }
                */
                state.video_think_active = false;
                deltaContent += this._renderVideo(vid.videoUrl, vid.thumbnailImageUrl, state);
            }
        }

        // 3. 处理模型响应（通常包含完整消息或图片）
        if (resp.modelResponse) {
            const mr = resp.modelResponse;
            state.image_think_active = false;
            state.video_think_active = false;

            const imageUrls = this._collectImages(mr);
            for (const url of imageUrls) {
                // 检查是否已经在流中输出过
                if (!state.seen_images.has(url)) {
                    deltaContent += this._renderImage(url, "image", state) + "\n";
                    state.seen_images.add(url);
                }
            }

            if (mr.metadata?.llm_info?.modelHash) {
                state.fingerprint = mr.metadata.llm_info.modelHash;
            }
        }

        // 5. 处理普通 Token 和 思考状态
        if (resp.token !== undefined && resp.token !== null) {
            const token = resp.token;
            const filtered = this._filterToken(token, responseId);
            const isThinking = !!resp.isThinking;
            const hasStepId = !!resp.messageStepId;
            const inThink = isThinking || hasStepId || state.image_think_active || state.video_think_active;

            // 正式内容已开始后，丢弃中途插入的 Agent 思考（1-2 句内部注释，无用户价值）
            if (state.content_started && inThink && !state.image_think_active && !state.video_think_active) {
                // 跳过不展示
            } else if (inThink) {
                if (!state.think_opened) {
                    deltaContent += "<think>\n";
                    state.think_opened = true;
                }
                deltaReasoning += filtered;
                deltaContent += filtered;
            } else {
                if (state.think_opened) {
                    deltaContent += "\n</think>\n";
                    state.think_opened = false;
                    state.content_started = true;
                }
                
                // 将新 token 加入待处理缓冲区，解决 URL 被截断的问题
                state.pending_text_buffer += filtered;
                
                let outputFromBuffer = "";
                
                // 启发式逻辑：检查缓冲区是否包含完整的 URL
                if (state.pending_text_buffer.includes("https://assets.grok.com")) {
                    const lastUrlIndex = state.pending_text_buffer.lastIndexOf("https://assets.grok.com");
                    const textAfterUrl = state.pending_text_buffer.slice(lastUrlIndex);
                    
                    // 检查 URL 是否结束（空格、右括号、引号、换行、大于号等）
                    const terminatorMatch = textAfterUrl.match(/[\s\)\"\'\>\n]/);
                    if (terminatorMatch) {
                        // URL 已结束，可以安全地处理并输出缓冲区
                        outputFromBuffer = this._processGrokAssetsInText(state.pending_text_buffer, state);
                        state.pending_text_buffer = "";
                    } else if (state.pending_text_buffer.length > 1000) {
                        // 缓冲区过长，强制处理输出，避免过度延迟
                        outputFromBuffer = this._processGrokAssetsInText(state.pending_text_buffer, state);
                        state.pending_text_buffer = "";
                    }
                } else {
                    // 不包含 Grok URL，直接输出
                    outputFromBuffer = state.pending_text_buffer;
                    state.pending_text_buffer = "";
                }

                if (outputFromBuffer) {
                    // 工具调用抑制逻辑：不向客户端输出 <tool_call> 块及其内容
                    let outputToken = outputFromBuffer;
                    
                    // 简单的状态切换检测
                    if (outputToken.includes('<tool_call>')) {
                        state.in_tool_call = true;
                        state.has_tool_call = true;
                        // 移除标签之后的部分（如果有）
                        outputToken = outputToken.split('<tool_call>')[0];
                    } else if (state.in_tool_call && outputToken.includes('</tool_call>')) {
                        state.in_tool_call = false;
                        // 只保留标签之后的部分
                        outputToken = outputToken.split('</tool_call>')[1] || "";
                    } else if (state.in_tool_call) {
                        // 处于块内，完全抑制
                        outputToken = "";
                    }

                    deltaContent += outputToken;
                }
                
                // 将内容加入 buffer 用于最终解析工具调用
                state.content_buffer += filtered;
            }
            state.last_is_thinking = isThinking;
        }

        if (deltaContent || deltaReasoning) {
            const delta = {};
            if (deltaContent) delta.content = deltaContent;
            if (deltaReasoning) delta.reasoning_content = deltaReasoning;

            chunks.push({
                id: responseId,
                object: "chat.completion.chunk",
                created: Math.floor(Date.now() / 1000),
                model: model,
                system_fingerprint: state.fingerprint,
                choices: [{
                    index: 0,
                    delta: delta,
                    finish_reason: null
                }]
            });
        }

        return chunks.length > 0 ? chunks : null;
    }

    /**
     * Grok响应 -> Gemini响应
     */
    toGeminiResponse(grokResponse, model) {
        const openaiRes = this.toOpenAIResponse(grokResponse, model);
        if (!openaiRes) return null;

        const choice = openaiRes.choices[0];
        const message = choice.message;
        const parts = [];

        if (message.reasoning_content) {
            parts.push({ text: message.reasoning_content, thought: true });
        }

        if (message.content) {
            parts.push({ text: message.content });
        }

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                parts.push({
                    functionCall: {
                        name: tc.function.name,
                        args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
                    }
                });
            }
        }

        return {
            candidates: [{
                content: {
                    role: 'model',
                    parts: parts
                },
                finishReason: choice.finish_reason === 'tool_calls' ? 'STOP' : (choice.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP')
            }],
            usageMetadata: {
                promptTokenCount: openaiRes.usage.prompt_tokens,
                candidatesTokenCount: openaiRes.usage.completion_tokens,
                totalTokenCount: openaiRes.usage.total_tokens
            }
        };
    }

    /**
     * Grok流式响应块 -> Gemini流式响应块
     */
    toGeminiStreamChunk(grokChunk, model, requestId = null) {
        const openaiChunks = this.toOpenAIStreamChunk(grokChunk, model, requestId);
        if (!openaiChunks) return null;

        const geminiChunks = [];
        for (const oachunk of openaiChunks) {
            const choice = oachunk.choices[0];
            const delta = choice.delta;
            const parts = [];

            if (delta.reasoning_content) {
                parts.push({ text: delta.reasoning_content, thought: true });
            }
            if (delta.content) {
                parts.push({ text: delta.content });
            }
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    parts.push({
                        functionCall: {
                            name: tc.function.name,
                            args: typeof tc.function.arguments === 'string' ? JSON.parse(tc.function.arguments) : tc.function.arguments
                        }
                    });
                }
            }

            if (parts.length > 0 || choice.finish_reason) {
                const gchunk = {
                    candidates: [{
                        content: {
                            role: 'model',
                            parts: parts
                        }
                    }]
                };
                if (choice.finish_reason) {
                    gchunk.candidates[0].finishReason = choice.finish_reason === 'length' ? 'MAX_TOKENS' : 'STOP';
                    if (oachunk.usage) {
                        gchunk.usageMetadata = {
                            promptTokenCount: oachunk.usage.prompt_tokens || 0,
                            candidatesTokenCount: oachunk.usage.completion_tokens || 0,
                            totalTokenCount: oachunk.usage.total_tokens || 0
                        };
                    }
                }
                geminiChunks.push(gchunk);
            }
        }

        return geminiChunks.length > 0 ? geminiChunks : null;
    }

    /**
     * Grok响应 -> OpenAI Responses响应
     */
    toOpenAIResponsesResponse(grokResponse, model) {
        const openaiRes = this.toOpenAIResponse(grokResponse, model);
        if (!openaiRes) return null;

        const choice = openaiRes.choices[0];
        const message = choice.message;
        const output = [];

        const content = [];
        if (message.content) {
            content.push({
                type: "output_text",
                text: message.content
            });
        }

        output.push({
            id: `msg_${uuidv4().replace(/-/g, '')}`,
            type: "message",
            role: "assistant",
            status: "completed",
            content: content
        });

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                output.push({
                    id: tc.id,
                    type: "function_call",
                    name: tc.function.name,
                    arguments: tc.function.arguments,
                    status: "completed"
                });
            }
        }

        return {
            id: `resp_${uuidv4().replace(/-/g, '')}`,
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            status: "completed",
            model: model,
            output: output,
            usage: {
                input_tokens: openaiRes.usage.prompt_tokens,
                output_tokens: openaiRes.usage.completion_tokens,
                total_tokens: openaiRes.usage.total_tokens
            }
        };
    }

    /**
     * Grok流式响应块 -> OpenAI Responses流式响应块
     */
    toOpenAIResponsesStreamChunk(grokChunk, model, requestId = null) {
        const openaiChunks = this.toOpenAIStreamChunk(grokChunk, model, requestId);
        if (!openaiChunks) return null;

        const events = [];
        for (const oachunk of openaiChunks) {
            const choice = oachunk.choices[0];
            const delta = choice.delta;

            if (delta.role === 'assistant') {
                events.push({ type: "response.created", response: { id: oachunk.id, model: model } });
            }

            if (delta.reasoning_content) {
                events.push({
                    type: "response.reasoning_summary_text.delta",
                    delta: delta.reasoning_content,
                    response_id: oachunk.id
                });
            }

            if (delta.content) {
                events.push({
                    type: "response.output_text.delta",
                    delta: delta.content,
                    response_id: oachunk.id
                });
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.function?.name) {
                        events.push({
                            type: "response.output_item.added",
                            item: { id: tc.id, type: "function_call", name: tc.function.name, arguments: "" },
                            response_id: oachunk.id
                        });
                    }
                    if (tc.function?.arguments) {
                        events.push({
                            type: "response.custom_tool_call_input.delta",
                            delta: tc.function.arguments,
                            item_id: tc.id,
                            response_id: oachunk.id
                        });
                    }
                }
            }

            if (choice.finish_reason) {
                const completed = { type: "response.completed", response: { id: oachunk.id, status: "completed" } };
                if (oachunk.usage) {
                    completed.response.usage = {
                        input_tokens: oachunk.usage.prompt_tokens || 0,
                        output_tokens: oachunk.usage.completion_tokens || 0,
                        total_tokens: oachunk.usage.total_tokens || 0
                    };
                }
                events.push(completed);
            }
        }

        return events;
    }

    /**
     * Grok响应 -> Codex响应
     */
    toCodexResponse(grokResponse, model) {
        const openaiRes = this.toOpenAIResponse(grokResponse, model);
        if (!openaiRes) return null;

        const choice = openaiRes.choices[0];
        const message = choice.message;
        const output = [];

        if (message.content) {
            output.push({
                type: "message",
                role: "assistant",
                content: [{ type: "output_text", text: message.content }]
            });
        }

        if (message.reasoning_content) {
            output.push({
                type: "reasoning",
                summary: [{ type: "summary_text", text: message.reasoning_content }]
            });
        }

        if (message.tool_calls) {
            for (const tc of message.tool_calls) {
                output.push({
                    type: "function_call",
                    call_id: tc.id,
                    name: tc.function.name,
                    arguments: tc.function.arguments
                });
            }
        }

        return {
            response: {
                id: openaiRes.id,
                output: output,
                usage: {
                    input_tokens: openaiRes.usage.prompt_tokens,
                    output_tokens: openaiRes.usage.completion_tokens,
                    total_tokens: openaiRes.usage.total_tokens
                }
            }
        };
    }

    /**
     * Grok流式响应块 -> Codex流式响应块
     */
    toCodexStreamChunk(grokChunk, model, requestId = null) {
        const openaiChunks = this.toOpenAIStreamChunk(grokChunk, model, requestId);
        if (!openaiChunks) return null;

        const codexChunks = [];
        for (const oachunk of openaiChunks) {
            const choice = oachunk.choices[0];
            const delta = choice.delta;

            if (delta.role === 'assistant') {
                codexChunks.push({ type: "response.created", response: { id: oachunk.id } });
            }

            if (delta.reasoning_content) {
                codexChunks.push({
                    type: "response.reasoning_summary_text.delta",
                    delta: delta.reasoning_content,
                    response: { id: oachunk.id }
                });
            }

            if (delta.content) {
                codexChunks.push({
                    type: "response.output_text.delta",
                    delta: delta.content,
                    response: { id: oachunk.id }
                });
            }

            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    if (tc.function?.arguments) {
                        codexChunks.push({
                            type: "response.custom_tool_call_input.delta",
                            delta: tc.function.arguments,
                            item_id: tc.id,
                            response: { id: oachunk.id }
                        });
                    }
                }
            }

            if (choice.finish_reason) {
                codexChunks.push({ type: "response.completed", response: { id: oachunk.id, usage: oachunk.usage } });
            }
        }

        return codexChunks.length > 0 ? codexChunks : null;
    }

    toClaudeStreamChunk(chunk, model, requestId) {
        const openaiPieces = this.toOpenAIStreamChunk(chunk, model, requestId);
        if (!openaiPieces) return null;

        const key = requestId || '_';
        const openaiConverter = ConverterFactory.getConverter(MODEL_PROTOCOL_PREFIX.OPENAI);
        const pieces = Array.isArray(openaiPieces) ? openaiPieces : [openaiPieces];
        const out = [];

        for (const p of pieces) {
            const events = openaiConverter.toClaudeStreamChunk(p, model);
            if (!events) continue;

            const arr = Array.isArray(events) ? events : [events];
            for (const ev of arr) {
                if (!this._claudeMsgStartSent.get(key)) {
                    this._claudeMsgStartSent.set(key, true);
                    const msgId = `msg_${String(p.id || uuidv4()).replace(/^chatcmpl-/, '')}`;
                    out.push({
                        type: 'message_start',
                        message: {
                            id: msgId,
                            type: 'message',
                            role: 'assistant',
                            content: [],
                            model: model || p.model || 'unknown',
                            stop_reason: null,
                            stop_sequence: null,
                            usage: {
                                input_tokens: 0,
                                output_tokens: 0,
                                cache_creation_input_tokens: 0,
                                cache_read_input_tokens: 0
                            }
                        }
                    });
                }
                out.push(ev);
            }
        }

        if (chunk?.result?.response?.isDone) {
            this._claudeMsgStartSent.delete(key);
        }

        return out.length === 0 ? null : (out.length === 1 ? out[0] : out);
    }

    /**
     * Grok模型列表 -> OpenAI模型列表
     */
    toOpenAIModelList(grokModels) {
        const models = Array.isArray(grokModels) ? grokModels : (grokModels?.models || grokModels?.data || []);
        return {
            object: "list",
            data: models.map(m => ({
                id: m.id || m.name || (typeof m === 'string' ? m : ''),
                object: "model",
                created: Math.floor(Date.now() / 1000),
                owned_by: "xai",
                display_name: m.display_name || m.name || m.id || (typeof m === 'string' ? m : ''),
            })),
        };
    }

    /**
     * Grok模型列表 -> Gemini模型列表
     */
    toGeminiModelList(grokModels) {
        const models = Array.isArray(grokModels) ? grokModels : (grokModels?.models || grokModels?.data || []);
        return {
            models: models.map(m => ({
                name: `models/${m.id || m.name || (typeof m === 'string' ? m : '')}`,
                version: "1.0",
                displayName: m.display_name || m.name || m.id || (typeof m === 'string' ? m : ''),
                description: m.description || `Grok model: ${m.name || m.id || (typeof m === 'string' ? m : '')}`,
                inputTokenLimit: 131072,
                outputTokenLimit: 8192,
                supportedGenerationMethods: ["generateContent", "streamGenerateContent"]
            }))
        };
    }
}
