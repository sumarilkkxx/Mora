# AI_clip 每日变更日志

---

## 2026-04-07

### 一、字幕系统精细化（barbershop 模板）

#### 1. 底部安全距离

- `subtitles.style.margin_v` 从 `90` 调整为 **`480`**
- 确保字幕不被抖音底部 UI（点赞/评论/分享/文字描述区）遮挡
- 新增 `subtitles.safe_area` 语义化配置块，明确标注各方向安全距离

#### 2. 字幕停留时长自动计算

- 新增 `subtitles.timing` 配置段
- 核心规则：每 13 个字符至少展示 1 秒
- 计算公式：`display_time = ceil(字符数 / 13) × 1.0s`
- 示例：30 字符 → 至少 3.0 秒
- 额外 0.3 秒 `padding_seconds` 作为观众反应缓冲

#### 3. 半透明背景底条

- 新增 `subtitles.style.background` 嵌套配置
- 黑色底条 `#000000`，透明度 0.45
- `padding_h: 24`，`padding_v: 10`

#### 4. 右侧安全边距 + 水平居中

- `subtitles.style.margin_h` 从 `50` 调整为 **`120`**（左右对称）
- 避开右侧 120px 互动按钮区域
- intro/outro 标题的 `margin_h` 同步调整为 120

#### 5. 字幕样式同步图示规范

- 字号：`68` → **`48`**（44-52px 范围取中间值）
- 字重：加粗 → **常规**（`bold: false`）
- 新增 `max_chars_per_line: 18`，`max_lines: 3`
- intro 标题字号调整为 `68`（64-72px），`max_chars_per_line: 14`，`max_lines: 2`

**涉及文件：**
- `templates/barbershop.yaml` — subtitles 配置段重构

---

### 二、标题覆盖层系统（新功能）

为视频添加全时段显示的标题文字叠加层，此前模板的 `timeline.intro` 仅控制淡入时长，没有实际文字渲染。

#### 实现细节

- 新增 `title` 顶层配置段（`barbershop.yaml`）
  - `enabled: true`
  - 样式：68px、加粗、top-center（ASS alignment=8）
  - `margin_v: 200`（避开 140px 状态栏 + 头像区）
  - `margin_h: 120`（安全边距）
  - `max_chars_per_line: 14`，`max_lines: 2`
  - 500ms 淡入/淡出
- 新增 `copy.presets.headline` — 8 条标题预设文案
- 新增 `copy.title_template` — 支持 Jinja2 模板渲染标题

#### 引擎改动

- `engine/ffmpeg_renderer.py`
  - 新增 `_build_title_ass()` — 生成标题 ASS 文件
  - 新增 `_build_title_filter()` — 构建标题 ass= 滤镜
  - `build_command()` 新增 `title_text` 参数，在字幕之前叠加标题层
- `engine/copy_writer.py`
  - 新增 `render_title()` — 从模板 copy 配置生成标题文本
- `engine/batch.py`
  - `EditTask` 新增 `title_text` 字段
  - `create_tasks()` 自动从 headline 预设生成标题
  - `_process_one()` 将 title_text 传递给渲染器

**涉及文件：**
- `templates/barbershop.yaml` — 新增 title 配置段 + headline 预设
- `engine/ffmpeg_renderer.py` — 新增标题 ASS 生成 + 滤镜构建
- `engine/copy_writer.py` — 新增 render_title()
- `engine/batch.py` — EditTask 扩展 + 标题生成管线

---

### 三、字幕配置读取修复

修复 `_srt_to_styled_ass` 无法正确读取 YAML 嵌套配置的问题。

#### 修复内容

- **嵌套 outline 配置**：`outline.color` / `outline.width` 现在被正确读取（此前因代码使用扁平 key `outline_color` 导致默认值覆盖）
- **嵌套 background 配置**：`background.enabled` / `background.opacity` 等正确映射到 ASS 的 `BorderStyle=3` 半透明底条模式
- `max_chars_per_line` 和 `max_lines` 现在从 YAML 配置读取，优先于自动计算
- `_wrap_text()` 新增 `max_lines` 参数支持

