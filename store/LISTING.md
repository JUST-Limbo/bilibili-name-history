# Chrome / Edge 商店上架文案（可直接粘贴）

> 版本对应：`0.0.1`  
> 标记说明：文中 **【需你补充】** 必须由你提供或确认后才能提交审核。

---

## 1. 基本信息

| 字段 | 建议填写 | 状态 |
|------|----------|------|
| 扩展名称（中文） | B站曾用名 | 已填 |
| 扩展名称（英文，可选） | Bilibili Former Names | 已填 |
| 简短说明 / Summary（中文，建议 ≤132 字） | 见下方 | 已填 |
| 详细描述（中文） | 见下方 | 已填 |
| 类别 | 生产力（Productivity）或「工具」类最接近项 | 已填建议，**【需你补充：在后台下拉里点选最终类目】** |
| 语言 | 中文（简体）；可选追加 English | 已填 |
| 可见性 | 公开 | 建议；**【需你补充：确认是否公开】** |
| 官方网址 | https://github.com/JUST-Limbo/bilibili-name-history | 已填 |
| 支持网址 | https://github.com/JUST-Limbo/bilibili-name-history/issues | 已填 |
| 隐私政策 URL | 见「隐私政策」一节 | **【需你补充：确认可公开访问的最终 URL】** |
| 开发者展示名 | JUST-Limbo | 已填建议；**【需你补充：是否用真名/工作室】** |
| 联系邮箱 | — | **【需你补充】** |

### 简短说明（中文，可作 Chrome「简短描述」）

本地记录并展示 B 站 UP 曾用名。支持关注列表 DOM 翻页扫描与可选 API 同步；数据默认仅存本机。非官方工具，仅供学习研究。

### 简短说明（英文，可选）

Locally track Bilibili UP nickname history. DOM follow-list scan and optional API sync. Data stays on your device. Unofficial; for learning only.

---

## 2. 详细描述（中文，可作商店长描述）

```
【B站曾用名】在关注列表、UP 主页、视频页展示你本机备份过的昵称历史。

主要功能
• 浏览 B 站页面时，从页面读取 mid + 昵称并写入本地
• 关注列表：扫描本页 / 自动翻页扫描（带进度与预计耗时）
• Popup：一键 DOM 翻页同步（后台打开关注页，扫完自动关页）
• 可选 API 同步（有风控提示，请谨慎使用）
• 可选自动同步（首次访问 / 按时间间隔）
• 导入导出 JSON 备份；清空本地数据

重要说明
• 曾用名不是 B 站官方完整改名史，只来自本机见过的快照
• 本扩展为非官方第三方工具，与哔哩哔哩无关
• 仅供学习与技术研究，请遵守法律法规与平台规则
• 优先使用 DOM 方式；API 同步可能触发验证码等风控

开源：https://github.com/JUST-Limbo/bilibili-name-history
协议：MIT
```

### 详细描述（英文，可选）

```
Track former Bilibili nicknames from local snapshots on follow lists, space pages, and video pages.

Features: DOM collection, follow-list auto paging, optional API sync, auto sync, import/export.

Unofficial. For learning only. Prefer DOM sync; API sync may trigger risk controls.
GitHub: https://github.com/JUST-Limbo/bilibili-name-history
License: MIT
```

---

## 3. 单项用途声明（Chrome 常问）

**Single purpose：**  
帮助用户在本地记录并展示哔哩哔哩（B 站）UP 主的曾用昵称。

**How it fulfills that purpose：**  
通过页面 DOM（及用户可选的官方站点 API）读取 mid 与昵称，存入浏览器本地存储，并在页面上以徽章形式展示历史昵称。

---

## 4. 权限理由（粘贴到「权限说明 / 主机权限理由」）

