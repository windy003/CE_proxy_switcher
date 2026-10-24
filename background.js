// 监听安装事件
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Proxy Switcher installed');
  await initializeStorage();
  await restoreProxyIfEnabled();
  updateIcon();
});

// 监听启动事件
chrome.runtime.onStartup.addListener(async () => {
  await restoreProxyIfEnabled();
  updateIcon();
});

const DEFAULT_ACTION = 'proxy';

// 浏览器启动或扩展重载后，重新应用上次启用的代理，避免代理状态丢失
async function restoreProxyIfEnabled() {
  const data = await chrome.storage.local.get([
    'profiles', 'currentProfileIndex', 'proxyEnabled', 'rules', 'defaultAction'
  ]);

  if (!data.proxyEnabled) return;

  const profile = (data.profiles || [])[data.currentProfileIndex];
  if (!profile) return;

  try {
    await applyProxy(profile, data.rules || [], data.defaultAction || DEFAULT_ACTION);
    console.log('Proxy restored:', profile.name);
  } catch (error) {
    console.error('Failed to restore proxy:', error);
  }
}

// 初始化存储
async function initializeStorage() {
  const data = await chrome.storage.local.get([
    'profiles', 'proxyEnabled', 'currentProfileIndex', 'rules', 'defaultAction'
  ]);

  const updates = {};
  if (!data.profiles) {
    updates.profiles = [];
    updates.proxyEnabled = false;
    updates.currentProfileIndex = -1;
    updates.currentProfile = null;
  }
  if (!data.rules) updates.rules = [];
  if (!data.defaultAction) updates.defaultAction = DEFAULT_ACTION;

  if (Object.keys(updates).length > 0) {
    await chrome.storage.local.set(updates);
  }
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    try {
      let result = null;
      if (request.action === 'setProfile') {
        result = await handleSetProfile(request.index);
      } else if (request.action === 'clearProxy') {
        result = await handleClearProxy();
      } else if (request.action === 'refreshProxy') {
        result = await handleRefreshProxy();
      }
      sendResponse({ ok: true, ...(result || {}) });
    } catch (error) {
      console.error('Proxy Switcher error:', error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true; // 异步响应
});

// 设置指定配置
async function handleSetProfile(index) {
  const data = await chrome.storage.local.get(['profiles', 'rules', 'defaultAction']);
  const profile = (data.profiles || [])[index];

  if (!profile) {
    throw new Error('Profile not found');
  }

  await chrome.storage.local.set({
    currentProfileIndex: index,
    currentProfile: profile.name,
    proxyEnabled: true
  });

  const result = await applyProxy(profile, data.rules || [], data.defaultAction || DEFAULT_ACTION);
  showNotification('代理配置', `已切换到：${profile.name}`);

  // 更新图标
  updateIcon();

  return result;
}

// 清除代理
async function handleClearProxy() {
  await chrome.storage.local.set({
    proxyEnabled: false,
    currentProfileIndex: -1,
    currentProfile: null
  });
  await clearProxy();

  // 更新图标
  updateIcon();

  return { mode: 'direct' };
}

// 规则变化后重新应用当前配置（不弹通知）
async function handleRefreshProxy() {
  const data = await chrome.storage.local.get([
    'profiles', 'currentProfileIndex', 'proxyEnabled', 'rules', 'defaultAction'
  ]);

  if (!data.proxyEnabled) return { mode: 'direct' };

  const profile = (data.profiles || [])[data.currentProfileIndex];
  if (!profile) return null;

  return applyProxy(profile, data.rules || [], data.defaultAction || DEFAULT_ACTION);
}

// 应用代理配置
async function applyProxy(profile, rawRules = [], defaultAction = DEFAULT_ACTION) {
  const rules = normalizeRules(rawRules);

  // 有规则，或默认直连时，使用 PAC 脚本按域名分流
  const usePac = rules.length > 0 || defaultAction === 'direct';
  let pacFallback = false;
  let pacError = null;

  if (usePac) {
    try {
      await setProxyConfig({
        mode: 'pac_script',
        pacScript: { data: buildPacScript(profile, rules, defaultAction) }
      });
      console.log('Proxy set:', profile, '(PAC)');
      await chrome.storage.local.set({ currentProfile: profile.name });
      return { mode: 'pac' };
    } catch (error) {
      // PAC 设置失败时退回全局代理，至少保证能正常上网
      console.error('PAC mode failed, falling back to fixed_servers:', error);
      pacFallback = true;
      pacError = error?.message || String(error);
    }
  }

  await setProxyConfig(buildFixedProxyConfig(profile));
  console.log('Proxy set:', profile, '(fixed_servers)');
  await chrome.storage.local.set({ currentProfile: profile.name });
  return { mode: 'fixed', pacFallback, pacError };
}

function buildFixedProxyConfig(profile) {
  return {
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: profile.type,
        host: profile.host,
        port: profile.port
      },
      bypassList: ['localhost', '127.0.0.1', '<local>']
    }
  };
}

