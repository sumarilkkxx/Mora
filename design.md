# AI_clip — 自动化批量视频剪辑系统 设计文档

**版本**: v1.0  
**日期**: 2026-04-05  
**状态**: 设计阶段

---

## 目录

1. [需求概述](#1-需求概述)
2. [系统架构](#2-系统架构)
3. [模块详细设计](#3-模块详细设计)
4. [模板系统](#4-模板系统)
5. [视频逆向工程（模板提取）](#5-视频逆向工程模板提取)
6. [素材自动匹配](#6-素材自动匹配)
7. [交付形态与 OpenClaw 集成](#7-交付形态与-openclaw-集成)
8. [技术选型与依赖](#8-技术选型与依赖)
9. [分阶段实施计划](#9-分阶段实施计划)
10. [风险评估与应对](#10-风险评估与应对)
11. [附录](#11-附录)

---

## 1. 需求概述

### 1.1 核心目标

构建一个自动化批量视频剪辑系统，实现「素材输入 → 自动剪辑 → 成品输出」全流程自动化。

### 1.2 工作流程

```
用户将视频/图片素材放入输入文件夹
        ↓
OpenClaw 对话触发 / CLI 手动触发
        ↓
系统自动扫描素材 → 分析特征 → 匹配模板
        ↓
自动执行：视频剪辑 + 文案生成 + TTS配音 + 字幕渲染
        ↓
输出成品视频到结果文件夹
```

### 1.3 关键约束

| 约束 | 说明 |
|------|------|
| 批次量 | 约 200 条/批 |
| 运行环境 | Windows 10/11，本地运行 |
| 网络依赖 | edge-tts 需联网；其余可离线 |
| 输出格式 | MP4（FFmpeg 直出）+ 剪映草稿（可选） |

---

## 2. 系统架构

### 2.1 设计原则

- **Python 做大脑，FFmpeg 做肌肉**：Python 负责编排/模板/调度，FFmpeg 负责所有视频处理，不在 Python 中操作视频帧
- **流式处理**：FFmpeg 原生流式，不将视频加载到内存，200 条批量处理内存可控
- **双输出通道**：FFmpeg 直出 MP4（全自动）+ 剪映草稿（可预览微调）
- **模板驱动**：用户通过 YAML 模板定义剪辑逻辑，不碰代码

### 2.2 五层架构

```
┌──────────────────────────────────────────────────────────────┐
│  Layer 0: 入口层                                              │
│  CLI 命令 / OpenClaw Skill 触发                               │
│  (argparse + OpenClaw SKILL.md)                               │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 1: 素材分析层                                          │
│  ffprobe → 视频元数据 (时长/分辨率/帧率/编码)                   │
│  Pillow  → 图片元数据 (尺寸/色调/方向)                         │
│  文件名/文件夹解析 → 用户命名约定提取语义                       │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 2: 内容生成层 (文案 + 配音)                              │
│  文案: Jinja2 模板渲染 / LLM API 生成                          │
│  配音: edge-tts → 同时输出 .mp3 + .srt                        │
│  (TTS 自带字幕时间戳, 无需 Whisper 后处理)                      │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 3: 模板编译层                                          │
│  YAML 模板 + 素材清单 + TTS 音频                               │
│       ↓                                                       │
│  路线A: FFmpeg filter_complex 命令生成 → 直出 MP4              │
│  路线B: draft_content.json 构造 → 剪映草稿                     │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
┌──────────────────────────────────────────────────────────────┐
│  Layer 4: 批量执行层                                          │
│  asyncio + Semaphore(N) → 并发控制                            │
│  subprocess → FFmpeg 子进程                                    │
│  进度追踪 (Rich) → 终端可视化                                  │
│  错误隔离 → 单条失败不影响批次                                  │
└──────────────────────────┬───────────────────────────────────┘
                           ▼
                    📂 输出文件夹 (成品视频)
```

### 2.3 数据流

```
输入文件夹                  模板库                  输出文件夹
  │                          │                        ▲
  │ 扫描                     │ 匹配                   │ 写入
  ▼                          ▼                        │
MediaAsset[] ──→ TemplateMatcher ──→ EditTask[] ──→ BatchProcessor
                                        │
                                        ├─→ TTSEngine (edge-tts)
                                        │     └─→ .mp3 + .srt
                                        │
                                        ├─→ CopyWriter (Jinja2)
                                        │     └─→ 文案文本
                                        │
                                        └─→ Renderer
                                              ├─→ FFmpegRenderer → .mp4
                                              └─→ DraftBuilder → draft_content.json
```

---

## 3. 模块详细设计

### 3.1 项目结构

```
📂 AI_clip/
├── design.md                         # 本设计文档
├── pyproject.toml                    # 依赖管理
├── README.md                         # 使用说明
├── config.yaml                       # 全局配置
│
├── cli.py                            # CLI 入口
│
├── engine/
│   ├── __init__.py
│   ├── scanner.py                    # 素材扫描 + ffprobe 元数据提取
│   ├── tts.py                        # edge-tts 封装
│   ├── copy_writer.py                # 文案生成 (Jinja2 / LLM)
│   ├── template_matcher.py           # 素材 → 模板匹配规则引擎
│   ├── template_extractor.py         # 从参考视频逆向提取模板
│   │
│   ├── ffmpeg_renderer.py            # FFmpeg 直出模式
│   ├── draft_builder.py              # 剪映草稿构造器
│   ├── draft_schema.py               # 剪映草稿数据结构定义
│   ├── draft_exporter.py             # 草稿写入剪映项目目录
│   │
│   └── batch.py                      # 批量并发调度
│
├── templates/                        # 剪辑模板库
│   ├── _global.yaml                  # 全局默认值
│   ├── _presets/
│   │   ├── subtitle_styles.yaml      # 字幕样式预设
│   │   ├── color_grades.yaml         # 调色预设
│   │   └── transitions.yaml          # 转场预设
│   ├── product_showcase.yaml         # 产品展示模板
│   ├── tutorial.yaml                 # 教程模板
│   ├── emotional_story.yaml          # 情感故事模板
│   └── default.yaml                  # 兜底默认模板
│
├── reference_videos/                 # 用户上传的参考视频
│   └── (用户放入抖音等参考视频)
│
├── assets/
│   ├── bgm/                          # 背景音乐库
│   ├── watermarks/                   # 水印素材
│   └── intros/                       # 片头片尾素材
│
└── skill/                            # OpenClaw Skill
    └── SKILL.md                      # Skill 指令文档
```

### 3.2 scanner.py — 素材扫描模块

**职责**: 扫描输入文件夹，提取所有媒体素材的元数据。

**核心数据结构**:

```python
@dataclass
class MediaAsset:
    path: Path                                    # 文件绝对路径
    type: Literal["video", "image", "audio"]      # 素材类型
    duration: float | None                        # 秒, 图片为 None
    width: int                                    # 像素宽度
    height: int                                   # 像素高度
    fps: float | None                             # 帧率, 图片为 None
    codec: str | None                             # 编码格式
    has_audio: bool                               # 是否包含音频轨道
    file_size: int                                # 文件大小 (bytes)
    aspect_ratio: Literal["portrait", "landscape", "square"]
```

**核心接口**:

```python
def scan_folder(input_dir: Path) -> list[MediaAsset]:
    """扫描文件夹, 返回所有媒体素材的元数据列表"""

def get_media_info(file_path: Path) -> MediaAsset:
    """使用 ffprobe 提取单个文件的元数据"""
```

**实现要点**:
- 使用 `ffprobe -v quiet -print_format json -show_format -show_streams` 提取元数据
- 支持的视频格式: `.mp4`, `.mov`, `.avi`, `.mkv`, `.webm`
- 支持的图片格式: `.jpg`, `.jpeg`, `.png`, `.webp`, `.bmp`
- 支持的音频格式: `.mp3`, `.wav`, `.aac`, `.m4a`
- 自动跳过非媒体文件, 不报错

### 3.3 tts.py — 配音引擎

**职责**: 将文案文本转换为语音音频 + SRT 字幕文件。

**核心数据结构**:

```python
@dataclass
class TTSResult:
    audio_path: Path      # 生成的 .mp3 文件路径
    srt_path: Path        # 生成的 .srt 文件路径 (带 word-level 时间戳)
    duration: float       # 音频总时长 (秒)
    text: str             # 原始文案文本
```

**核心接口**:

```python
async def generate_tts(
    text: str,
    voice: str = "zh-CN-XiaoxiaoNeural",
    rate: str = "+0%",
    output_dir: Path = Path("./temp"),
    filename_prefix: str = "tts",
) -> TTSResult:
    """生成 TTS 音频 + SRT 字幕"""

async def batch_generate_tts(
    texts: list[str],
    voice: str = "zh-CN-XiaoxiaoNeural",
    output_dir: Path = Path("./temp"),
    max_concurrent: int = 2,
) -> list[TTSResult]:
    """批量生成 TTS, 限制并发防限速"""
```

**实现要点**:
- edge-tts 一次调用同时输出 `.mp3` + `.srt`, 无需 Whisper
- 并发限制为 2, 避免被微软限速
- 加 retry + exponential backoff (3次重试, 2s/4s/8s间隔)
- SRT 时间戳与语音天然对齐, 是字幕同步的唯一来源

### 3.4 copy_writer.py — 文案生成模块

**职责**: 根据模板和变量生成视频文案。

**核心接口**:

```python
def render_copy(
    template: dict,            # 模板中的 copy 配置段
    variables: dict,           # 用户提供的变量 (product_name, feature 等)
) -> str:
    """使用 Jinja2 渲染文案模板, 返回完整文案文本"""

def pick_random_preset(
    presets: dict,             # 模板中的预设文案片段
    key: str,                  # 如 "headline", "cta"
) -> str:
    """从预设库中随机选取一条文案片段"""
```

**实现要点**:
- 使用 Jinja2 渲染, 支持 `{{ variable }}` 变量替换
- 预设片段库支持随机选取, 增加文案多样性
- 缺失变量时给出明确错误提示, 不静默跳过

### 3.5 template_matcher.py — 模板匹配引擎

**职责**: 根据素材特征自动选择最合适的模板。

**核心接口**:

```python
def match_template(
    asset: MediaAsset,
    templates: list[dict],
) -> tuple[dict, float]:
    """返回最佳匹配的模板及匹配分数"""

def match_batch(
    assets: list[MediaAsset],
    templates: list[dict],
) -> dict[Path, dict]:
    """批量匹配, 返回 {素材路径: 模板} 的映射"""
```

**匹配评分规则**:

| 规则 | 权重 | 说明 |
|------|------|------|
| 文件名关键词命中 | +30 | 文件名包含模板定义的关键词 |
| 文件夹名匹配 | +20 | 所在文件夹名匹配模板规则 |
| 宽高比匹配 | +20 | portrait / landscape / square |
| 时长范围匹配 | +10 | 素材时长在模板的 min/max 范围内 |
| priority 加权 | ×系数 | 模板自带的优先级权重 |

**兜底策略**: 当没有模板分数超过阈值 (默认 30) 时, 使用 `default.yaml`.

### 3.6 ffmpeg_renderer.py — FFmpeg 直出渲染器

**职责**: 将模板 + 素材 + TTS 编译为 FFmpeg 命令并执行, 直接输出 MP4。

**核心接口**:

```python
class FFmpegRenderer:
    def build_command(
        self,
        asset: MediaAsset,
        tts: TTSResult,
        bgm_path: Path | None,
        template: dict,
        output_path: Path,
    ) -> list[str]:
        """将模板参数编译为 FFmpeg 命令行参数列表"""

    async def render(self, command: list[str]) -> tuple[int, str]:
        """异步执行 FFmpeg 子进程, 返回 (exit_code, stderr)"""
```

**FFmpeg 核心能力使用**:

| 模板功能 | FFmpeg 实现方式 |
|---------|----------------|
| 视频缩放/裁剪 | `scale`, `crop`, `pad` 滤镜 |
| 图片转视频 | `loop=1` + `zoompan` (Ken Burns 效果) |
| 转场 (淡入淡出) | `fade=t=in:d=0.5`, `xfade` |
| 文字叠加 | `drawtext` 滤镜 |
| 字幕渲染 | `subtitles` 滤镜 (读取 SRT) |
| BGM 混音 | `amix` / `amerge` |
| BGM ducking | `sidechaincompress` 或音量关键帧 |
| 音频淡入淡出 | `afade` |
| 片段拼接 | `concat` demuxer 或 filter |
| 水印 | `overlay` 滤镜 |

**编码配置**:

```
视频编码: libx264, preset=fast, crf=23
音频编码: aac, 192kbps
容器格式: mp4, movflags=+faststart
硬件加速 (可选): -c:v h264_nvenc (需 NVIDIA GPU)
```

### 3.7 draft_builder.py — 剪映草稿构造器

**职责**: 构造剪映兼容的 `draft_content.json` 文件。

**核心接口**:

```python
class DraftBuilder:
    def __init__(self, name: str, width: int = 1080, height: int = 1920): ...

    def add_video(self, path: Path, start: float, duration: float,
                  volume: float = 1.0, transition: str | None = None): ...

    def add_image(self, path: Path, start: float, duration: float,
                  animation: str = "ken_burns"): ...

    def add_audio(self, path: Path, start: float, duration: float,
                  volume: float = 1.0, fade_in: float = 0, fade_out: float = 0): ...

    def add_text(self, content: str, start: float, duration: float,
                 font_size: int = 42, color: str = "#FFFFFF",
                 position: str = "bottom_third"): ...

    def add_srt_subtitles(self, srt_path: Path, style: dict): ...

    def set_bgm(self, path: Path, volume: float = 0.15): ...

    def build(self) -> dict:
        """输出完整的 draft_content.json 字典"""

    def save_to_jianying(self, jianying_drafts_dir: Path) -> Path:
        """保存到剪映的草稿目录, 返回项目路径"""
```

**实现要点**:
- 每个元素生成唯一 UUID
- 时间单位: 微秒 (1秒 = 1,000,000)
- materials 和 segments 通过 `material_id` 关联
- 需要先在剪映中创建示例项目, 导出 `draft_content.json` 分析字段结构
- 首个版本参考 `pyJianYingDraft` 的格式研究成果

### 3.8 template_extractor.py — 视频逆向模板提取

**职责**: 从用户上传的参考视频中逆向提取剪辑模板。

详见 [第5章: 视频逆向工程](#5-视频逆向工程模板提取)。

### 3.9 batch.py — 批量并发调度

**职责**: 管理 200 条视频的并发处理, 提供进度追踪和错误隔离。

**核心数据结构**:

```python
@dataclass
class EditTask:
    id: str
    asset: MediaAsset
    template: dict
    tts_result: TTSResult | None
    copy_text: str
    output_path: Path
    status: Literal["pending", "processing", "success", "failed", "skipped"]
    error: str | None = None

@dataclass
class BatchReport:
    total: int
    success: int
    failed: int
    skipped: int
    elapsed_seconds: float
    tasks: list[EditTask]
    output_dir: Path
```

**核心接口**:

```python
class BatchProcessor:
    def __init__(self, max_workers: int = 4): ...

    async def process_all(
        self,
        tasks: list[EditTask],
        output_mode: Literal["ffmpeg", "jianying", "both"] = "ffmpeg",
        progress_callback: Callable | None = None,
    ) -> BatchReport:
        """并发处理所有任务, 返回汇总报告"""
```

**并发策略**:
- FFmpeg 渲染: `asyncio.Semaphore(4)` (可配置)
- TTS 生成: `asyncio.Semaphore(2)` (防限速)
- 单条失败不影响其余任务
- 失败任务记录详细错误信息, 支持后续重试

**性能预估** (1080p 15s 短视频):

| 并发数 | 内存占用 | CPU 使用 | 200 条耗时 |
|--------|---------|---------|-----------|
| 2 | ~1 GB | ~50% | ~17 分钟 |
| 4 | ~2 GB | ~90% | ~8 分钟 |
| 4 (NVENC) | ~1.5 GB | ~40% | ~4 分钟 |

### 3.10 cli.py — CLI 入口

**命令设计**:

```bash
# 扫描素材文件夹, 预览信息 (不执行剪辑)
python cli.py scan --input "D:/素材/batch_001"

# 列出所有可用模板
python cli.py templates

# 从参考视频提取模板
python cli.py extract-template \
  --video "reference_videos/product_ref.mp4" \
  --name "product_v1"

# 批量剪辑 (FFmpeg 直出)
python cli.py process \
  --input "D:/素材/batch_001" \
  --output "D:/成品/batch_001" \
  --template product_showcase \
  --voice zh-CN-XiaoxiaoNeural \
  --workers 4

# 批量剪辑 (生成剪映草稿)
python cli.py process \
  --input "D:/素材/batch_001" \
  --output "D:/成品/batch_001" \
  --template product_showcase \
  --mode jianying

# 单条视频测试
python cli.py process \
  --input "D:/素材/test.mp4" \
  --output "D:/成品/test.mp4" \
  --template default
```

所有命令输出结构化 JSON (通过 `--json` 参数), 方便 OpenClaw 解析。

---

## 4. 模板系统

### 4.1 模板 YAML 完整格式定义

```yaml
# === 元信息 ===
meta:
  name: "产品展示"                     # 模板名称
  description: "适用于电商产品短视频"    # 模板描述
  version: "1.0"                       # 模板版本
  author: "wout"                       # 作者
  tags: ["电商", "产品", "竖屏"]        # 标签

# === 继承 ===
extends: _global                       # 继承自全局默认配置 (可选)

# === 画布 ===
canvas:
  width: 1080
  height: 1920
  fps: 30
  background: "#000000"

# === 时间线结构 ===
timeline:
  intro:                               # 片头段
    type: title_card                   # title_card / media_segment
    duration: 2.0
    background: "#1a1a2e"
    text: "{{ headline }}"
    text_style:
      font_size: 64
      color: "#FFD700"
      animation: fade_up               # fade_up / slide_in / zoom_in / none

  body:                                # 主体段
    type: media_sequence
    source: "$input_media"             # 引用输入素材
    duration: auto                     # auto = 跟随 TTS 时长
    fit_mode: cover_center             # cover_center / fit_contain / stretch
    transition:
      type: fade                       # fade / cut / dissolve / wipe
      duration: 0.5

  outro:                               # 片尾段
    type: title_card
    duration: 2.5
    text: "{{ cta }}"
    text_style:
      font_size: 48
      color: "#FFFFFF"
      animation: fade

# === 音频 ===
audio:
  voice:
    engine: edge-tts
    voice_id: zh-CN-XiaoxiaoNeural
    rate: "+0%"                        # 语速调节
    volume: 1.0
  bgm:
    file: "assets/bgm/upbeat_01.mp3"
    volume: 0.15
    ducking:
      enabled: true
      target_volume: 0.05             # TTS 播放时 BGM 压低到此音量
      fade_duration: 0.3              # 压低/恢复的渐变时间

# === 字幕 ===
subtitles:
  source: tts_srt                      # tts_srt = 使用 TTS 生成的 SRT
  style:
    font: "Microsoft YaHei"
    font_size: 42
    color: "#FFFFFF"
    outline_color: "#000000"
    outline_width: 2
    position: bottom_third
    max_chars_per_line: 16

# === 画面效果 ===
effects:
  color_grade: warm_boost              # 预设名或 none
  vignette: 0.3                        # 暗角强度 0-1

# === 水印 ===
watermark:
  image: "assets/watermarks/logo.png"
  position: bottom_right               # top_left / top_right / bottom_left / bottom_right / center
  opacity: 0.6
  size: 80                             # 像素高度, 宽度等比缩放

# === 文案 ===
copy:
  variables:
    - name: product_name
      required: true
      description: "产品名称"
    - name: product_feature
      required: true
      description: "核心卖点"
    - name: price
      required: false
      default: ""

  script_template: |
    {{ headline }}
    {{ product_name }}，{{ product_feature }}。
    {{ cta }}

  presets:
    headline:
      - "发现一款好物！"
      - "今天必须安利这个！"
      - "用了就回不去了！"
    cta:
      - "点击下方链接，get同款"
      - "评论区告诉我你想要什么颜色"
      - "限时优惠，手慢无"

# === 自动匹配规则 ===
match_rules:
  filename_contains: ["产品", "product", "商品", "goods"]
  folder_name: ["product", "电商"]
  aspect_ratio: portrait
  min_duration: 3
  max_duration: 120
  priority: 10
```

### 4.2 模板继承机制

**加载顺序**: `_global.yaml` → 当前模板 YAML → 运行时覆盖参数

```
_global.yaml (全局默认)
    │
    │  deep merge
    ▼
product_showcase.yaml (模板特有配置)
    │
    │  deep merge
    ▼
运行时参数 (OpenClaw 对话中用户指定的覆盖)
```

**合并规则**:
- 字典类型: 递归合并, 子模板的字段覆盖父模板的同名字段
- 列表类型: 子模板完全替换父模板的列表 (不追加)
- 标量类型: 子模板值覆盖父模板值

### 4.3 预设复用

可在模板中通过 `$preset:` 前缀引用预设:

```yaml
subtitles:
  style: $preset:subtitle_styles.bold_yellow
```

系统加载时自动从 `_presets/subtitle_styles.yaml` 中查找 `bold_yellow` 键并替换。

### 4.4 模板校验

在使用前自动校验:
- 必填字段完整性 (canvas, timeline)
- 值范围合法性 (fps ≤ 60, volume 0-1)
- 引用的素材文件存在性 (BGM, 水印)
- 文案变量一致性 (script_template 中引用的变量需在 variables 中定义)
- 预设引用有效性 (`$preset:xxx` 指向的预设需存在)

校验失败时输出具体错误信息, 拒绝执行。

### 4.5 三种模板创建方式

| 方式 | 适用场景 | MVP 是否支持 |
|------|---------|-------------|
| **手写 YAML** | 开发者/高级用户精确控制 | ✅ 支持 |
| **从参考视频逆向提取** | 用户上传抖音视频作参考 | ✅ 支持 (Level 1) |
| **AI 对话生成** | 用自然语言描述风格 | ❌ 后续版本 |

---

## 5. 视频逆向工程（模板提取）

### 5.1 核心原理

成品视频是「烘焙」过的渲染结果, 所有轨道/特效/文字已合并为单一像素流。逆向工程不是完美还原, 而是**提取可提取的结构信息, 生成近似模板**。

### 5.2 可提取信息分层

#### Level 1: 结构提取 (MVP)

| 提取内容 | 工具 | 精度 |
|---------|------|------|
| 场景切点 | PySceneDetect | ~95% |
| 每段时长/节奏 | 由切点计算 | ~95% |
| 转场类型 (硬切/淡入淡出) | PySceneDetect | ~80% |
| 总时长/分辨率/帧率 | ffprobe | 100% |
| 是否有人声 | 音频 RMS 分析 | ~90% |
| 是否有 BGM | 音频频谱分析 | ~85% |
| 人声与 BGM 音量比 | Demucs 音源分离 → RMS | ~85% |
| 配音文字内容 | Whisper 语音识别 | ~90% |

**开发时间**: 3-5 天

#### Level 2: 视觉风格提取 (V2)

| 提取内容 | 工具 | 精度 |
|---------|------|------|
| 色调/色温/饱和度 | 关键帧 HSV 直方图 | ~80% |
| 字幕位置区域 | OCR 文字区域检测 | ~75% |
| 字幕颜色/大致字号 | 像素采样 + 区域尺寸 | ~65% |
| 画面运动量 | 帧间光流分析 | ~70% |
| 主色调 | 颜色聚类 (K-Means) | ~80% |

**开发时间**: 1-2 周

#### Level 3: AI 语义理解 (V3)

| 提取内容 | 工具 | 精度 |
|---------|------|------|
| 内容类型 (产品/教程/情感) | LLM Vision | ~80% |
| 目标受众 | LLM Vision | ~70% |
| 编辑风格描述 | LLM Vision | ~75% |
| 推荐配音风格 | LLM 综合分析 | ~70% |
| 推荐 BGM 类型 | LLM 综合分析 | ~70% |

**开发时间**: 2-4 周

### 5.3 不可提取信息 (硬限制)

以下信息在视频渲染时永久丢失, 任何技术手段都无法还原:
- 具体滤镜名称和参数值
- 具体特效名称
- 字体名称 (只能推测类别: 黑体/宋体/手写体)
- 关键帧动画曲线和参数
- 原始多轨道分层结构

### 5.4 逆向提取流程 (Level 1)

```
📹 参考视频输入
│
├─ ffprobe ──────────────→ 基础元数据
│                           {width, height, fps, duration, has_audio}
│
├─ PySceneDetect ────────→ 场景切点列表
│                           [0, 2.1, 5.3, 9.8, 14.2, 16.0, 18.5]
│                           转场类型: [cut, cut, fade, cut, fade, cut]
│
├─ Demucs ───────────────→ 音源分离
│   ├─ voice.wav              人声轨道
│   └─ accompaniment.wav      BGM 轨道
│
├─ 音频分析 ─────────────→ 音频特征
│   ├─ voice RMS: -12dB       人声音量
│   ├─ bgm RMS: -24dB         BGM 音量
│   ├─ voice_ratio: 0.77      人声覆盖时长比
│   └─ bgm_volume: ~0.15      BGM 相对音量 (归一化)
│
├─ Whisper ──────────────→ 配音文字 + 时间戳
│                           用于分析文案结构和节奏
│
└─ 汇总输出 ─────────────→ extracted_template.yaml
```

### 5.5 提取结果模板格式

```yaml
meta:
  name: "从 product_ref.mp4 提取"
  source_video: "reference_videos/product_ref.mp4"
  extracted_at: "2026-04-05T14:30:00"
  extraction_level: 1
  confidence: 0.85

canvas:
  width: 1080
  height: 1920
  fps: 30

structure:
  total_duration: 18.5
  segment_count: 6
  average_segment_duration: 3.08
  pacing: medium_fast                  # slow (<5s) / medium (3-5s) / fast (<3s)
  segments:
    - { index: 1, duration: 2.1, transition_in: null,  role: intro }
    - { index: 2, duration: 3.2, transition_in: cut,   role: body }
    - { index: 3, duration: 4.5, transition_in: cut,   role: body }
    - { index: 4, duration: 4.4, transition_in: fade,  role: body }
    - { index: 5, duration: 1.8, transition_in: cut,   role: outro }
    - { index: 6, duration: 2.5, transition_in: fade,  role: cta }

audio:
  has_voice: true
  has_bgm: true
  voice_coverage: 0.77
  voice_to_bgm_ratio: 5.0
  bgm_volume_estimate: 0.15
  bgm_tempo_estimate: "upbeat"

transcription:
  text: "这款手机壳太绝了..."
  word_count: 42
  speaking_rate: "medium"              # 字/秒

# --- 以下字段需要用户确认或补充 ---
needs_user_input:
  - field: "subtitles.style.font"
    suggestion: "Microsoft YaHei"
    reason: "无法从视频中确定具体字体"
  - field: "effects.color_grade"
    suggestion: "warm_boost"
    reason: "检测到暖色调倾向, 请确认预设"
  - field: "audio.voice.voice_id"
    suggestion: "zh-CN-XiaoxiaoNeural"
    reason: "检测到年轻女声, 建议使用小晓"
```

### 5.6 template_extractor.py 核心接口

```python
class TemplateExtractor:
    def __init__(self, level: int = 1): ...

    async def extract(self, video_path: Path, output_name: str) -> dict:
        """
        从参考视频提取模板, 返回模板字典.
        level=1: 结构 + 音频
        level=2: + 视觉风格 (需 OpenCV)
        level=3: + AI 语义 (需 LLM API)
        """

    def _detect_scenes(self, video_path: Path) -> list[SceneCut]: ...
    def _analyze_audio(self, video_path: Path) -> AudioAnalysis: ...
    def _separate_audio(self, video_path: Path) -> tuple[Path, Path]: ...
    def _transcribe(self, voice_path: Path) -> TranscriptionResult: ...
    def _infer_segment_roles(self, segments: list, transcription: ...) -> list: ...
```

---

## 6. 素材自动匹配

### 6.1 匹配策略分层

#### Level 1: 规则引擎 (MVP)

基于素材元数据和文件信息进行匹配:

```python
def calculate_match_score(asset: MediaAsset, template: dict) -> float:
    score = 0.0
    rules = template.get("match_rules", {})

    # 文件名关键词
    for kw in rules.get("filename_contains", []):
        if kw.lower() in asset.path.stem.lower():
            score += 30
            break

    # 文件夹名
    if asset.path.parent.name in rules.get("folder_name", []):
        score += 20

    # 宽高比
    if rules.get("aspect_ratio") == asset.aspect_ratio:
        score += 20

    # 时长范围
    if asset.duration:
        min_d = rules.get("min_duration", 0)
        max_d = rules.get("max_duration", float("inf"))
        if min_d <= asset.duration <= max_d:
            score += 10

    # 优先级加权
    score *= (1 + rules.get("priority", 0) / 100)

    return score
```

#### Level 2: 视觉特征对比 (V2)

对素材做颜色/运动分析, 与模板的 `visual_style` 字段对比。

#### Level 3: AI 语义匹配 (V3)

LLM Vision 分析素材内容, 与模板的 `ai_analysis` 字段语义匹配。仅对规则引擎无法判断的素材触发, 控制 API 成本。

### 6.2 匹配流程

```
200 个素材
    ↓
规则引擎打分 (全部素材)
    ├─ 分数 > 阈值 → 直接使用匹配到的模板
    └─ 分数 ≤ 阈值 → 标记为「未匹配」
          ↓
  (V2+) 视觉特征对比
          ↓
  (V3+) AI 语义匹配
          ↓
  仍无匹配 → 使用 default.yaml
```

---

## 7. 交付形态与 OpenClaw 集成

### 7.1 整体交付结构

```
📂 AI_clip/                          ← 独立 Python 项目 (核心引擎)
│   全部视频处理逻辑
│   CLI 接口
│
📂 .cursor/skills/video-batch-editor/ ← OpenClaw Skill (薄壳)
│   SKILL.md                          ← 指令文档
│   scripts/
│       └── bridge.py                 ← 桥接脚本 (可选)
```

### 7.2 职责分离

| 层次 | 组件 | 职责 |
|------|------|------|
| 用户层 | 自然语言对话 | "帮我剪辑视频" |
| Skill 层 | SKILL.md (~200行) | 理解意图 → 构建 CLI 命令 → 解读结果 |
| CLI 层 | cli.py | 参数校验 → 调用引擎 → 输出 JSON |
| 引擎层 | engine/*.py | 扫描 → 分析 → TTS → 编译 → 渲染 |
| FFmpeg 层 | 系统安装 | 实际的视频处理 |

### 7.3 SKILL.md 核心内容

```yaml
---
name: video-batch-editor
description: >
  批量视频剪辑自动化工具. 扫描输入文件夹, 根据模板自动执行
  视频剪辑/文案生成/TTS配音/字幕渲染, 输出成品视频.
  触发词: 剪辑视频, 批量剪视频, 处理素材, 视频剪辑, 做视频
---
```

Skill 指导 OpenClaw:

1. **收集参数**: 输入路径 (必填), 输出路径, 模板名, 配音语音, 并发数
2. **构建命令**: 映射到 `python cli.py process --xxx`
3. **执行并监控**: 运行命令, 解读 JSON 进度输出
4. **汇报结果**: 翻译 `BatchReport` 为用户友好的中文汇报

### 7.4 OpenClaw 对话交互示例

```
👤 用户: 帮我把 D:/素材/batch_001 里的视频剪辑一下，用产品展示模板

🤖 OpenClaw:
   好的，我来处理。先扫描一下文件夹...

   📊 扫描结果:
   - 视频: 23 个 (总时长 12分34秒)
   - 图片: 5 张
   - 总素材: 28 条
   - 使用模板: product_showcase
   - 配音语音: zh-CN-XiaoxiaoNeural (小晓)
   - 预计耗时: 约 3 分钟

   开始执行？

👤 用户: 开始吧

🤖 OpenClaw: [执行 python cli.py process ...]

   ✅ 批量剪辑完成！
   - 成功: 26/28 条
   - 失败: 2 条
   - 输出目录: D:/成品/batch_001/
   - 总耗时: 2分47秒

   失败的两条:
   1. clip_017.mp4 — 时长仅 1.2 秒，低于模板最低要求 3 秒
   2. img_05.jpg — 分辨率 320×240，低于最低要求 720p

   需要对这两条做特殊处理吗？
```

---

## 8. 技术选型与依赖

### 8.1 Python 依赖

```
# --- 核心 (MVP 必须) ---
edge-tts>=6.1              # TTS 配音 + SRT 字幕生成
Pillow>=10.0               # 图片元数据分析
PyYAML>=6.0                # 模板解析
Jinja2>=3.1                # 文案模板渲染
rich>=13.0                 # CLI 进度条和格式化输出

# --- 模板提取 (MVP 需要) ---
scenedetect>=0.6           # PySceneDetect 场景检测
demucs>=4.0                # 音源分离 (人声/BGM 拆分)
openai-whisper>=20231117   # 语音识别 (字幕提取)

# --- 剪映草稿 (可选, MVP 如需剪映输出) ---
pyJianYingDraft>=0.2.6     # 剪映草稿格式支持 (加速开发, 可后续替换)

# --- 进阶 (V2+) ---
opencv-python>=4.8         # 视觉分析 (色调/运动检测/OCR辅助)
paddleocr>=2.7             # OCR 文字检测 (字幕位置分析)
```

### 8.2 系统级依赖

```
FFmpeg >= 6.0              # 视频处理核心, 需加入 PATH
Python >= 3.10             # 运行环境
剪映 (可选)                 # 仅当需要打开/导出草稿时
NVIDIA GPU (可选)           # NVENC 硬件加速编码
```

### 8.3 各组件职责速查

| 组件 | 用在哪里 | 是否可替换 |
|------|---------|-----------|
| FFmpeg / ffprobe | 视频渲染、元数据提取 | 不可替换 (行业标准) |
| edge-tts | TTS 配音 + SRT 生成 | 可替换为其他 TTS (如 MiniMax) |
| PySceneDetect | 参考视频场景检测 | 可替换为自写帧差分析 |
| Demucs | 参考视频音源分离 | 可替换为 Spleeter |
| Whisper | 参考视频语音转文字 | 可替换为其他 STT |
| Jinja2 | 文案模板渲染 | 不建议替换 (轻量标准) |
| PyYAML | 模板文件解析 | 可替换为 TOML |
| Rich | 终端进度条 | 可替换为 tqdm |
| Pillow | 图片分析 | 不可替换 (基础库) |
| pyJianYingDraft | 剪映草稿生成 | 可后续替换为自写实现 |

---

## 9. 分阶段实施计划

### Phase 1: 核心管线 — 单条跑通 (5-7 天)

**目标**: 一条视频从输入到输出的完整流程。

| 任务 | 交付物 | 天数 |
|------|--------|------|
| 项目骨架搭建 | pyproject.toml, 目录结构 | 0.5 |
| scanner.py | 素材扫描 + ffprobe 元数据 | 1 |
| tts.py | edge-tts 配音 + SRT 生成 | 1 |
| copy_writer.py | Jinja2 文案渲染 | 0.5 |
| ffmpeg_renderer.py | FFmpeg 命令生成 + 执行 | 2 |
| 手写 default.yaml 模板 | 一个可用的默认模板 | 0.5 |
| 端到端验证 | 单条视频跑通全流程 | 1 |

**Phase 1 完成标准**: `python cli.py process --input test.mp4 --output out.mp4 --template default` 能输出一个带配音、字幕、BGM 的成品视频。

### Phase 2: 模板系统 + 批量引擎 (5-7 天)

**目标**: 多模板 + 200 条批量处理。

| 任务 | 交付物 | 天数 |
|------|--------|------|
| 模板加载器 (继承/预设/校验) | template_loader.py | 1.5 |
| template_matcher.py | 规则引擎匹配 (Level 1) | 1 |
| batch.py | asyncio 并发调度 | 1.5 |
| CLI 完整实现 | scan / templates / process 命令 | 1 |
| 编写 2-3 个预设模板 | product_showcase, tutorial, default | 0.5 |
| 200 条压测 + 性能调优 | 压测报告 | 1 |

**Phase 2 完成标准**: 200 条素材批量处理完成, 10 分钟以内, 成功率 > 95%。

### Phase 3: 视频逆向提取 (5-7 天)

**目标**: 用户上传参考视频, 自动生成模板。

| 任务 | 交付物 | 天数 |
|------|--------|------|
| PySceneDetect 集成 | 场景检测 + 切点分析 | 1 |
| Demucs 集成 | 音源分离 (人声/BGM) | 1.5 |
| Whisper 集成 | 语音转文字 | 1 |
| 音频分析 (RMS/频谱) | 音量比、节奏分析 | 0.5 |
| template_extractor.py | 汇总输出模板 YAML | 1.5 |
| extract-template CLI 命令 | 用户可用的提取命令 | 0.5 |

**Phase 3 完成标准**: `python cli.py extract-template --video ref.mp4 --name my_style` 输出一个可直接使用的模板 YAML。

### Phase 4: OpenClaw Skill + 剪映草稿 (3-5 天)

**目标**: 封装为 OpenClaw Skill, 支持剪映草稿输出。

| 任务 | 交付物 | 天数 |
|------|--------|------|
| SKILL.md 编写 | OpenClaw 指令文档 | 1 |
| draft_builder.py | 剪映草稿构造器 | 1.5 |
| draft_exporter.py | 草稿写入剪映目录 | 0.5 |
| 端到端验证 | OpenClaw 对话驱动全流程 | 1 |

**Phase 4 完成标准**: 通过 OpenClaw 对话, 完成从素材到成品的全流程。

### 后续版本规划

| 版本 | 功能 | 预估时间 |
|------|------|---------|
| V2 | 视觉风格提取 (Level 2) + 视觉匹配 (Level 2) | 2-3 周 |
| V3 | AI 语义理解 (Level 3) + AI 匹配 (Level 3) | 2-3 周 |
| V4 | AI 对话生成模板 + 文案 AI 润色 | 1-2 周 |
| V5 | 图片素材深度支持 (轮播/Ken Burns/混合剪辑) | 1-2 周 |

---

## 10. 风险评估与应对

### 10.1 技术风险

| 风险 | 严重度 | 概率 | 应对策略 |
|------|-------|------|---------|
| FFmpeg filter_complex 复杂度 | 高 | 高 | 从简单滤镜开始, 逐步增加; 封装好模板编译器 |
| edge-tts 并发限速 | 中 | 中 | 限制 TTS 并发为 2; retry + backoff |
| Demucs 模型下载慢 | 低 | 中 | 首次运行提前下载; 提供离线安装说明 |
| 剪映版本更新导致草稿格式变化 | 中 | 中 | pyJianYingDraft 库维护者跟进; 备选 FFmpeg 直出 |
| 音视频时长对齐 | 高 | 高 | 音频时长驱动视频时长; 不足则冻结末帧/循环 |
| Windows 路径编码问题 | 低 | 中 | 全部使用 pathlib; FFmpeg 参数用双引号包裹 |

### 10.2 性能风险

| 风险 | 说明 | 应对策略 |
|------|------|---------|
| 200 条 TTS 生成耗时 | 串行约 10 分钟 | 2 并发降至 ~5 分钟; TTS 和渲染流水线并行 |
| 大文件内存不足 | 4K 视频 FFmpeg 缓冲区 | 使用流式处理, 不加载整个视频 |
| Demucs 模型无 GPU | CPU 模式约 1-2 分钟/条 | 仅对参考视频使用 (数量少); 非批量瓶颈 |
| Whisper 模型无 GPU | CPU 模式约 2-5 分钟/条 | 同上, 仅用于参考视频; 可选 tiny/base 模型加速 |

### 10.3 产品风险

| 风险 | 说明 | 应对策略 |
|------|------|---------|
| 模板表达力不足 | YAML 无法描述复杂剪辑逻辑 | MVP 聚焦常见短视频格式; 复杂需求引导用户用剪映微调 |
| 成品质量达不到预期 | 自动化 ≠ 高质量 | 提供剪映草稿输出, 允许人工微调 |
| 参考视频逆向精度有限 | 只能还原 70-80% | 明确告知用户哪些需要手动补充; 提供预设选项 |

---

## 11. 附录

### 11.1 剪映草稿目录位置

```
Windows: %LOCALAPPDATA%\JianyingPro\User Data\Projects\com.lveditor.draft\
```

每个项目是一个 UUID 文件夹, 内含:
- `draft_content.json` — 核心草稿文件
- `draft_meta_info.json` — 项目元信息
- `draft_materials/` — 缓存的素材缩略图

### 11.2 FFmpeg 常用 filter_complex 参考

```bash
# 视频缩放填充 (竖屏 cover)
scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920

# 图片转视频 (Ken Burns 缩放效果, 5秒)
zoompan=z='min(zoom+0.0015,1.5)':d=150:s=1080x1920:fps=30

# 淡入淡出
fade=t=in:st=0:d=0.5,fade=t=out:st=4.5:d=0.5

# 字幕渲染
subtitles=output.srt:force_style='FontName=Microsoft YaHei,FontSize=42,PrimaryColour=&HFFFFFF'

# BGM ducking (配音播放时 BGM 压低)
[bgm]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[ducked_bgm]

# 水印叠加
overlay=W-w-20:H-h-20:format=auto,colorchannelmixer=aa=0.6
```

### 11.3 edge-tts 可用中文语音列表 (常用)

| voice_id | 描述 | 适合场景 |
|----------|------|---------|
| zh-CN-XiaoxiaoNeural | 年轻女声, 活泼 | 产品推荐, 日常 |
| zh-CN-YunxiNeural | 年轻男声, 阳光 | 教程, 解说 |
| zh-CN-YunjianNeural | 成熟男声, 沉稳 | 新闻, 纪录片 |
| zh-CN-XiaoyiNeural | 温柔女声 | 情感, 故事 |
| zh-CN-YunyangNeural | 新闻播报男声 | 正式场合 |

### 11.4 术语表

| 术语 | 说明 |
|------|------|
| 素材 (Asset) | 用户输入的原始视频/图片/音频文件 |
| 模板 (Template) | YAML 文件, 定义剪辑参数和规则 |
| 草稿 (Draft) | 剪映可打开的项目文件 |
| 参考视频 (Reference) | 用户上传的示范视频, 用于逆向提取模板 |
| TTS | Text-to-Speech, 文字转语音 |
| SRT | SubRip 字幕格式, 含时间戳和文本 |
| filter_complex | FFmpeg 的滤镜图命令, 用于复杂视频处理 |
| ducking | 音频闪避, TTS 播放时自动降低 BGM 音量 |