| 权限 | 理由（可直接用） |
|------|------------------|
| `storage` | 在用户浏览器本地保存昵称历史记录与扩展设置，不用于其它用途。 |
| `offscreen` | 在后台标签页定时器被节流时，用离屏文档脉冲驱动关注列表 DOM 翻页扫描。 |
| `scripting` | 自动/DOM 同步关注页时，注入必要的页面脚本（如可见性辅助），仅用于保障翻页扫描可用。 |
| `https://space.bilibili.com/*` | 读取空间页与关注列表页面上的 UP 链接与昵称，并展示曾用名徽章。 |
| `https://www.bilibili.com/*` | 在视频等页面读取 UP 信息并展示曾用名徽章；检测访问以触发可选自动同步。 |
| `https://api.bilibili.com/*` | **仅当用户主动选择 API 同步时**，请求关注列表等接口以拉取 mid/昵称；默认可不使用。 |

**远程代码：** 无。所有逻辑打在扩展包内。  
**数据处理：** 默认仅本地；API 同步时仅与 bilibili 通信。

---

## 5. 隐私政策

仓库内已写好：

- Markdown：`docs/privacy.md`
- HTML（更适合填「隐私权政策网址」）：`docs/privacy.html`

**推荐公开 URL（推送后可用其一）：**

1. `https://just-limbo.github.io/bilibili-name-history/privacy.html` —— **【需你补充：若启用 GitHub Pages，按此路径配置】**  
2. 或临时：`https://raw.githubusercontent.com/JUST-Limbo/bilibili-name-history/main/docs/privacy.html`（部分商店更希望是正常网页，优先 Pages）  
3. 或：`https://github.com/JUST-Limbo/bilibili-name-history/blob/main/docs/privacy.md` —— **可能不被接受，不推荐作为唯一政策页**

文内联系邮箱仍为 **【需你补充】**，补上后请同步改 `docs/privacy.md` / `docs/privacy.html` 再打包或再发一版。

---

## 6. 素材规格与清单

### 图标（已有，可直接用）

| 规格 | 文件 |
|------|------|
| 16 / 48 / 128 | `icons/icon16.png` 等（已在扩展包内） |
| Chrome 商店宣传图 128×128 | 可用 `icons/icon128.png`；**【需你补充：若审核要求单独「商店图标」再导出一张无透明边的 128 PNG】** |

### 截图（【需你补充】，商店必填）

Chrome 要求至少 **1** 张，建议 **3～5** 张；尺寸常见 **1280×800** 或 **640×400**（以后台提示为准）。

请自行截取并放到 `store/screenshots/`（该目录已建占位说明）：

| 建议文件名 | 内容 |
|------------|------|
| `01-popup.png` | Popup 主界面（统计 + 同步按钮） |
| `02-follow-toolbar.png` | 关注列表右下角扫描工具条与进度 |
| `03-badge.png` | 页面上「曾用」徽章展示 |
| `04-list.png` | 记录列表页 |
| `05-autosync-settings.png` | 自动同步与速度选项（可选） |

### 其它可选图

| 素材 | 状态 |
|------|------|
| 小型推广图 440×280 | **【需你补充，可选】** |
| 大型推广图 920×680 / 1400×560 等 | **【需你补充，可选】** |
| Marquee 1400×560 | **【需你补充，可选】** |

---

## 7. 账号与费用（【需你补充】）

| 项 | 说明 |
|----|------|
| Chrome 开发者账号 | Google 账号 + 一次性注册费（约 $5，以官网为准） |
| Edge 开发者账号 | Microsoft Partner Center（通常免费，以后台为准） |
| 支付/税务信息 | 按商店后台要求填写 |
| 地区/年龄分级 | 按后台选项选择；本扩展无 UGC 社交，一般可选「适合所有人」类，**【需你补充：确认勾选】** |

---

## 8. 提交前自检

- [x] 扩展 zip 已打包（见 `dist/`）
- [x] 隐私政策文案已写
- [x] 权限理由已写
- [ ] **【需你补充】** 截图放入 `store/screenshots/`
- [ ] **【需你补充】** 隐私政策对外邮箱
- [ ] **【需你补充】** 隐私政策可公网打开的最终 URL（建议 GitHub Pages）
- [ ] **【需你补充】** 注册并登录 Chrome / Edge 开发者后台
- [ ] **【需你补充】** 上传 zip、粘贴本文案、上传截图、提交审核
