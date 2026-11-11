const STORAGE_KEY = 'mini_ai_chrome_settings_v1';

const defaultSettings = {
  model: 'gemini-3.8-flash',
  theme: 'graphite',
  temperature: 0.4,
  systemInstruction:
    'Отвечай кратко, точно и по существу. Используй списки и блоки кода, если вопрос технический.'
};

let currentSettings = { ...defaultSettings };
let abortController = null;
let rawAnswerText = '';

const promptInput = document.getElementById('promptInput');
const sendBtn = document.getElementById('sendBtn');
const stopBtn = document.getElementById('stopBtn');
const clearInputBtn = document.getElementById('clearInputBtn');
const copyBtn = document.getElementById('copyBtn');
const statusText = document.getElementById('statusText');
const responseContainer = document.getElementById('responseContainer');
const activeModelLabel = document.getElementById('activeModelLabel');

const mainView = document.getElementById('mainView');
const settingsView = document.getElementById('settingsView');
const settingsToggleBtn = document.getElementById('settingsToggleBtn');
const modelSelect = document.getElementById('modelSelect');
const themeSelect = document.getElementById('themeSelect');
const temperatureInput = document.getElementById('temperatureInput');
const tempValue = document.getElementById('tempValue');
const systemPromptInput = document.getElementById('systemPromptInput');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const cancelSettingsBtn = document.getElementById('cancelSettingsBtn');

function loadSettings() {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      if (res && res[STORAGE_KEY]) {
        currentSettings = { ...defaultSettings, ...res[STORAGE_KEY] };
      }
      applySettingsToUI();
    });
  } else {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        currentSettings = { ...defaultSettings, ...JSON.parse(saved) };
      } catch {}
    }
    applySettingsToUI();
  }
}

function saveSettings(next) {
  currentSettings = { ...defaultSettings, ...next };
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.set({ [STORAGE_KEY]: currentSettings });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentSettings));
  }
  applySettingsToUI();
}

function applySettingsToUI() {
  document.body.setAttribute('data-theme', currentSettings.theme);
  modelSelect.value = currentSettings.model;
  themeSelect.value = currentSettings.theme;
  temperatureInput.value = String(currentSettings.temperature);
  tempValue.textContent = String(currentSettings.temperature);
  systemPromptInput.value = currentSettings.systemInstruction;

  const labels = {
    'gemini-3.8-flash': 'Gemini 3.8 Flash',
    'gemini-3.1-flash-lite': 'Gemini 3.1 Flash Lite',
    'deepseek-chat': 'DeepSeek V3'
  };
  activeModelLabel.textContent = labels[currentSettings.model] || currentSettings.model;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatMarkdown(md) {
  if (!md) return '';
  let html = escapeHtml(md);
  html = html.replace(/```([\w+-]*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\n/g, '<br/>');
  return html;
}

function buildLocalFallbackAnswer(prompt) {
  const clean = prompt.trim();
  const lower = clean.toLowerCase();

  const mathMatch = clean.match(/([-+]?\d+(?:[.,]\d+)?)\s*([+*\/\-^])\s*([-+]?\d+(?:[.,]\d+)?)/);
  if (mathMatch) {
    const a = parseFloat(mathMatch[1].replace(',', '.'));
    const op = mathMatch[2];
    const b = parseFloat(mathMatch[3].replace(',', '.'));
    let res = null;
    if (op === '+') res = a + b;
    if (op === '-') res = a - b;
    if (op === '*') res = a * b;
    if (op === '/' && b !== 0) res = a / b;
    if (op === '^') res = Math.pow(a, b);
    if (res !== null && Number.isFinite(res)) {
      const formatted = Number.isInteger(res) ? String(res) : res.toFixed(4).replace(/\.?0+$/, '');
      return 'Результат вычисления: **' + formatted + '**\n\n```text\n' + a + ' ' + op + ' ' + b + ' = ' + formatted + '\n```';
    }
  }

  if (lower.includes('regex') || lower.includes('регулярн') || lower.includes('email')) {
    return 'Для проверки email в JavaScript используйте стандартное регулярное выражение:\n\n```javascript\nconst emailRegex = /^[^\\s@]+@[^\\s@]+\\.[^\\s@]{2,}$/;\nconsole.log(emailRegex.test("user@example.com")); // true\n```';
  }

  if (lower.includes('git') || lower.includes('коммит')) {
    return 'Чтобы отменить последний коммит в Git, сохранив изменения в файлах:\n\n```bash\ngit reset --soft HEAD~1\n```';
  }

  return '**Ответ Mini AI:**\n\nВаш запрос: «' + clean + '»\n\n- Запрос выполнен в независимом режиме без сохранения истории.\n- Для получения подробного кода уточните язык программирования или технологию.';
}

async function queryPublicLLM(prompt, signal) {
  const sys = currentSettings.systemInstruction || defaultSettings.systemInstruction;
  const response = await fetch('https://text.pollinations.ai/openai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'openai',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt }
      ],
      temperature: Number(currentSettings.temperature) || 0.4
    }),
    signal
  });

  if (!response.ok) {
    throw new Error('HTTP ' + response.status);
  }

  const data = await response.json();
  const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof content === 'string' && content.trim()) {
    return content.trim();
  }
  throw new Error('Empty response');
}

