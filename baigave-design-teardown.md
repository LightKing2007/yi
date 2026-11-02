# baigave.cn 官网设计拆解档案

> 拆解对象：https://baigave.cn （Linker Beta —— Minecraft ⇄ Blender 桥接工具，BaiGave & WWZ 团队）
> 拆解时间：2026-11-01　　拆解方式：全站 6 页实机浏览 + 前端源码分析
> 用途：官网 / 产品页设计参考档案，供日后学习借鉴

---

## 一、为什么这个站值得学

一句话：**它把官网做成了一个 Minecraft 游戏，把营销做成了证据展示。**

三条核心设计理念：

1. **证据驱动**：全站没有一张插画或概念图，所有视觉素材都是产品真实输出（实机录屏、真实渲染作品），并且可交互验证（光影切换、前后对比滑杆）。
2. **界面极度克制**：纯黑白灰 + 系统字体，所有色彩交给产品截图。界面是"相框"，作品才是"画"。
3. **游戏化引导**：全站埋了一整套 MC 成就系统，每个彩蛋都对应一个功能的使用路径——彩蛋即新手引导。

---

## 二、站点结构（全站仅 6 页，无凑数页）

| 页面 | 路径 | 主题 | 职责 |
|---|---|---|---|
| 首页 | `/` | 暗色 | 产品叙事 + 交互演示 + 定价 |
| 画廊 | `/gallery` | 浅色 | 40 幅真实渲染作品（Otherworld Atlas） |
| 教程 | `/docs` | 浅色 | 6 章指南 + 学习路径进度 |
| 支持与下载 | `/support` | 浅色 | 下载、版本矩阵、兼容性列表、求助 |
| 发布页 | `/releases` | 浅色 | 全版本下载 + SHA-256 校验 |
| 路线图 | `/roadmap` | 浅色 | 车站式 roadmap |

明暗分工原则：**首页暗色造氛围，工具页浅色保可读性。**

---

## 三、视觉设计参数（实测数值）

### 3.1 配色

- 背景：`#fafafa`（浅）/ 近黑（首页暗色区）
- 正文文字：`#0a0a0a` / 暗色区反白 `#ffffff`
- 全站几乎只有黑白灰 + 少量状态色（BETA、PRO、Experimental 徽章）
- **色彩全部来自产品截图与渲染作品**，UI 本身不争抢注意力

### 3.2 字体

纯系统字体栈，零 webfont 加载成本：

```css
font-family: -apple-system, "system-ui", "SF Pro Display", "Segoe UI",
             "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
             "Noto Sans SC", Roboto, sans-serif;
```

- 正文：16px / 行高 24px（1.5）
- H1：字重 **800**，字距 **-0.9px**（负字距是大字标题高级感的关键），移动端 30px，桌面端更大
- eyebrow 小标签（HOW IT WORKS / SUPPORT 等）：**等宽字体 + 全大写 + 宽字距**，这是全站统一的栏目开场样式

### 3.3 按钮与控件

- 主按钮：**全胶囊**（`border-radius: 999px`），高 48px，字号 15px / 字重 600，padding `0 26px`
- 暗色区用白底黑字，浅色区用黑底白字，永远最高对比
- 筛选器（画廊）：同样是胶囊，**每个选项带数量徽标**（如 `Overworld 27`）
- 徽章（BETA / PRO / Experimental）：描边胶囊小标签，与按钮形成体系

### 3.4 排版模式

- 每个 section 固定三段式：**eyebrow 等宽大写标签 → 大标题 → 一句说明**
- 功能卡片用 **01 / 02 / 03 / 04 编号**，阅读动线明确
- 作品编号 No.01–No.40，把画廊做出"图鉴"感
- 关键数据用定义列表（term + definition）排版：40 作品 / 7 维度 / 18 mods / 2048² 最大地形

---

## 四、逐页设计拆解

### 4.1 首页（暗色）

Section 顺序与手法：

