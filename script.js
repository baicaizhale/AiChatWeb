const PROMPT_PRESETS = {
    default: {
        name: "默认助手",
        content: "你是一个乐于助人的AI助手。"
    },
    math: {
        name: "数学专家",
        content: "你是一名数学专家，专注于解决数学问题。请使用严谨的数学语言和步骤解答问题，确保公式使用$...$或$$...$$正确渲染。"
    },
    code: {
        name: "编程专家",
        content: "你是一名编程专家，精通多种编程语言。请用清晰简洁的代码和解释回答编程问题，代码部分请用Markdown代码块包裹。"
    },
    creative: {
        name: "创意写作",
        content: "你是一位创意作家，擅长创作故事、诗歌和散文。请用富有想象力和文学性的语言回复，注重情感表达和修辞手法。"
    },
    custom: {
        name: "自定义",
        content: ""
    }
};

const CONFIG = {
    maxLength: 8000,
    maxHistory: 4,
    maxContext: 4096,
    timeout: 30000,
    temperature: 0.7,
    maxTokens: 1000
};

// DOM元素
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');
const configPanel = document.getElementById('configPanel');
const configToggle = document.getElementById('configToggle');
const apiKeyInput = document.getElementById('apiKey');
const modelInput = document.getElementById('model');
const presetPromptSelect = document.getElementById('presetPrompt');
const customPromptGroup = document.getElementById('customPromptGroup');
const customPromptInput = document.getElementById('customPrompt');
const saveConfigBtn = document.getElementById('saveConfig');
const closeConfigBtn = document.getElementById('closeConfig');
const errorDiv = document.getElementById('errorDiv');
const presetSelection = document.getElementById('presetSelection');

let chatHistory = [];
let userConfig = {
    apiKey: '',
    model: 'deepseek-ai/DeepSeek-V3',
    presetPrompt: 'default',
    customPrompt: ''
};
let isStreaming = false;
let currentBotMessage = null;
let currentReasoning = '';
let currentFinalContent = '';
let thinkingContainer = null;

document.addEventListener('DOMContentLoaded', () => {
    loadConfig();
    messageInput.focus();
    renderPresetButtons();
    marked.setOptions({
        breaks: true,
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(code, { language: lang }).value;
                } catch (e) {
                    return code;
                }
            }
            return hljs.highlightAuto(code).value;
        }
    });
    window.renderMath = function(element = document.body) {
        try {
            renderMathInElement(element, {
                delimiters: [
                    {left: "$$", right: "$$", display: true},
                    {left: "$", right: "$", display: false}
                ],
                throwOnError: false,
                output: 'html'
            });
        } catch (error) {
            const errorElement = document.createElement('div');
            errorElement.className = 'formula-error';
            errorElement.textContent = `公式渲染错误: ${error.message}`;
            element.appendChild(errorElement);
        }
    };
    window.renderMath();
    chatMessages.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('toggle-thinking')) {
            const header = e.target.closest('.thinking-header');
            if (header) {
                const content = header.nextElementSibling;
                if (content.classList.contains('collapsed')) {
                    content.classList.remove('collapsed');
                    e.target.textContent = '▼';
                } else {
                    content.classList.add('collapsed');
                    e.target.textContent = '►';
                }
            }
        }
    });
    presetPromptSelect.addEventListener('change', function() {
        customPromptGroup.style.display = this.value === 'custom' ? 'block' : 'none';
    });
});