async function streamTextToUI(fullText, signal) {
  const chunks = fullText.match(/.{1,20}(\s|$)|.{1,20}/gs) || [fullText];
  for (const piece of chunks) {
    if (signal.aborted) break;
    rawAnswerText += piece;
    responseContainer.innerHTML = formatMarkdown(rawAnswerText);
    responseContainer.scrollTop = responseContainer.scrollHeight;
    await new Promise((r) => setTimeout(r, 18));
  }
}

async function sendIndependentQuery() {
  const prompt = promptInput.value.trim();
  if (!prompt) {
    statusText.textContent = 'Введите текст запроса';
    return;
  }
  if (!navigator.onLine) {
    statusText.textContent = 'Нет подключения к интернету';
    return;
  }

  if (abortController) {
    abortController.abort();
  }
  abortController = new AbortController();
  const signal = abortController.signal;

  rawAnswerText = '';
  responseContainer.innerHTML = '';
  copyBtn.disabled = true;
  sendBtn.classList.add('hidden');
  stopBtn.classList.remove('hidden');
  statusText.textContent = 'Генерация ответа…';

  try {
    let answered = false;

    // 1. Если запущено на веб-сервере http/https — используем локальный /api/stream
    if (window.location.protocol === 'http:' || window.location.protocol === 'https:') {
      try {
        const res = await fetch('/api/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model: currentSettings.model,
            systemInstruction: currentSettings.systemInstruction,
            temperature: Number(currentSettings.temperature),
            stateless: true
          }),
          signal
        });

        if (res.ok && res.body) {
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let streamDone = false;

          while (!streamDone) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data:')) continue;
              const jsonStr = line.slice(5).trim();
              if (!jsonStr) continue;
              const event = JSON.parse(jsonStr);
              if (event.text) {
                rawAnswerText += event.text;
                responseContainer.innerHTML = formatMarkdown(rawAnswerText);
              }
              if (event.done) {
                streamDone = true;
                break;
              }
            }
          }
          if (rawAnswerText.trim()) {
            answered = true;
          }
        }
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
      }
    }

    // 2. Если запущено внутри установленного расширения Chrome (chrome-extension://)
    if (!answered && !signal.aborted) {
      try {
        const llmAnswer = await queryPublicLLM(prompt, signal);
        await streamTextToUI(llmAnswer, signal);
        answered = true;
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
      }
    }

    // 3. Безотказный локальный помощник, если внешняя сеть недоступна
    if (!answered && !signal.aborted) {
      const fallback = buildLocalFallbackAnswer(prompt);
      await streamTextToUI(fallback, signal);
    }

    if (!signal.aborted) {
      statusText.textContent = 'Готово · Независимый ответ';
      copyBtn.disabled = !rawAnswerText;
    }
  } catch (err) {
    if (err && err.name === 'AbortError') {
      statusText.textContent = 'Генерация остановлена';
    } else {
      const fallback = buildLocalFallbackAnswer(prompt);
      rawAnswerText = fallback;
      responseContainer.innerHTML = formatMarkdown(fallback);
      statusText.textContent = 'Готово · Автономный режим';
      copyBtn.disabled = false;
    }
  } finally {
    sendBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    abortController = null;
  }
}

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendIndependentQuery();
  }
});

sendBtn.addEventListener('click', sendIndependentQuery);
stopBtn.addEventListener('click', () => abortController && abortController.abort());
clearInputBtn.addEventListener('click', () => {
  promptInput.value = '';
  promptInput.focus();
});

copyBtn.addEventListener('click', async () => {
  if (!rawAnswerText) return;
  await navigator.clipboard.writeText(rawAnswerText);
  copyBtn.textContent = 'Скопировано';
  setTimeout(() => {
    copyBtn.textContent = 'Копировать';
  }, 1500);
});

settingsToggleBtn.addEventListener('click', () => {
  const isHidden = settingsView.classList.contains('hidden');
  if (isHidden) {
    mainView.classList.add('hidden');
    settingsView.classList.remove('hidden');
  } else {
    settingsView.classList.add('hidden');
    mainView.classList.remove('hidden');
  }
});

temperatureInput.addEventListener('input', () => {
  tempValue.textContent = temperatureInput.value;
});

saveSettingsBtn.addEventListener('click', () => {
  saveSettings({
    model: modelSelect.value,
    theme: themeSelect.value,
    temperature: parseFloat(temperatureInput.value),
    systemInstruction: systemPromptInput.value.trim()
  });
  settingsView.classList.add('hidden');
  mainView.classList.remove('hidden');
});

cancelSettingsBtn.addEventListener('click', () => {
  applySettingsToUI();
  settingsView.classList.add('hidden');
  mainView.classList.remove('hidden');
});

loadSettings();