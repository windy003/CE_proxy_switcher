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

// 更新图标背景色
async function updateIcon() {
  try {
    const data = await chrome.storage.local.get(['proxyEnabled']);
    const enabled = data.proxyEnabled || false;

    // 按工具栏需要的尺寸分别生成图标，避免单个大尺寸 ImageData 被新版 Chrome 拒绝
    const imageData = {};
    for (const size of [16, 32, 48, 128]) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // 设置背景色
      ctx.fillStyle = enabled ? '#4A90E2' : '#9E9E9E'; // 蓝色或灰色
      ctx.fillRect(0, 0, size, size);

      // 绘制字母 P（字号随尺寸缩放）
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `bold ${Math.round(size * 0.625)}px Arial`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('P', size / 2, size / 2);

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

// 代理开关状态变化时同步图标（兜底，确保任何入口都能刷新）
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.proxyEnabled) {
    updateIcon();
  }
});
