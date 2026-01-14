// 监听安装事件
chrome.runtime.onInstalled.addListener(() => {
  console.log('Proxy Switcher installed');
  initializeStorage();
  updateIcon();
});

// 监听启动事件
chrome.runtime.onStartup.addListener(() => {
  updateIcon();
});

// 初始化存储
async function initializeStorage() {
  const data = await chrome.storage.local.get(['profiles', 'proxyEnabled', 'currentProfileIndex']);

  if (!data.profiles) {
    await chrome.storage.local.set({
      profiles: [],
      proxyEnabled: false,
      currentProfileIndex: -1,
      currentProfile: null
    });
  }
}

// 监听消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'setProfile') {
    handleSetProfile(request.index);
  } else if (request.action === 'clearProxy') {
    handleClearProxy();
  }
});

// 设置指定配置
async function handleSetProfile(index) {
  const data = await chrome.storage.local.get(['profiles']);
  const profile = data.profiles[index];

  if (!profile) {
    console.error('Profile not found');
    return;
  }

  await chrome.storage.local.set({
    currentProfileIndex: index,
    currentProfile: profile.name,
    proxyEnabled: true
  });

  await applyProxy(profile);
  showNotification('代理配置', `已切换到：${profile.name}`);

  // 更新图标
  updateIcon();
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
}

// 应用代理配置
async function applyProxy(profile) {
  const config = {
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

  return new Promise((resolve, reject) => {
    chrome.proxy.settings.set(
      { value: config, scope: 'regular' },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Error setting proxy:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('Proxy set:', profile);
          chrome.storage.local.set({ currentProfile: profile.name });
          resolve();
        }
      }
    );
  });
}

// 清除代理
async function clearProxy() {
  return new Promise((resolve, reject) => {
    chrome.proxy.settings.clear(
      { scope: 'regular' },
      () => {
        if (chrome.runtime.lastError) {
          console.error('Error clearing proxy:', chrome.runtime.lastError);
          reject(chrome.runtime.lastError);
        } else {
          console.log('Proxy cleared');
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

  chrome.notifications.create({
    type: 'basic',
    iconUrl: iconDataUrl,
    title: title,
    message: message,
    priority: 0
  });
}

// 更新图标背景色
async function updateIcon() {
  const data = await chrome.storage.local.get(['proxyEnabled']);
  const enabled = data.proxyEnabled || false;

  // 创建 canvas 绘制图标
  const canvas = new OffscreenCanvas(128, 128);
  const ctx = canvas.getContext('2d');

  // 设置背景色
  ctx.fillStyle = enabled ? '#4A90E2' : '#9E9E9E'; // 蓝色或灰色
  ctx.fillRect(0, 0, 128, 128);

  // 绘制字母 P
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 80px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('P', 64, 64);

  // 转换为 ImageData
  const imageData = ctx.getImageData(0, 0, 128, 128);

  // 设置图标
  chrome.action.setIcon({ imageData: imageData });
}
