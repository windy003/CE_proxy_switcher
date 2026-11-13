// 页面元素
const mainView = document.getElementById('mainView');
const formView = document.getElementById('formView');
const proxyStatus = document.getElementById('proxyStatus');
const profilesList = document.getElementById('profilesList');
const formTitle = document.getElementById('formTitle');
const editingIndex = document.getElementById('editingIndex');
const profileName = document.getElementById('profileName');
const proxyType = document.getElementById('proxyType');
const proxyHost = document.getElementById('proxyHost');
const proxyPort = document.getElementById('proxyPort');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelProfileBtn = document.getElementById('cancelProfileBtn');

// 状态变量
let profiles = [];
let currentProfileIndex = -1;
let selectedIndex = 0;
let proxyEnabled = false;

// 统一处理后台返回的代理设置结果
function checkProxyResponse(response, context) {
  if (!response) return true;

  if (response.ok === false) {
    alert(`${context}失败：` + (response.error || '未知错误'));
    return false;
  }

  return true;
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  renderProfiles();
  setupKeyboardNavigation();
});

// 加载数据
async function loadData() {
  const data = await chrome.storage.local.get([
    'profiles', 'currentProfileIndex', 'proxyEnabled'
  ]);
  profiles = data.profiles || [];
  currentProfileIndex = data.currentProfileIndex ?? -1;
  proxyEnabled = data.proxyEnabled || false;

  // 自动选中"对面"的选项，方便快速切换
  // 如果当前是直连，则选中第一个代理配置；如果当前是代理，则选中直连
  if (proxyEnabled) {
    // 当前使用代理，选中直连选项
    selectedIndex = -1;
  } else {
    // 当前是直连，选中第一个代理配置（如果存在）
    selectedIndex = profiles.length > 0 ? 0 : -1;
  }

  updateStatus();
}

// 更新状态显示：开启显示蓝色，关闭显示灰色
function updateStatus() {
  const currentProfile = proxyEnabled && currentProfileIndex >= 0
    ? profiles[currentProfileIndex]
    : null;

  if (proxyEnabled) {
    proxyStatus.textContent = currentProfile ? `已启用 - ${currentProfile.name}` : '已启用';
    proxyStatus.className = 'status-text enabled';
  } else {
    proxyStatus.textContent = '直连';
    proxyStatus.className = 'status-text disabled';
  }
}

// 转义 HTML，避免配置名中的特殊字符破坏页面
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[ch]));
}

// 渲染配置列表
function renderProfiles() {
  profilesList.innerHTML = '';

  // 添加"直连"选项（全局关闭代理）
  const directItem = document.createElement('div');
  directItem.className = 'profile-item direct-item' +
    (selectedIndex === -1 ? ' selected' : '') +
    (!proxyEnabled ? ' active' : '');
  directItem.dataset.index = '-1';
  directItem.innerHTML = `
    <div class="profile-name">直连 (不使用代理)</div>
    <div class="profile-status">${!proxyEnabled ? '✓ 当前' : ''}</div>
  `;
  profilesList.appendChild(directItem);

  // 添加配置列表
  if (profiles.length === 0) {
    const emptyHint = document.createElement('div');
    emptyHint.className = 'empty-hint';
    emptyHint.textContent = '按 N 添加第一个代理配置';
    profilesList.appendChild(emptyHint);
  } else {
    profiles.forEach((profile, index) => {
      const profileItem = document.createElement('div');
      profileItem.className = 'profile-item' +
        (index === selectedIndex ? ' selected' : '') +
        (index === currentProfileIndex && proxyEnabled ? ' active' : '');
      profileItem.dataset.index = index;

      profileItem.innerHTML = `
        <div class="profile-info">
          <div class="profile-name">${escapeHtml(profile.name)}</div>
          <div class="profile-details">${escapeHtml(profile.type.toUpperCase())} ${escapeHtml(profile.host)}:${escapeHtml(profile.port)}</div>
        </div>
        <div class="profile-status">${index === currentProfileIndex && proxyEnabled ? '✓ 当前' : ''}</div>
      `;

      profilesList.appendChild(profileItem);
    });
  }
}

// 键盘导航
function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    // 如果在表单视图中
    if (!formView.classList.contains('hidden')) {
      handleFormKeyboard(e);
      return;
    }

    // 焦点在按钮上时，让按钮自己处理 Enter / 空格
    if (e.target.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) {
      return;
    }

    // 主视图键盘操作
    switch(e.key) {
      case 'ArrowUp':
        e.preventDefault();
        moveSelection(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        moveSelection(1);
        break;
      case 'Enter':
        e.preventDefault();
        applySelectedProfile();
        break;
      case 'e':
      case 'E':
        e.preventDefault();
        editSelectedProfile();
        break;
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        deleteSelectedProfile();
        break;
      case 'n':
      case 'N':
        e.preventDefault();
        showAddForm();
        break;
      case 'Escape':
        window.close();
        break;
    }
  });
}