function renderPresetButtons() {
    presetSelection.innerHTML = '';
    Object.keys(PROMPT_PRESETS).forEach(key => {
        if (key !== 'custom') {
            const preset = PROMPT_PRESETS[key];
            const btn = document.createElement('button');
            btn.className = 'preset-btn';
            btn.textContent = preset.name;
            btn.dataset.preset = key;
            if (userConfig.presetPrompt === key) btn.classList.add('active');
            btn.addEventListener('click', function() {
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                this.classList.add('active');
                userConfig.presetPrompt = key;
                if (key !== 'custom') userConfig.customPrompt = '';
                saveConfigToStorage();
                showError(`已切换为: ${preset.name}`, 'success');
            });
            presetSelection.appendChild(btn);
        }
    });
}
function loadConfig() {
    const savedConfig = localStorage.getItem('aiConfig');
    if (savedConfig) {
        userConfig = JSON.parse(savedConfig);
        apiKeyInput.value = userConfig.apiKey || '';
        modelInput.value = userConfig.model || 'deepseek-ai/DeepSeek-V3';
        presetPromptSelect.value = userConfig.presetPrompt || 'default';
        customPromptInput.value = userConfig.customPrompt || '';
        if (userConfig.presetPrompt === 'custom') customPromptGroup.style.display = 'block';
    }
    saveConfigToStorage();
}
function saveConfigToStorage() {
    localStorage.setItem('aiConfig', JSON.stringify(userConfig));
}
function saveConfig() {
    userConfig = {
        apiKey: apiKeyInput.value,
        model: modelInput.value,
        presetPrompt: presetPromptSelect.value,
        customPrompt: presetPromptSelect.value === 'custom' ? customPromptInput.value : ''
    };
    saveConfigToStorage();
    configPanel.style.display = 'none';
    renderPresetButtons();
    showError('配置已保存', 'success');
}
function showError(message, type = 'error') {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    errorDiv.style.background = type === 'error' ? '#ff6b6b' : '#2ecc71';
    setTimeout(() => { errorDiv.style.display = 'none'; }, 3000);
}
messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});
sendButton.addEventListener('click', sendMessage);
configToggle.addEventListener('click', () => configPanel.style.display = 'flex');
closeConfigBtn.addEventListener('click', () => configPanel.style.display = 'none');
saveConfigBtn.addEventListener('click', saveConfig);
function addMessage(content, role) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}-message`;
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    if (role === 'assistant') {
        contentDiv.innerHTML = marked.parse(content);
    } else {
        contentDiv.textContent = content;
    }
    messageDiv.appendChild(contentDiv);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    window.renderMath(contentDiv);
    contentDiv.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });
    return messageDiv;
}
function showThinking() {
    const thinkingDiv = document.createElement('div');
    thinkingDiv.className = 'assistant-thinking';
    thinkingDiv.id = 'thinkingIndicator';
    thinkingDiv.innerHTML = `
        <div class="typing-indicator">
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
            <div class="typing-dot"></div>
        </div>
        <span>思考中...</span>
    `;
    chatMessages.appendChild(thinkingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}
function hideThinking() {
    const thinking = document.getElementById('thinkingIndicator');
    if (thinking) thinking.remove();
}
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // 禁用输入框和按钮
    messageInput.disabled = true;
    sendButton.disabled = true;

    // 添加用户消息到界面
    addMessage(message, 'user');
    chatHistory.push({ role: 'user', content: message });
    messageInput.value = '';

    // 显示思考中
    showThinking();

    try {
        // 调用后端API
        const response = await fetch('manager.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: message,
                history: chatHistory
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP错误: ${response.status}`);
        }

        const result = await response.json();

        if (result.status !== 'success') {
            throw new Error(result.message || '未知错误');
        }

        // 显示后端返回的AI消息
        addMessage(result.data.response, 'assistant');
        chatHistory.push({ role: 'assistant', content: result.data.response });

    } catch (error) {
        console.error('请求失败:', error);
        showError(`请求失败: ${error.message}`);

    } finally {
        // 恢复输入框和按钮
        hideThinking();
        messageInput.disabled = false;
        sendButton.disabled = false;
        messageInput.focus();
    }
}
function updateContent(contentDiv, reasoning, content) {
    if (reasoning !== null && reasoning !== '') {
        currentReasoning += reasoning;
        if (!thinkingContainer) {
            thinkingContainer = document.createElement('div');
            thinkingContainer.className = 'thinking-container';
            thinkingContainer.innerHTML = `
                <div class="thinking-header">
                    <button class="toggle-thinking">▼</button>
                    <span>思考过程</span>
                </div>
                <div class="thinking-content">${marked.parse(currentReasoning)}</div>
            `;
            contentDiv.appendChild(thinkingContainer);
            window.renderMath(thinkingContainer);
        } else {
            const thinkingContent = thinkingContainer.querySelector('.thinking-content');
            if (thinkingContent) {
                thinkingContent.innerHTML = marked.parse(currentReasoning);
                window.renderMath(thinkingContent);
            }
        }
    }
    if (content !== null && content !== '') {
        currentFinalContent += content;
        let finalContent = contentDiv.querySelector('.final-content');
        if (!finalContent) {
            finalContent = document.createElement('div');
            finalContent.className = 'final-content';
            contentDiv.appendChild(finalContent);
        }
        finalContent.innerHTML = marked.parse(currentFinalContent);
        finalContent.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
        window.renderMath(finalContent);
    }
}
function buildMessagesChain(currentMessage) {
    let systemPrompt = PROMPT_PRESETS.default.content;
    if (userConfig.presetPrompt === 'custom' && userConfig.customPrompt) {
        systemPrompt = userConfig.customPrompt;
    } else if (PROMPT_PRESETS[userConfig.presetPrompt]) {
        systemPrompt = PROMPT_PRESETS[userConfig.presetPrompt].content;
    }
    const messagesChain = [
        { role: "system", content: systemPrompt }
    ];
    chatHistory.slice(-CONFIG.maxHistory * 2).forEach(record => {
        if (record.role && record.content) {
            messagesChain.push({
                role: record.role,
                content: record.content.substring(0, CONFIG.maxLength)
            });
        }
    });
    messagesChain.push({
        role: "user",
        content: currentMessage.substring(0, CONFIG.maxLength)
    });
    return messagesChain;
}
async function callStreamingAPI(messages, onChunk) {
    const endpoint = `https://api.siliconflow.cn/v1/chat/completions`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.timeout);
    try {
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${userConfig.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: userConfig.model,
                messages: messages,
                temperature: CONFIG.temperature,
                max_tokens: CONFIG.maxTokens,
                stream: true
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API错误: ${errorText.slice(0, 100)}`);
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary;
            while ((boundary = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, boundary).trim();
                buffer = buffer.slice(boundary + 1);
                if (line.startsWith('data: ') && !line.includes('[DONE]')) {
                    try {
                        const json = line.replace('data: ', '');
                        const data = JSON.parse(json);
                        let reasoningChunk = null;
                        let contentChunk = null;
                        if (data.choices && data.choices[0].delta) {
                            const delta = data.choices[0].delta;
                            if (delta.reasoning_content !== null && delta.reasoning_content !== undefined) {
                                reasoningChunk = delta.reasoning_content;
                            }
                            if (delta.content !== null && delta.content !== undefined) {
                                contentChunk = delta.content;
                            }
                        }
                        onChunk(reasoningChunk, contentChunk);
                    } catch (e) {}
                }
            }
        }
        if (buffer.trim()) {
            try {
                const data = JSON.parse(buffer.trim().replace('data: ', ''));
                let reasoningChunk = null;
                let contentChunk = null;
                if (data.choices && data.choices[0].delta) {
                    const delta = data.choices[0].delta;
                    if (delta.reasoning_content !== null && delta.reasoning_content !== undefined) {
                        reasoningChunk = delta.reasoning_content;
                    }
                    if (delta.content !== null && delta.content !== undefined) {
                        contentChunk = delta.content;
                    }
                }
                onChunk(reasoningChunk, contentChunk);
            } catch (e) {}
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error('请求超时');
        }
        throw error;
    }
}
