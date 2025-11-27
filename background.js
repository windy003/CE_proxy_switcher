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
  if (request.action === 'toggleProxy') {
    handleToggleProxy(request.enabled);
  } else if (request.action === 'setProfile') {
    handleSetProfile(request.index);
  } else if (request.action === 'clearProxy') {
    handleClearProxy();
  }
});

// 监听快捷键
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-proxy') {
    handleToggleProxyShortcut();
  } else if (command === 'next-profile') {
    handleNextProfile();
  }
});

// 切换代理开关
async function handleToggleProxy(enabled) {
  await chrome.storage.local.set({ proxyEnabled: enabled });

  if (enabled) {
    const data = await chrome.storage.local.get(['currentProfileIndex', 'profiles']);
    const index = data.currentProfileIndex ?? -1;

    if (index >= 0 && data.profiles && data.profiles[index]) {
      await applyProxy(data.profiles[index]);
    } else if (data.profiles && data.profiles.length > 0) {
      // 如果没有选中的配置，使用第一个
      await chrome.storage.local.set({ currentProfileIndex: 0 });
      await applyProxy(data.profiles[0]);
    } else {
      console.log('No proxy profiles available');
      await chrome.storage.local.set({ proxyEnabled: false });
    }
  } else {
    await clearProxy();
  }

  // 更新图标
  updateIcon();
}

// 快捷键切换代理
async function handleToggleProxyShortcut() {
  const data = await chrome.storage.local.get(['proxyEnabled']);
  await handleToggleProxy(!data.proxyEnabled);

  // 显示通知
  const status = !data.proxyEnabled ? '已启用' : '已关闭';
  showNotification('代理状态', `代理${status}`);
}

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

// 切换到下一个配置
async function handleNextProfile() {
  const data = await chrome.storage.local.get(['profiles', 'currentProfileIndex']);
  const profiles = data.profiles || [];

  if (profiles.length === 0) {
    showNotification('代理配置', '没有可用的代理配置');
    return;
  }

  const currentIndex = data.currentProfileIndex ?? -1;
  const nextIndex = (currentIndex + 1) % profiles.length;

  await handleSetProfile(nextIndex);
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
  chrome.notifications.create({
    type: 'basic',
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