1. **Hero**：Blender 实机录屏做背景视频（带暂停按钮），两行大标题讲清产品：
   "Build it in Minecraft, keep working on it in Blender"
   → 标题下依次是：一句话价值描述 → 主 CTA（Download the free Beta）→ 次要 CTA（Watch the trailer 2:30，**标注时长**）→ 免费政策（不限区块、无水印）→ 运行环境 → 团队署名
2. **How it works**：01–04 编号卡片，每张卡片带 **trailer 时间码跳转**（0:22 / 0:43 / 0:59 / 2:00），点击从对应时间点播放——宣传视频与页面内容互相引用
3. **Features 画廊**：地形 / 维度 / 生物 / mods 四组，每组可切换对比（如 4 种地形 mod 切换、7 个维度 hover 展开面板）
4. **光影切换器**（核心交互演示）：**同一个镜头、同一相机，切换 14 款光影包**，支持列表点选 + 键盘上下键切换，注明"无后期调色"
5. **DLSS5 对比**：原图 vs 增强图的**拖动对比滑杆**，样式 1–3、叠加 1–4 层可选
6. **定价**：Free $0 / Personal Pro $19.90 月 / Commercial $49 月 / Founder's Edition $200 限量 50 席；月付年付切换（年付 $16.5/mo、$33/mo）；PRO 标签从功能区一路贯穿到定价，商业逻辑闭环

### 4.2 画廊 /gallery

- 40 幅作品全部真实渲染，每幅标注：**光影包 + 维度 + 主题**——画廊同时是兼容性证明
- 三组独立筛选（维度 / 主题 / 光影包），胶囊按钮带计数
- 点击作品开 lightbox 看大图与详情
- 底部列出全部素材来源（光影包、mods），"All rights belong to their authors"——版权姿态值得学

### 4.3 教程 /docs（最值得学的一页）

- **不用软件截图，用 HTML 复刻软件界面**：Minecraft 标题菜单、Blender 面板、文件管理器、启动器，全部用 DOM 画出，在模拟 UI 上标注步骤 1、2、3
  - 优点：永不过时（软件改版只需改 DOM）、永远高清、体积小、可翻译、可交互
- **学习路径进度图**：6 个章节节点，完成的节点点亮，点节点跳章节
- 每章标注预计时长（About 5 min）与难度标签（PRO / Experimental）
- 章节末尾有"Mark chapter as complete"按钮 + 上一章/下一章

### 4.4 支持与下载 /support

- 顶部环境胶囊（Windows x64 / MC 1.21.1 NeoForge / Blender 5.0.0–5.2.2）
- 图标式 tab 导航（Download / Version / Compatibility list / Sample projects / Help）
- 下载卡片信息完整：版本、体积、SHA-256、运行环境
- **版本支持矩阵**：Minecraft 版本 × 加载器（34 组合、3 加载器），点格子查看该版本各功能验收情况，区分"稳定 / 实验有验收记录 / 实验无记录"
- **兼容性列表把"人工测试"与"AI 测试"分开标注**——极致诚实，建立信任
- 反馈模板一键复制（系统 / 版本 / 复现步骤 / 日志），降低报 bug 门槛
- QQ 群号一键复制，带 `aria-live` 状态提示

### 4.5 发布页 /releases

- 按 MC 版本筛选 + 下载源切换（本站 / GitHub）
- 每个文件带 SHA-256，**并直接给出校验命令**（`certutil -hashfile filename SHA256`）
- 反复强调"模组和插件必须用同一次发行"（防混装踩坑）

### 4.6 路线图 /roadmap

- **车站隐喻**：STATION 01 → STATION 05 → FINAL STOP，与"连接两个世界"的产品叙事呼应
- 状态四档：Completed（带日期）/ In progress / Planned / Idea
- 远期方向明写"未必会做，没有时间表"——不画饼
- 末尾收集用户版本/整合包反馈，"你的反馈决定我们先支持哪个版本"

---

## 五、交互与动效细节（源码级）

### 5.1 磁性按钮（magnetic button）⭐

挂在 `[data-magnetic]` 元素上，**不用动画库，跟手与回弹全靠一条 CSS transition**。

JS（还原自源码）：

