# AI_clip — 自动化批量视频剪辑系统

自动化批量视频剪辑系统，实现「素材输入 → 自动剪辑 → 成品输出」全流程自动化。
支持模板驱动的剪辑流程、TTS 配音、ASS 字幕渲染、cinematic 运镜效果，以及并发批量处理。

## 系统要求

- Python >= 3.10
- FFmpeg >= 6.0（需加入系统 PATH）
- Windows 10/11
- 网络连接（edge-tts 需联网）

## 快速开始

### 1. 安装

```bash
# 从项目根目录安装（推荐）
pip install -e .

# 或手动安装核心依赖
pip install edge-tts Pillow PyYAML Jinja2 rich
```

### 2. 扫描素材

```bash
python cli.py scan --input "D:/素材/batch_001" --detail
```

### 3. 查看可用模板

```bash
python cli.py templates
```

### 4. 批量剪辑

```bash
python cli.py process \
  --input "D:/素材/batch_001" \
  --output "D:/成品/batch_001" \
  --template barbershop \
  --workers 4
```

### 5. 自定义文案变量

```bash
python cli.py process \
  --input "D:/素材/理发店/" \
  --output "D:/成品/" \
  --template barbershop \
  --vars "shop_name=锦瑟造型" "shop_location=杭州市西湖区文三路88号"
```

### 6. 单条视频测试

```bash
python cli.py process \
  --input "D:/素材/test.mp4" \
  --output "D:/成品/" \
  --template barbershop
```

## 核心功能

### Cinematic 视频编辑引擎

- **自适应慢放**：根据文案时长自动计算最优播放速度（最低 0.6x），素材播放一次即覆盖全部时长
- **回弹填充（Bounce）**：当慢放不足以覆盖时长时，将末段反向播放并通过 crossfade 无缝衔接，彻底消除冻结帧
- **复合 Ken Burns 运镜**：多频 sin/cos 叠加的缓慢漂移裁剪，模拟手持微动效果
- **节奏明暗脉冲**：在视频中段插入 eq brightness 半波脉冲，产生呼吸感的明暗变化
- **淡入淡出**：片头渐入 + 片尾渐出，时长由模板控制

### ASS 字幕系统

- **SRT → ASS 自动转换**：从 TTS 生成的 SRT 构建完整 ASS 文件，支持精确排版控制
- **智能折行**：根据画面宽度和字号自动计算每行最大字符数，优先在中文标点处断行
- **逐行淡入淡出动画**：每条字幕自带 `\fad()` 效果，切换更自然
- **可配置样式**：字体、字号、描边、阴影、边距、对齐方式等均通过 YAML 模板配置

### TTS 配音

- 基于 edge-tts，支持多种中文语音
- 同步生成 `.mp3` 音频 + `.srt` 字幕时间戳
- 可配置语速（默认 +15%）

### BGM 智能混音

- 侧链压缩（sidechain compress）：配音响时 BGM 自动压低
- 可配置音量、渐入渐出

### 批量并发处理

- asyncio + Semaphore 并发控制
- TTS 与 FFmpeg 渲染独立并发限制
- Rich 进度条实时追踪

## 内置模板

| 模板名 | 适用场景 | 说明 |
|--------|---------|------|
| `barbershop` | 理发店/发型推荐 | 面向女性顾客，叙事风格文案，cinematic 效果 |
| `default` | 通用短视频 | 基础剪辑流程 |
| `product_showcase` | 电商产品展示 | 产品特写 + 卖点文案 |
| `tutorial` | 知识教程 | 教学节奏 + 步骤字幕 |
| `emotional_story` | 情感故事 | 温柔语调 + 叙事节奏 |

## 项目结构

```
AI_clip/
├── cli.py                  # CLI 入口（scan / templates / process）
├── config.yaml             # 全局配置（FFmpeg / TTS / 批处理参数）
├── pyproject.toml          # 项目元数据与依赖声明
├── design.md               # 详细设计文档
│
├── engine/                 # 核心引擎
│   ├── scanner.py          # 素材扫描 + ffprobe/Pillow 元数据提取
│   ├── tts.py              # edge-tts 配音 + SRT 字幕生成
│   ├── copy_writer.py      # Jinja2 文案模板渲染 + 预设随机组合
│   ├── ffmpeg_renderer.py  # FFmpeg 命令构建与渲染（cinematic / ASS / 混音）
│   ├── template_loader.py  # YAML 模板加载、继承、预设引用
│   ├── template_matcher.py # 素材 ↔ 模板自动匹配（评分机制）
│   └── batch.py            # 批量并发调度 + 进度追踪
│
├── templates/              # 剪辑模板库（YAML）
│   ├── _global.yaml        # 全局默认值（所有模板继承）
│   ├── _presets/           # 预设库（色彩方案 / 字幕样式 / 转场）
│   │   ├── color_grades.yaml
│   │   ├── subtitle_styles.yaml
│   │   └── transitions.yaml
│   ├── barbershop.yaml     # 理发店模板（cinematic + 叙事文案）
│   ├── default.yaml
│   ├── product_showcase.yaml
│   ├── tutorial.yaml
│   └── emotional_story.yaml
│
└── assets/                 # 素材资源（gitignored）
    ├── bgm/                # 背景音乐
    └── watermarks/         # 水印图片
```