**涉及文件：**
- `engine/ffmpeg_renderer.py` — `_srt_to_styled_ass()` 重构 + `_wrap_text()` 扩展

---

### 四、字幕双层样式升级

将单层字幕升级为双层渲染，产生「磨砂玻璃背景 + 锐利文字」的精致效果。

#### 实现原理

在 ASS 文件中定义两个样式：

| 层级 | 样式名 | 作用 | 关键参数 |
|------|--------|------|----------|
| Layer 0 | SubBG | 半透明底条 | BorderStyle=3, `\blur5` 柔化边缘 |
| Layer 1 | SubText | 清晰文字 | BorderStyle=1, 2px 描边 + 轻投影 |

每条字幕同时生成两行 Dialogue（底条层 + 文字层），叠加渲染。`\blur5` 使底条边缘产生磨砂柔光效果，文字层保持清晰锐利。

**涉及文件：**
- `engine/ffmpeg_renderer.py` — `_srt_to_styled_ass()` 双层输出
- `templates/barbershop.yaml` — 新增 `background.blur: 5`

---

### 五、标题增加店铺名称 + hashtag

#### 改动

- `title_template` 更新为 `"{{ shop_name }} · {{ headline }}\n{{ hashtag }}"`
- 标题第一行：店名 + 标题（68px 加粗白色）
- 标题第二行：hashtag（35px 暖金色 `#F5DEB3`，常规字重）
- 新增 `copy.presets.hashtag` — 5 条 hashtag 组合预设
- `_build_title_ass()` 支持 `\n` 分隔的多行标题，hashtag 行自动切换小字号和暖色

**涉及文件：**
- `templates/barbershop.yaml` — title_template + hashtag 预设
- `engine/ffmpeg_renderer.py` — `_build_title_ass()` 多行渲染

---

### 六、视频时长延长至 ~20 秒

#### 改动

- TTS 语速：`+0%` → **`-8%`**（节奏更沉稳）
- 新增 `copy.presets.detail` — 8 条中间段落预设（描写造型过程/细节/效果）
- `script_template` 扩展为 5 段结构：opening → detail → body → location → cta
- outro 缓冲时长：`1.0s` → `1.5s`
- 实测输出：**~24 秒**（因随机文案长度有波动）

**涉及文件：**
- `templates/barbershop.yaml` — TTS rate、detail 预设、script_template、outro duration

---

### 七、视觉动效增强

#### Ken Burns 运镜

- `zoom_range`：`0.08` → **`0.12`**（更明显的缩放漂移）
- `drift_speed`：`0.15` → **`0.20`**（更活泼的运动轨迹）

#### 节奏脉冲升级

- 拍数：2 → **3**
- 新增交替模式：奇数拍**压暗**（模拟呼吸暗场），偶数拍**增亮**（模拟闪白过渡）
- 脉冲时长微调：`0.5s` → `0.45s`

#### 色彩动态

- 饱和度波幅：`0.03` → **`0.05`**
- 新增对比度微震：`contrast='1+0.02*sin(t*0.3)'`

**涉及文件：**
- `templates/barbershop.yaml` — ken_burns 参数
- `engine/ffmpeg_renderer.py` — `_build_beat_brightness_expr()` + cinematic eq 表达式

---

### 本日涉及文件总览

| 文件 | 改动类型 |
|------|----------|
| `templates/barbershop.yaml` | 大幅重构：字幕/标题/文案/特效配置 |
| `engine/ffmpeg_renderer.py` | 核心渲染：双层字幕、标题覆盖、动效升级 |
| `engine/copy_writer.py` | 新增 `render_title()` |
| `engine/batch.py` | EditTask 扩展 + 标题管线 |