```js
// 前置开关：pointer:fine（仅鼠标设备）+ 非 prefers-reduced-motion
btn.addEventListener("pointerenter", () => rect = btn.getBoundingClientRect()); // 进入时缓存 rect，避免每帧重排

btn.addEventListener("pointermove", e => {
  const dx = e.clientX - (rect.left + rect.width / 2);
  const dy = e.clientY - (rect.top + rect.height / 2);
  const x = clamp(dx * 0.16, -8, 8);  // 横向跟随 16%，限幅 ±8px
  const y = clamp(dy * 0.30, -5, 5);  // 纵向跟随 30%，限幅 ±5px
  btn.style.translate = `${x}px ${y}px`;
});

btn.addEventListener("pointerleave", () => btn.style.translate = ""); // 置空，CSS 接管回弹
```

CSS：

```css
.lk-btn {
  transition: translate 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

要点：

- **跟随手感 = transition 追目标值**：mousemove 只改目标，0.5s 过渡自动产生"轻微滞后地跟随"
- **回弹曲线** `cubic-bezier(0.34, 1.56, 0.64, 1)`：1.56 是过冲量，调大弹得更夸张
- **X/Y 不对称**：横向钝（0.16 / ±8px）、纵向灵敏（0.3 / ±5px），稳而不飘
- **用 CSS `translate` 属性而非 `transform`**：与 hover 缩放、阴影动画解耦
- 性能：enter 时缓存一次 rect，move 里不读布局

### 5.2 全站动效体系

- 全站 **154 个元素带 transition**，但几乎没有循环播放的 CSS animation——动效全部服务于交互反馈，不做无谓炫技
- 通用微动效参数：
  - 链接变色：0.15s ease
  - 按钮/图标弹性：`cubic-bezier(0.34, 1.56, 0.64, 1)`（回弹）
  - 阴影/透明度：`cubic-bezier(0.16, 1, 0.3, 1)`（缓出）
  - header 滚动变色：0.25s ease
  - 图片淡入：0.3s；加载占位 0.4–0.6s
- **Lenis 平滑滚动**：滚动手感有阻尼感，是它"高级感"的重要来源
- 滚动驱动管线动画 `pipelineFlow`（首页叙事用）

### 5.3 可访问性（a11y）做到的程度

- 画廊/光影列表完整键盘导航：方向键 + Home / End
- Lightbox：Esc 关闭、Tab 焦点循环、打开时焦点移入
- **RTL 适配**（阿拉伯语）：方向键逻辑按 `document.dir` 反转
- 复制操作结果用 `aria-live="polite"` 播报
- `prefers-reduced-motion` 时禁用磁性与滚动动效
- 背景视频提供暂停按钮

### 5.4 Boss 血条阅读进度条（导航栏下方）⭐

**把 MC 打 Boss（末影龙/凋灵）时的屏幕顶部血条，做成了阅读进度条。**

- 结构：Boss 名 = 当前章节名（`lk-boss-name`），血条 = 全页滚动进度（`lk-boss-fill`，`scaleX` 驱动，GPU 友好）
- 各章节用 `[data-boss="章节名"]` 声明；当前章节判定用 IntersectionObserver 在视口中央开一条约 6% 高的判定带（`rootMargin: -42% 0px -52%`），扫过中线即为当前章节
- **章节名切换 = SGA 乱码解码**（见 §5.5），380ms 快速版
- **只在滚动时出现**：停止滚动 1400ms 后自动隐藏；滚过首屏 55% 高度才出场，进度达 98.5% 提前退场；滚到底（>99.5%）解锁"探底"成就
- scroll 事件用 rAF 节流，语言切换时同步更新

### 5.5 SGA 文字解码动效（text scramble）

**乱码字符池是 MC 附魔台文字（Standard Galactic Alphabet，银河字母）**：`リ ᑑ ∷ ᓭ ℸ ⚍ ⍊ ∴ ⨅` 等——函数命名 `sga` 即此意。不是随手找的随机符号，是和产品世界观一致的彩蛋。

实现要点（还原自源码）：

```js
// 触发：IntersectionObserver（threshold 0.6，支持 data-sga-delay）或 hover（420ms）
const GLYPHS = ["リ","ᑑ","∷","ᓭ","ℸ","⚍","⍊","∴","⨅"];          // 附魔台字符池
const KEEP = /[\s·•\/\-—_|:：,，.。()（）+#&0-9]/;               // 标点/空格/数字不参与乱码

function sga(el, { duration } = {}) {
  const text = el.dataset.sgaText || el.textContent;
  el.dataset.sgaText = text;
  el.setAttribute("aria-label", text);                 // 屏幕阅读器只读原文
  if (reducedMotion) { el.textContent = text; return; }
  const chars = Array.from(text);
  const total = duration || Math.min(1100, 360 + chars.length * 34); // 时长随字数，上限 1100ms
  el.style.minWidth = Math.ceil(el.getBoundingClientRect().width) + "px"; // 锁宽防跳动
  const token = (el._sgaToken || 0) + 1;               // token 防动画叠加
  el._sgaToken = token;
  const start = performance.now();
  let lastShuffle = 0;
  let pool = chars.map(c => KEEP.test(c) ? c : randomGlyph());
  function frame(now) {
    if (el._sgaToken !== token) return;
    const p = Math.min(1, (now - start) / total);
    if (now - lastShuffle > 55) {                      // 每 55ms 刷新乱码（约 18fps 跳变感）
      lastShuffle = now;
      pool = chars.map(c => KEEP.test(c) ? c : randomGlyph());
    }
    let out = "";
    for (let i = 0; i < chars.length; i++) {
      const settleAt = 0.18 + (i / chars.length) * 0.72; // 每字解码时间点：从左到右依次落定
      out += p >= settleAt ? chars[i] : pool[i];
    }
    el.textContent = out;
    if (p < 1) requestAnimationFrame(frame);
    else { el.textContent = text; el.style.minWidth = ""; }
  }
  requestAnimationFrame(frame);
}
```

### 5.6 命令栏、聊天与陪伴系统

- **命令栏快捷键 = MC 同款**：`T` 打开聊天、`/` 直接输入命令；支持 Tab 补全（带用法与说明的候选列表）、↑↓ 翻命令历史、Esc 关闭；输错报"未知命令「/xxx」，输入 /help 查看列表"
- 聊天消息走 `linker:say` 事件，MC 格式 `<BaiGave> 嗨！`
- **右侧 3D 小人全程陪伴**：`aside#scroll-companion-widget` 固定视口右侧（md 以上显示），Three.js canvas 渲染；全局监听鼠标位置与**鼠标移动速度**，3D 场景据此做视差/反应
- **平静模式**：`/gamemode spectator` 或 `linker:calm` 一键关闭全站装饰动画

**完整命令表（10 个，把 MC 命令系统整个搬进了官网）：**

| 命令 | 功能 | 细节 |
|---|---|---|
| `/help` | 列出全部命令 | 每条带用法与说明 |
| `/tp <目标>` | 跳转页面区块或其他页面 | 反馈文案"已将 BaiGave 传送至 xx" |
| `/time set day\|night` | 切换白天/夜晚 | 支持中文别名（夜/夜晚/白天/昼），切夜晚解锁"夜猫子" |
| `/weather clear\|rain\|thunder` | 切换天气 | 支持中文（晴/雨/雷/雷雨），非晴天解锁"呼风唤雨" |
| `/gamemode survival\|spectator` | 开关装饰动画 | 输入 `creative` 有彩蛋回复："官网没有创造模式……不过 Blender 里有" |
| `/give @s <物品>` | 给自己物品 | **会打上作弊标记**（`linker.cheat.v1`）；已有该物品会拒绝 |
| `/clear` | 清空物品栏 | 同时清除作弊标记 |
| `/advancement list\|revoke` | 查看/重置成就 | 显示"已达成 x/y"及全部称号 |
| `/locate <名称>` | 搜索支持清单（模组/光影/材质包） | 不在支持页会自动带参跳转 `support?q=...#lists` |
| `/summon cod\|salmon\|phantom` | 召唤鳕鱼/鲑鱼/幻翼 | 仅首页有效，其他页提示"这里没有可召唤的生物，去首页试试" |
| `/say <文字>` | 聊天栏发言 | 直接以 `[BaiGave]` 身份说话 |

**物品栏 = MC 快捷栏（hotbar）**：`lk-hotbar` 共 **9 格 slot**，收集的物品实时入栏，可展开/收起（mini/hidden 两态）；集齐 9 件解锁"收藏家"。

**本地存储键（一套完整的"存档"体系）：**
`linker.adv.v1` 成就 · `linker.items.v1` 物品栏 · `linker.night.v1` 夜晚 · `linker.calm.v1` 平静模式 · `linker.cheat.v1` 作弊标记 · `linker.hint.v1` 新手提示 · `linker.weather`（sessionStorage）天气

### 5.7 天气与日夜环境系统

- **全屏 canvas 下雨**：雨滴数量按屏幕面积自适应（宽×高÷9000），dpr 上限 2；雨滴长度/速度/透明度随机，斜向飘落（x 偏移 = 速度×0.18）；页面隐藏时暂停渲染
- **雷雨 = 双闪闪电**：每 5–14 秒随机触发全屏闪光，opacity 关键帧 `0 → .55 → .1 → .4 → 0`（700ms）——两次闪烁，和真实雷电一致
- **日夜切换用 View Transitions API**：从鼠标点击位置**圆形展开**（`clip-path: circle(0 → 全屏半径)`，720ms）——日夜交替像月食一样从点击处晕开，而非生硬换色
- 天气存 sessionStorage（关标签页重置），夜晚存 localStorage（长期记忆）

### 5.8 新手引导与成就 toast 分级

- **首次解锁成就后 2.2 秒**，弹出一次性提示："小提示：按 / 可以打开命令栏，输入 /help 看看能做什么"（存 `linker.hint.v1`，只弹一次）——用第一个成就当钩子，把用户引进命令系统，形成引导链
- **成就 toast 分两档**（还原 MC 原版）：普通成就"进度达成！"（停留 4.6s），稀有挑战"挑战完成！"（`is-rare` 样式，停留 6.5s）
- toast 队列最多同屏 3 条，`role="status"` 无障碍播报，进出场各有过渡动画

### 5.9 性能细节

- 鼠标 hover 作品即**预热加载**（pointerover warm），点击零等待
- 资源全部带内容 hash（`index.298397b41a51221f.js`），可按内容永久缓存
- 视频用 **HLS** 流式加载，首页 3D 用 **Three.js**，按需 chunk 加载
- Three.js 延迟加载策略：IntersectionObserver 提前 160px 触发，`fetchPriority: "low"` 不抢首屏带宽
- **游戏级动画时钟**：固定步长（16.67ms）动画循环，页面隐藏自动暂停，平静模式自动降级
- 23 种语言的 locale 文件按需加载，不打包进主 bundle

---

## 六、成就系统（全站游戏化的核心）⭐

进度存 localStorage（`linker.adv.v1`，数组记录已解锁 key），另有 `linker.hint.v1` 记录提示状态。

**达成成就时：屏幕掉落对应 MC 物品**（带 `lk-drop-bob` 上下浮动 + `lk-drop-spin` 旋转 + `lk-drop-shadow` 影子动画，物品入栏有 `lk-slot-pop` 弹出效果），并弹出 MC 风格成就 toast（"Advancement made!"）。

| 成就 | 物品 | 触发方式 | 对应功能引导 |
|---|---|---|---|
| 探底 Rock Bottom | — | 滚到页面最底部 | 浏览完整页面 |
| 打个招呼 Say Hello | 羽毛 | 戳首页 BaiGave 小人 | 发现 3D 彩蛋 |
| 钓鱼佬 Gone Fishing | 鳕鱼 | 在页脚水里抓到鱼 | 探索页脚 |
| 空投补给 Airdrop | 箱子 | 打开幻翼背上驮的箱子 | 探索页面场景 |
| 明察秋毫 Keen Eye | — | 拖一次光影对比滑杆 | 体验 DLSS5 对比 |
| 光影鉴赏家 Shader Connoisseur | 萤石 | 切换 ≥6 款光影包 | 深度体验光影演示 |
| 夜猫子 Night Owl | 时钟 | 把场景时间调到夜晚 | 体验环境控制 |
| 呼风唤雨 Weather Maker | — | 改变天气 | 体验环境控制 |
| 好学 Eager Learner | 书 | 完成一章教程 | 读文档 |
| 出师 Graduate | 书 | 完成全部教程章节 | 读完文档 |
| 一路向前 Full Steam Ahead | 矿车 | 坐矿车到 Roadmap 终点 | 看路线图 |
| 按图索骥 On the Right Track | 地图 | 在支持页搜索一次 | 用自助支持 |
| 赛道观众 Race Spectator | 场记板 | 看完一场渲染性能赛跑 | 看性能对比 |
| 杀青 That's a Wrap | 场记板 | 看完核心特性（功能时间轴全部镜头） | 看完功能演示 |
| 命令方块 | 命令方块 | 打开命令栏 | 发现快捷入口 |
| 收藏家 Collector | — | 集齐 hotbar 全部 9 件物品 | 全探索毕业 |
| （语言彩蛋） | — | 切换中文（key: `zh`） | 多语言 |
| （清理彩蛋） | — | key: `clean` | 重置数据 |

**设计逻辑：成就覆盖"看首页 → 玩演示 → 读文档 → 下资源 → 看路线图 → 进社群"完整转化路径，本质是任务线式用户引导。**

---

## 七、彩蛋本体（3D 场景与交互细节）

1. **首页 BaiGave 小人（陪伴精灵）**：Three.js 实时 3D，固定视口右侧全程陪伴
   - **模型 = 作者本人的 MC 皮肤**（`baigave-skin.png`，NearestFilter 保持像素风），手工 UV 展开的方块小人 + 描边线框
   - **有物理系统**：重力 0.7、阻尼 0.32、能量保留 0.982——原地 idle 弹跳、落地有回弹
   - **会"受惊"**：鼠标距它 <160px 且移动速度 >6 时，按距离和速度给它加抖动速度（flutter），快速横扫鼠标它会颤起来
   - 戳一下：MC 聊天发言 `<BaiGave> 嗨！` + 掉落羽毛 + 解锁 `hello` 成就
2. **Hero 3D 场景 = 多层浮空岛**：多个 slab 拼合的浮空地形板块，白色标准材质 + 黑色描边（EdgesGeometry），三灯布光；**每层有独立的鼠标视差系数（0.015–0.032）与滚动视差系数（0.045–0.08）、漂移速度、相位**，透明度随距离衰减（0.62→0.85）——近快远慢的经典纵深视差
3. **页脚鱼缸**：Three.js 水面（透明材质），鳕鱼真实游动，点击抓鱼 → 掉落鳕鱼 + 解锁"钓鱼佬"；`/summon cod|salmon` 可额外召唤
4. **幻翼空投**：幻翼驮箱子绕场飞行（`/summon phantom` 让它再飞一圈，平静模式下禁用），点箱子 → 掉落箱子 + 解锁"空投补给"
5. **Roadmap 矿车**：不是静态排版，可以"坐矿车"沿车站走一趟（解锁"一路向前"）
6. **命令栏**：按 `T` / `/` 呼出（MC 同款快捷键，详见 §5.6），打开解锁"命令方块"成就
7. **功能时间轴 = 放映机**：首页 How it works 是"镜头"制（镜头 n/total：标题），看完所有镜头解锁"杀青"（场记板物品）

### 附：性能赛跑（当前未上线）

代码中留有完整的"性能赛跑"体系：成就"赛道观众"（看完一场性能赛跑）、`#benchmark` 锚点样式、`data-bm-time / data-bm-mem`（用时 / 显存峰值）等，但当前线上页面未见该板块。从残留文案可知其形式：

- **导入就绪时间对比**：不同选区尺寸下各工具的"就绪用时"柱状图（"各尺寸选区，{tool} 都最快就绪"）
- 渲染器对比口径严谨：Nacre 用各光影包渲染同一场景同一机位；**Cycles / EEVEE 用 Blender 物理天空 + 太阳照明、曝光对齐 Nacre 画面**，并标注"EEVEE 峰值 / Cycles 峰值"
- 图表带无障碍文本（"就绪时间柱状图：{groups}"）

→ 可借鉴点：**性能对比要给统一测试口径（同场景、同机位、曝光对齐），并附原始数据与图表的无障碍描述**。

---

## 八、内容与文案策略

1. **一切宣传可验证**：每张图注明"实机录制 / Nacre 原生渲染 / 无后期调色"；作品标注来源光影包与 mod
2. **诚实标签体系**：Experimental（实验）、PRO（付费）、Coming soon（未开放）全站一致使用；FAQ 没写完就写"FAQ in progress"；Roadmap 远期写"未必会做"
3. **人工 / AI 测试分开标注**（兼容性列表）——罕见的透明度，直接建立信任
4. **免费政策前置**：hero 区就讲清"导入编辑录制免费、不限区块、无水印"，消除下载顾虑
5. **CTA 标注成本**：Watch the trailer 2:30（时长）、每章 About 5 min（时间）——降低点击决策成本
6. **数字证明**：5,100 区块整城导入、≈1.2 亿顶点、469 种村民服装组合、34 版本组合——具体数字代替形容词
7. **版权与合规**：页脚 Mojang 免责声明；画廊注明素材权利归属作者

---

## 九、多语言与分市场运营

- **23 种语言**：en, zh-CN, zh-TW, ru, es, pt-BR, de, ja, fr, pl, ko, tr, th, uk, it, cs, hu, vi, sv, nl, id, hi, ar（含 RTL）
- **分市场渲染**：`data-market-only="cn" / "global"`
  - 国内：B 站、QQ 群（1060350010）、爱发电 / B 站小店、人民币定价（两年后 ¥98/年续更）
  - 海外：Discord、Gumroad、美元定价（$49/年续更）
- 语言检测：`zh-` 开头 → cn 市场，其余 → global
- 切换语言后重新计算导航布局（防文字变长溢出）

---

## 十、可直接复用的代码片段

### 10.1 胶囊主按钮

```css
.btn {
  height: 48px;
  padding: 0 26px;
  border-radius: 999px;
  font-size: 15px;
  font-weight: 600;
  background: #fff;
  color: #0a0a0a;
  transition: translate 0.5s cubic-bezier(0.34, 1.56, 0.64, 1),
              transform 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1),
              background-color 0.15s ease;
}
```

### 10.2 eyebrow 栏目标签

```css
.eyebrow {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 13px;
  color: #888;
}
```

### 10.3 大标题

```css
h1 {
  font-weight: 800;
  letter-spacing: -0.03em; /* 负字距，大字号才用 */
  line-height: 1.12;
}
```

### 10.4 磁性按钮

见 §5.1。三要素记忆：**偏移 = 鼠标距中心 × 0.16~0.3；限幅 ±5~8px；回弹 cubic-bezier(0.34, 1.56, 0.64, 1)**。

### 10.5 成就 toast + 掉落物动画思路

- keyframes 三件套：`drop-bob`（Y 轴正弦浮动）、`drop-spin`（Y 轴旋转）、`drop-shadow`（影子随浮动缩放）
- 解锁进度存 localStorage，数组去重
- 事件总线：`linker:say`（聊天）/ `linker:drop`（掉物品）/ `linker:adv`（成就）解耦触发与表现

---

## 十一、它做得不好的地方（反面教材）

1. **i18n 没收尾**：英文页混入"同一个镜头，14 款光影包"等中文标题、Releases 底部突兀中文提示
2. **数据不同步**：Roadmap 写当前版本 Beta 1.0.1，Releases 已 Beta 1.0.13——多处手工维护同一数据导致漂移
3. **付费链路未闭环**：Pro / Commercial 均为 Gumroad Coming soon，"Get a license" 无法完成购买
4. **多处占位**：示例 .blend、QQ 频道、源码库均 Coming soon
5. 首页信息密度高、页面非常长，首屏之后的内容到达率依赖滚动引导（它用成就来补偿）

---

## 十二、借鉴优先级清单（Checklist）

如果要给自己的产品做官网，按此顺序抄：

- [ ] **P0 证据驱动**：真实录屏 hero、真实作品画廊、可交互对比（同镜头切换 / 前后滑杆）
- [ ] **P0 克制视觉**：黑白灰 UI + 系统字体 + 胶囊按钮 + eyebrow 标签 + 负字距大标题
- [ ] **P1 微交互手感**：磁性按钮、回弹曲线、Lenis 平滑滚动、hover 预加载
- [ ] **P1 教程体验**：HTML 复刻软件 UI 代替截图、学习路径进度、章节时长标注
- [ ] **P1 信任建设**：Experimental/PRO 诚实标签、SHA-256、版本兼容矩阵、反馈模板
- [ ] **P2 游戏化**：成就系统（覆盖完整转化路径）、掉落物动画、页脚彩蛋、3D 吉祥物
- [ ] **P2 工程**：23 语言按需加载、分市场渠道、资源 hash、键盘导航 + RTL + reduced-motion
- [ ] **P0 避免**：i18n 混排、多源数据手工同步、购买链路断点

---

## 十三、技术架构与托管成本（实测）

### baigave.cn：无框架静态站 + Cloudflare 边缘

- **无前端框架**（无 Next / Nuxt / Astro / Vue / WP 痕迹），纯静态多页站（MPA）
- **Tailwind CSS + 自研设计系统**（`--lk-*` CSS 变量），HTML 内联关键 CSS
- **原生 JS 自研**，按页拆 chunk：`index.js`（全站共享：i18n / 成就 / 命令栏 / 天气 / 磁性按钮 / Boss 血条）+ `home-motion.js` / `support.js` / `gallery.js`
- 第三方库仅 4 个且按需加载：**Three.js**（3D）、**HLS.js**（视频）、**Lenis**（平滑滚动，打包进 motion chunk）、**lucide**（图标）
- i18n：23 个 JSON locale 按需加载；**服务端/边缘按市场返回不同 HTML**（中文请求返回中文版）
- 托管：**Cloudflare**（`server: cloudflare`，`cf-cache-status: HIT`，静态 CDN 缓存命中）；下载走 **GitHub Releases**；支付：海外 Gumroad / 国内爱发电、B 站小店
- **成本估算：约 0 元/月**（Cloudflare 免费档 + GitHub 免费，仅域名年费；Gumroad 按销售抽成）

### 对照：yi 官网（yi.lightking.com.cn）

- **自研 Node SSR**：`server/` 下页面模块（homePage / supportPage / downloadPage / agreementPage / notFoundPage），esbuild 打包为 `web.cjs`，systemd `yi-web.service` 常驻，**Caddy** 反代自动 HTTPS
- 法务与支持文档（Markdown）**预生成静态 HTML**（`static-pages.cjs` + `site.tar`），支持页带前端搜索
- 部署：自有 VPS，SSH + GitHub Releases 版本分发（`web-<commit12>` 标签），构建有**白名单隔离**（官网禁止打包账号/数据库/联机模块）
- 游戏本体：Preact + TypeScript + Vite 8 + Electron + Node ws 联机
- **成本：VPS 月租**（自有服务器，固定支出），其余同免费组合

### 两条路线的取舍

| | baigave（静态 + CDN） | yi（自研 SSR + VPS） |
|---|---|---|
| 成本 | ≈0 | VPS 固定月租 |
| 动态能力 | 靠前端 JS + 边缘区分市场 | 服务端任意逻辑 |
| 运维 | 几乎无 | 需维护服务与部署链 |
| 适合 | 产品展示站 | 需要服务端动态内容的站 |

*档案完。所有数值与功能均来自 2026-11-01 对 baigave.cn 的实机观察与前端源码分析，后续网站更新可能变化。*