## CLI 命令参考

### scan — 扫描素材

```bash
python cli.py scan --input <路径> [--detail] [--json]
```

扫描指定文件夹，输出素材数量、总时长、分辨率分布等统计信息。

### templates — 列出模板

```bash
python cli.py templates [--json]
```

列出所有可用模板及其适用场景、匹配规则。

### process — 批量剪辑

```bash
python cli.py process --input <路径> [选项]

选项:
  --output, -o     输出目录（默认: ./temp）
  --template, -t   指定模板名称（不指定则自动匹配）
  --voice          TTS 语音 ID（默认: zh-CN-XiaoxiaoNeural）
  --rate           TTS 语速（如 "+15%", "-5%"）
  --workers, -w    FFmpeg 并发数（默认: 4）
  --vars           文案变量（格式: key=value，可多次指定）
  --json           输出结构化 JSON 报告
```

## 配置说明

编辑 `config.yaml` 调整全局参数：

| 配置段 | 关键参数 | 说明 |
|--------|---------|------|
| `ffmpeg` | `video_codec`, `crf`, `preset` | 编码质量与速度平衡，支持 GPU 加速 |
| `tts` | `default_voice`, `default_rate` | 默认语音角色与语速 |
| `batch` | `max_workers`, `match_threshold` | 并发数与模板匹配最低分 |
| `output` | `default_mode` | 输出模式：`ffmpeg` / `jianying` / `both` |

## 自定义模板

在 `templates/` 目录创建 YAML 文件即可。模板功能：

- **继承**：`extends: _global` 继承全局配置，仅覆盖差异项
- **预设引用**：`$preset:subtitle_styles.bold_yellow` 引用预设库
- **文案变量**：Jinja2 模板语法 `{{ variable }}`，支持条件渲染 `{% if %}`
- **自动匹配**：基于文件名关键词、文件夹名、画面比例、时长范围的评分匹配
- **Cinematic 效果**：配置 `effects.ken_burns` / `effects.slowdown` 控制运镜与慢放
- **字幕样式**：`subtitles.style` 下配置字号、描边、阴影、对齐、淡入淡出等

详见 `design.md` 第 4 章。

## Roadmap

### v0.2 — 智能文案生成

- [ ] 接入 LLM API（OpenAI / 本地模型）自动生成视频文案
- [ ] 根据素材画面内容（关键帧分析）动态调整文案主题
- [ ] 支持多语言文案与配音

### v0.3 — 视频逆向工程

- [ ] 参考视频自动分析：场景切割、节奏检测、转场识别
- [ ] 从参考视频中提取模板参数（`scenedetect` + `whisper`）
- [ ] 一键「仿拍」：输入参考视频 + 素材 → 输出同风格成品

### v0.4 — 剪映草稿导出

- [ ] 生成 `draft_content.json` 剪映工程文件
- [ ] 支持在剪映中二次编辑微调
- [ ] 双通道输出：FFmpeg 直出 + 剪映草稿同时生成

### v0.5 — 多模板多素材编排

- [ ] 单条视频使用多段素材拼接（A-roll / B-roll 编排）
- [ ] 转场库扩展：更多 xfade 过渡效果
- [ ] 图片素材 Ken Burns 动画增强
- [ ] 多模板串联：intro 模板 + body 模板 + outro 模板

### v0.6 — 性能与分发

- [ ] GPU 硬件加速渲染（NVENC / QSV / AMF）
- [ ] 渲染队列持久化与断点续渲
- [ ] 批量输出后自动上传至指定平台（API 对接）
- [ ] Web UI 管理界面

### 长期目标

- [ ] 跨平台支持（macOS / Linux）
- [ ] 素材库管理与标签系统
- [ ] A/B 测试：同一素材自动生成多版本，对比数据表现
- [ ] 插件化架构：自定义剪辑手法、特效、配音引擎
