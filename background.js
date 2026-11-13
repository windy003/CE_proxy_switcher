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

// 浏览器启动或扩展重载后，重新应用上次启用的代理，避免代理状态丢失
async function restoreProxyIfEnabled() {
  const data = await chrome.storage.local.get([
    'profiles', 'currentProfileIndex', 'proxyEnabled'
  ]);

  if (!data.proxyEnabled) return;

  const profile = (data.profiles || [])[data.currentProfileIndex];
  if (!profile) return;

  try {
    await applyProxy(profile);
    console.log('Proxy restored:', profile.name);
  } catch (error) {
    console.error('Failed to restore proxy:', error);
  }
}

// 初始化存储
async function initializeStorage() {
  const data = await chrome.storage.local.get([
    'profiles', 'proxyEnabled', 'currentProfileIndex'
  ]);

  const updates = {};
  if (!data.profiles) {
    updates.profiles = [];
    updates.proxyEnabled = false;
    updates.currentProfileIndex = -1;
    updates.currentProfile = null;
  }

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
      }
      sendResponse({ ok: true, ...(result || {}) });
    } catch (error) {
      console.error('Proxy Switcher error:', error);
      sendResponse({ ok: false, error: error?.message || String(error) });
    }
  })();
  return true; // 异步响应
});

// 设置指定配置（全局启用代理）
async function handleSetProfile(index) {
  const data = await chrome.storage.local.get(['profiles']);
  const profile = (data.profiles || [])[index];

  if (!profile) {
    throw new Error('Profile not found');
  }

  await chrome.storage.local.set({
    currentProfileIndex: index,
    currentProfile: profile.name,
    proxyEnabled: true
  });

  const result = await applyProxy(profile);
  showNotification('代理配置', `已切换到：${profile.name}`);

  // 更新图标
  updateIcon();

  return result;
}

// 全局关闭代理
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

// 应用代理配置（全局代理，所有网站统一走代理）
async function applyProxy(profile) {
  await setProxyConfig({
    mode: 'fixed_servers',
    rules: {
      singleProxy: {
        scheme: profile.type,
        host: profile.host,
        port: profile.port
      },
      bypassList: ['localhost', '127.0.0.1', '<local>']
    }
  });

  console.log('Proxy set:', profile);
  await chrome.storage.local.set({ currentProfile: profile.name });
  return { mode: 'fixed' };
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

// 更新图标：蓝色表示全局代理已开启，灰色表示已关闭
async function updateIcon() {
  try {
    const data = await chrome.storage.local.get(['proxyEnabled']);
    const enabled = !!data.proxyEnabled;

    // 按工具栏需要的尺寸分别生成图标，避免单个大尺寸 ImageData 被新版 Chrome 拒绝
    const imageData = {};
    for (const size of [16, 32, 48, 128]) {
      const canvas = new OffscreenCanvas(size, size);
      const ctx = canvas.getContext('2d');

      // 背景色：开启为蓝色，关闭为灰色
      ctx.fillStyle = enabled ? '#4A90E2' : '#9E9E9E';
      ctx.fillRect(0, 0, size, size);

      // 中间画一个白色圆环，作为 "O" 形标识
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = Math.max(1, size * 0.12);

      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size * 0.28, 0, Math.PI * 2);
      ctx.stroke();

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

// 代理开关或配置变化时同步图标
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.proxyEnabled || changes.currentProfileIndex || changes.profiles) {
    updateIcon();
  }
});