function setProxyConfig(config) {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set(
      { value: config, scope: 'regular' },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Error setting proxy:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      }
    );
  });
}

// 清除代理（设置为直连模式，不使用任何代理包括系统代理）
async function clearProxy() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set(
      {
        value: { mode: 'direct' },  // 明确设置为直连，忽略系统代理
        scope: 'regular'
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Error setting direct mode:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('Proxy set to direct mode');
          chrome.storage.local.set({ currentProfile: null });
          resolve();
        }
      }
    );
  });
}

// 规范化规则数据
function normalizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .filter(rule => rule && typeof rule.pattern === 'string' && rule.pattern.trim())
    .map(rule => ({
      pattern: rule.pattern.trim(),
      action: rule.action === 'direct' ? 'direct' : 'proxy'
    }));
}

// 代理协议对应的 PAC 指令
const PROXY_SCHEMES = {
  http: 'PROXY',
  https: 'HTTPS',
  socks4: 'SOCKS4',
  socks5: 'SOCKS5'
};

function proxyDirective(profile) {
  const scheme = PROXY_SCHEMES[profile.type] || 'PROXY';
  return `${scheme} ${profile.host}:${profile.port}`;
}

// 生成单条规则的 PAC 匹配表达式
function buildRuleCondition(pattern) {
  const raw = pattern.trim();

  // 完整 URL 规则
  if (raw.includes('://')) {
    if (raw.includes('*')) {
      return `shExpMatch(url, ${JSON.stringify(raw)})`;
    }
    // 无通配符时按前缀匹配，只要求 URL 边界一致，避免 example.com 误匹配 example.com.evil.com
    const literal = JSON.stringify(raw);
    if (raw.endsWith('/')) {
      return `(url.indexOf(${literal}) === 0)`;
    }
    return `(url.indexOf(${literal}) === 0 && (url.length === ${raw.length} || "/?#:".indexOf(url.charAt(${raw.length})) !== -1))`;
  }

  const hostPattern = raw.toLowerCase();

  // *.example.com：匹配 example.com 及其子域名
  if (hostPattern.startsWith('*.')) {
    const base = hostPattern.slice(2);
    return `(host === ${JSON.stringify(base)} || dnsDomainIs(host, ${JSON.stringify('.' + base)}))`;
  }

  // 其他通配符规则
  if (hostPattern.includes('*')) {
    return `shExpMatch(host, ${JSON.stringify(hostPattern)})`;
  }

  // 普通域名：匹配自身及所有子域名
  return `(host === ${JSON.stringify(hostPattern)} || dnsDomainIs(host, ${JSON.stringify('.' + hostPattern)}))`;
}

// 生成 PAC 脚本
function buildPacScript(profile, rules, defaultAction) {
  const proxyJs = JSON.stringify(proxyDirective(profile));
  const defaultJs = defaultAction === 'direct' ? '"DIRECT"' : proxyJs;

  const ruleLines = rules.map(rule => {
    const target = rule.action === 'direct' ? '"DIRECT"' : proxyJs;
    return `  if (${buildRuleCondition(rule.pattern)}) return ${target};`;
  });

  return [
    'function FindProxyForURL(url, host) {',
    '  host = host.toLowerCase();',
    '  if (isPlainHostName(host) || host === "localhost" || host === "::1" || host === "[::1]" || shExpMatch(host, "127.*")) return "DIRECT";',
    ...ruleLines,
    `  return ${defaultJs};`,
    '}'
  ].join('\n');
}