// 移动选择
function moveSelection(delta) {
  const maxIndex = profiles.length - 1;
  selectedIndex += delta;

  // -1 是直连选项
  if (selectedIndex < -1) {
    selectedIndex = maxIndex;
  } else if (selectedIndex > maxIndex) {
    selectedIndex = -1;
  }

  renderProfiles();
}

// 应用选中的配置
async function applySelectedProfile() {
  let response = null;

  if (selectedIndex === -1) {
    // 选择了直连（全局关闭代理）
    response = await chrome.runtime.sendMessage({ action: 'clearProxy' });
    await chrome.storage.local.set({
      proxyEnabled: false,
      currentProfileIndex: -1
    });
  } else {
    // 选择了某个代理配置（全局启用代理）
    response = await chrome.runtime.sendMessage({
      action: 'setProfile',
      index: selectedIndex
    });
  }

  if (!checkProxyResponse(response, '应用代理配置')) {
    return;
  }

  await loadData();
  renderProfiles();

  // 延迟关闭，让用户看到变化
  setTimeout(() => window.close(), 200);
}

// 编辑选中的配置
function editSelectedProfile() {
  if (selectedIndex < 0) return; // 不能编辑直连
  if (selectedIndex >= profiles.length) return;

  const profile = profiles[selectedIndex];
  formTitle.textContent = '编辑代理配置';
  editingIndex.value = selectedIndex;
  profileName.value = profile.name;
  proxyType.value = profile.type;
  proxyHost.value = profile.host;
  proxyPort.value = profile.port;

  showFormView();
}

// 删除选中的配置
async function deleteSelectedProfile() {
  if (selectedIndex < 0) return; // 不能删除直连
  if (selectedIndex >= profiles.length) return;

  const profile = profiles[selectedIndex];
  if (!confirm(`确定要删除配置"${profile.name}"吗？`)) return;

  profiles.splice(selectedIndex, 1);

  // 更新当前配置索引
  let newCurrentIndex = currentProfileIndex;
  if (currentProfileIndex === selectedIndex) {
    newCurrentIndex = -1;
    await chrome.runtime.sendMessage({ action: 'clearProxy' });
  } else if (currentProfileIndex > selectedIndex) {
    newCurrentIndex = currentProfileIndex - 1;
  }

  await chrome.storage.local.set({
    profiles: profiles,
    currentProfileIndex: newCurrentIndex
  });

  // 调整选择索引
  if (selectedIndex >= profiles.length) {
    selectedIndex = profiles.length - 1;
  }

  await loadData();
  renderProfiles();
}

// 显示添加表单
function showAddForm() {
  formTitle.textContent = '新建代理配置';
  editingIndex.value = '';
  profileName.value = '';
  proxyType.value = 'http';
  proxyHost.value = '';
  proxyPort.value = '';

  showFormView();
}

// 显示表单视图
function showFormView() {
  mainView.classList.add('hidden');
  formView.classList.remove('hidden');
  profileName.focus();
}

// 隐藏表单视图
function hideFormView() {
  formView.classList.add('hidden');
  mainView.classList.remove('hidden');
}

// 表单键盘操作
function handleFormKeyboard(e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    hideFormView();
  } else if (e.key === 'Enter' && !e.shiftKey) {
    // 如果不在 textarea 中，Enter 保存
    if (e.target.tagName !== 'TEXTAREA') {
      e.preventDefault();
      saveProfile();
    }
  }
}

// 保存配置
async function saveProfile() {
  const name = profileName.value.trim();
  const type = proxyType.value;
  const host = proxyHost.value.trim();
  const port = parseInt(proxyPort.value);

  if (!name || !host || !port) {
    alert('请填写完整的配置信息');
    return;
  }

  const profile = { name, type, host, port };
  const index = editingIndex.value;

  if (index === '') {
    profiles.push(profile);
    selectedIndex = profiles.length - 1;
  } else {
    profiles[parseInt(index)] = profile;
  }

  await chrome.storage.local.set({ profiles: profiles });

  hideFormView();
  await loadData();
  renderProfiles();
}

// 配置列表点击：单击选中，双击应用
profilesList.addEventListener('click', (e) => {
  const item = e.target.closest('.profile-item');
  if (!item) return;
  selectedIndex = parseInt(item.dataset.index, 10);
  renderProfiles();
});

profilesList.addEventListener('dblclick', (e) => {
  const item = e.target.closest('.profile-item');
  if (!item) return;
  selectedIndex = parseInt(item.dataset.index, 10);
  applySelectedProfile();
});

// 按钮事件
saveProfileBtn.addEventListener('click', saveProfile);
cancelProfileBtn.addEventListener('click', hideFormView);
