# Proxy Switcher - Chrome 代理切换扩展

一个简单易用的 Chrome 代理切换扩展，类似 Proxy SwitchyOmega，支持快捷键快速切换代理配置。

## 功能特点

- 支持多个代理配置管理
- 支持 HTTP、HTTPS、SOCKS4、SOCKS5 代理类型
- 快捷键快速切换代理开关（Alt+Shift+O）
- 快捷键切换下一个配置（Alt+Shift+N）
- 简洁直观的用户界面
- 实时显示当前代理状态

## 安装方法

1. 下载或克隆此项目到本地
2. 打开 Chrome 浏览器，进入扩展管理页面 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `proxy-switcher` 文件夹
6. **重要：设置快捷键**
   - 打开 `chrome://extensions/shortcuts`
   - 找到 "Proxy Switcher"
   - 点击快捷键输入框，按下 `Alt+Shift+O`（或你喜欢的组合键）
   - 确保快捷键已保存

## 图标文件

扩展需要以下图标文件（需要自行创建或使用在线工具生成）：

```
icons/
  ├── icon16.png  (16x16 像素)
  ├── icon48.png  (48x48 像素)
  └── icon128.png (128x128 像素)
```

### 创建图标的方法：

1. **使用在线工具**：访问 https://www.favicon-generator.org/ 上传一个图片生成不同尺寸的图标
2. **使用设计工具**：使用 Photoshop、Figma 等工具创建简单的代理图标
3. **使用占位图标**：临时使用纯色方块作为占位图标

### 快速创建占位图标（使用 ImageMagick）：

```bash
# 创建 icons 目录
mkdir icons

# 生成简单的蓝色方块图标
convert -size 16x16 xc:#3b82f6 icons/icon16.png
convert -size 48x48 xc:#3b82f6 icons/icon48.png
convert -size 128x128 xc:#3b82f6 icons/icon128.png
```

## 使用说明

### 添加代理配置

1. 点击浏览器工具栏的扩展图标
2. 点击"+ 添加配置"按钮
3. 填写配置信息：
   - 配置名称：例如"公司代理"、"开发环境"
   - 代理类型：HTTP/HTTPS/SOCKS4/SOCKS5
   - 服务器地址：例如 127.0.0.1
   - 端口：例如 8080
4. 点击"保存"

### 使用代理

1. 在配置列表中点击 ✓ 按钮启用对应的代理配置
2. 或者点击"启用代理"按钮使用当前选中的配置
3. 点击"关闭代理"按钮停用代理

### 快捷键

**全局快捷键（任何页面都能用）：**
- `Alt+Shift+O`：打开代理切换面板

**面板内快捷键：**
- `↑↓`：上下选择配置
- `Enter`：应用选中的配置
- `E`：编辑选中的配置
- `D`：删除选中的配置
- `N`：新建配置
- `Esc`：关闭面板

**注意：** 全局快捷键需要在 `chrome://extensions/shortcuts` 中手动设置才能生效。

## 文件结构

```
proxy-switcher/
├── manifest.json      # 扩展配置文件
├── background.js      # 后台服务脚本
├── popup.html         # 弹出窗口页面
├── popup.js           # 弹出窗口逻辑
├── popup.css          # 弹出窗口样式
├── icons/             # 图标文件夹
└── README.md          # 说明文档
```

## 技术说明

- 使用 Chrome Extension Manifest V3
- 使用 Chrome Proxy API 管理代理设置
- 使用 Chrome Storage API 保存配置
- 使用 Chrome Commands API 实现快捷键

## 注意事项

- 本扩展仅在 Chrome 浏览器中可用
- 需要"代理"权限才能修改浏览器代理设置
- 代理配置仅在当前浏览器会话中有效
- 建议在公司网络或开发环境中使用

## 许可证

MIT License