// 显示通知
function showNotification(title, message) {
  // 创建一个简单的数据URL图标
  const iconDataUrl = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect width="128" height="128" fill="%234A90E2"/><text x="64" y="88" font-size="80" fill="white" text-anchor="middle" font-family="Arial" font-weight="bold">P</text></svg>';

  try {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: iconDataUrl,
      title: title,
      message: message,
      priority: 0
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('Failed to show notification:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.warn('Failed to show notification:', error);
  }
}

// 更新图标：外层背景表示全局代理开关（开启蓝色，关闭灰色），
// 中间圆点表示当前标签页实际是否走代理（走代理红色，直连白色）
async function updateIcon() {
  try {
    const data = await chrome.storage.local.get([
      'profiles', 'currentProfileIndex', 'proxyEnabled', 'rules', 'defaultAction'
    ]);
    const enabled = !!data.proxyEnabled;
    const proxied = (await getActiveMode(data)) === 'proxy';

    // 按工具栏需要的尺寸分别生成图标，避免单个大尺寸 ImageData 被新版 Chrome 拒绝
    const imageData = {};
    for (const size of [16, 32, 48, 128]) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // 外层背景色：全局开关开启为蓝色，关闭为灰色
      ctx.fillStyle = enabled ? '#4A90E2' : '#9E9E9E';
      ctx.fillRect(0, 0, size, size);

      // 中间圆点：当前标签页实际走代理为红色，否则为白色
      ctx.fillStyle = proxied ? '#EF4444' : '#FFFFFF';
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.3, 0, Math.PI * 2);
      ctx.fill();

      imageData[size] = ctx.getImageData(0, 0, size, size);
    }

    chrome.action.setIcon({ imageData }, () => {
      if (chrome.runtime.lastError) {
        console.error('Failed to update icon:', chrome.runtime.lastError);
      }
    });
  } catch (error) {
    console.error('Failed to update icon:', error);
  }
}

// 获取当前活动标签页
function getActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
      if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
        resolve(null);
      } else {
        resolve(tabs[0]);
      }
    });
  });
}

// 本地地址始终直连（与 PAC 脚本保持一致）
function isAlwaysDirectHost(host) {
  const h = host.toLowerCase();
  return h === 'localhost' ||
    h === '::1' ||
    h === '[::1]' ||
    h.indexOf('.') === -1 ||
    h.startsWith('127.');
}

// 与 PAC 规则保持一致的单条规则匹配
function ruleMatches(rule, url, host) {
  const raw = rule.pattern.trim();
  if (!raw) return false;

  if (raw.includes('://')) {
    if (raw.includes('*')) {
      return globMatch(url, raw);
    }
    if (raw.endsWith('/')) {
      return url.indexOf(raw) === 0;
    }
    return url.indexOf(raw) === 0 &&
      (url.length === raw.length || '/?#:'.indexOf(url.charAt(raw.length)) !== -1);
  }

  const pattern = raw.toLowerCase();
  const siteHost = host.toLowerCase();

  if (pattern.startsWith('*.')) {
    const base = pattern.slice(2);
    return siteHost === base || siteHost.endsWith('.' + base);
  }
  if (pattern.includes('*')) {
    return globMatch(siteHost, pattern);
  }
  return siteHost === pattern || siteHost.endsWith('.' + pattern);
}

function globMatch(value, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$').test(value);
}

// 计算当前标签页实际走代理还是直连（PAC 模式按规则及默认动作判断）
// 传入 data 可复用调用方已读取的存储，避免重复读取
async function getActiveMode(data) {
  data = data || await chrome.storage.local.get([
    'profiles', 'currentProfileIndex', 'proxyEnabled', 'rules', 'defaultAction'
  ]);

  if (!data.proxyEnabled) return 'direct';
  if (!(data.profiles || [])[data.currentProfileIndex]) return 'direct';

  const tab = await getActiveTab();
  if (!tab || !tab.url || !/^https?:\/\//i.test(tab.url)) {
    // chrome://、扩展页面等不经过代理
    return 'direct';
  }

  let url;
  try {
    url = new URL(tab.url);
  } catch (error) {
    return 'direct';
  }

  const host = url.hostname;
  if (isAlwaysDirectHost(host)) return 'direct';

  const rules = normalizeRules(data.rules);
  const defaultAction = data.defaultAction || DEFAULT_ACTION;
  const usePac = rules.length > 0 || defaultAction === 'direct';

  // 全局代理模式：没有规则且默认走代理
  if (!usePac) return 'proxy';

  const matched = rules.find(rule => ruleMatches(rule, tab.url, host));
  const action = matched ? matched.action : defaultAction;
  return action === 'direct' ? 'direct' : 'proxy';
}

// 代理开关、配置或规则变化时同步图标
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.proxyEnabled || changes.currentProfileIndex ||
      changes.profiles || changes.rules || changes.defaultAction) {
    updateIcon();
  }
});

// 切换标签页、页面跳转或窗口切换时，按当前页面重新计算图标颜色
chrome.tabs.onActivated.addListener(() => {
  updateIcon();
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab && tab.active && (changeInfo.url || changeInfo.status === 'complete')) {
    updateIcon();
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId !== chrome.windows.WINDOW_ID_NONE) {
    updateIcon();
  }
});
