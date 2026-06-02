# ClipCraft

**模板驱动的自动化视频剪辑工作台** —— 上传素材、选择模板、一键生成带配音、字幕、运镜与 BGM 的成品短视频。

ClipCraft 遵循「**Python 做大脑，FFmpeg 做肌肉**」：Python 负责编排、模板与调度，FFmpeg 负责全部视频处理。提供 **Web 工作台** 与 **CLI** 两种入口，共享同一套 `engine/` 核心引擎。

| 入口 | 适用场景 |
|------|---------|
| **Web 工作台** | 单条视频可视化剪辑：上传 → 配置 → 实时进度 → 预览下载 |
| **CLI** | 脚本化、批量处理（文件夹级）、自动化与后续 Skill 封装 |

---

## 功能特性

### Cinematic 视频引擎
- **自适应慢放 + 回弹填充**：按文案时长自动变速；时长不足时末段反向播放并经 crossfade 衔接，避免冻结帧。
- **复合 Ken Burns 运镜**：多频 sin/cos 叠加的缓慢漂移裁剪。
- **节奏明暗脉冲**：中段呼吸感明暗变化；片头/片尾淡入淡出由模板控制。

### 双层 ASS 字幕
- SRT → ASS：磨砂底条 + 锐利文字层；智能折行、逐行淡入淡出；样式与安全区由 YAML 配置。

### TTS 配音与 BGM
- **edge-tts**：同步输出 `.mp3` 与 `.srt`；多音色、语速可调。
- **侧链 ducking**：配音响起时自动压低 BGM。

### 模板系统
- YAML 定义剪辑逻辑；`extends` 继承、`$preset:` 预设、启动前校验。
- **智能匹配**：按文件名、文件夹、宽高比、时长评分，自动选模板（CLI 批量场景）。

### 批量与并发（CLI / 引擎）
- asyncio + Semaphore；TTS 与渲染分路限流；单条失败不影响整批。

### 内置模板

| 模板 | 适用场景 |
|------|---------|
| `barbershop` | 理发店 / 发型推荐（cinematic + 叙事文案，最完善） |
| `product_showcase` | 电商产品展示 |
| `tutorial` | 知识教程 |
| `emotional_story` | 情感故事 |
| `default` | 通用兜底 |

---

## 系统要求

| 依赖 | 说明 |
|------|------|
| **Python ≥ 3.10** | 后端与引擎 |
| **Node.js ≥ 18** | 仅构建 Web 前端时需要 |
| **网络** | edge-tts 配音需联网；首次自带 FFmpeg 时需联网下载静态二进制 |

**FFmpeg 无需用户手动安装**：启动时 `engine/ffmpeg_runtime.py` 会检测系统 PATH；若未安装，则通过 `static-ffmpeg` 自动拉取当前平台（macOS / Windows / Linux，含 arm64）的 `ffmpeg` / `ffprobe` 并注入进程环境，之后本地缓存复用。

---

## 快速开始

### 安装

```bash
make install          # uv 创建 venv + pip install -e . ；npm install（web/）
```

未安装 `make` 时：

```bash
pip install -e .
cd web && npm install && cd ..
```

### Web 工作台（推荐）

```bash
make serve            # npm run build + 启动 http://127.0.0.1:8000
```

浏览器打开 **http://127.0.0.1:8000**。顶栏显示 **FFmpeg 已就绪** 即表示渲染环境可用。

**开发模式**（前端热更新 + 后端热重载）：

```bash
make dev
# 后端 http://127.0.0.1:8000 ；前端 http://127.0.0.1:5173（/api 代理到后端）
```

等价命令：

```bash
clipcraft serve --port 8000
# 或
python -m server
```

### CLI

```bash
# 扫描文件夹或单个文件
clipcraft scan --input "/path/to/素材" --detail

# 列出模板
clipcraft templates

# 批量剪辑（文件夹 / 单文件）
clipcraft process \
  --input "/path/to/素材" \
  --output "/path/to/成品" \
  --template barbershop \
  --vars "shop_name=锦瑟造型" "shop_location=杭州西湖区文三路88号" \
  --workers 4
```

---

## Web 工作台使用说明

采用**单页布局**：左侧配置、右侧预览与生成，一屏完成全流程。

1. **上传视频**：拖拽或选择单个视频（mp4 / mov / avi / mkv / webm），右侧即时预览。
2. **选择模板**：卡片式模板库（含「智能匹配」）；选中后展示该模板的文案变量。
3. **配音与文案**：音色、语速（滑块）、变量填写。
4. **生成与下载**：点击「生成视频」；右侧 Steps 展示上传 → 解析 → 配音渲染 → 完成，WebSocket 实时更新；完成后内嵌播放并下载成品。

> Web 端当前为**单视频**工作流；文件夹级批量请使用 CLI `process`。

---

## 系统架构

```
┌─ Web（React + Ant Design）
│      │  HTTP  /api/*  ·  WebSocket /api/jobs/{id}/ws
│      ▼
│   FastAPI（server/）──────┐
│      │ JobManager        │  ensure_ffmpeg() 启动时自 provision
└─ CLI（cli.py）───────────┤
                           ▼
                    engine/  扫描 · 文案 · TTS · 匹配 · 渲染 · 调度
                           ▼
                    FFmpeg / ffprobe（系统或 bundled）
```

| 层 | 技术 | 职责 |
|----|------|------|
| 前端 | React 19 · Vite · TypeScript · Ant Design | 单页工作台；上传、模板选择、配置表单、预览与进度 |
| 服务端 | FastAPI · Uvicorn · WebSocket | REST、`/upload`、任务调度、静态托管 `web/dist` |
| 引擎 | Python · edge-tts · Jinja2 · PyYAML | 元数据、文案、TTS、模板匹配、FFmpeg 命令编译、并发 |
| 运行时 | static-ffmpeg（可选 bundled） | 无系统 FFmpeg 时自动提供二进制 |

### 单条视频数据流（Web）

```
上传 POST /api/upload → 保存 uploads/ + ffprobe 元数据
        ↓
POST /api/jobs → JobManager：文案(Jinja2) + TTS(edge-tts) + FFmpegRenderer
        ↓
output/<时间戳>/*.mp4  ←  WebSocket 推送 task_update / job_completed
```

### 项目结构

```
ClipCraft/
├── engine/
│   ├── scanner.py              # ffprobe / Pillow 元数据
│   ├── ffmpeg_runtime.py       # FFmpeg 自 provision（系统 / bundled）
│   ├── tts.py                  # edge-tts + SRT
│   ├── copy_writer.py          # Jinja2 文案
│   ├── template_loader.py      # YAML 继承 / 预设 / 校验
│   ├── template_matcher.py     # 评分匹配
│   ├── ffmpeg_renderer.py      # filter_complex 渲染（cinematic / ASS 等）
│   └── batch.py                # 批量并发
├── server/
│   ├── app.py                  # REST + WS + SPA 托管
│   ├── jobs.py                 # 异步任务与进度事件
│   └── voices.py               # TTS 音色目录
├── web/                        # 前端（构建产物 web/dist）
│   └── src/
│       ├── App.tsx
│       ├── api/client.ts
│       ├── hooks/useJobStream.ts
│       └── components/         # TemplatePicker · RunPanel
├── templates/                  # YAML 模板库
├── uploads/                    # Web 上传暂存（gitignore）
├── output/                     # 默认成品输出目录（gitignore）
├── cli.py                      # scan · templates · process · serve
├── config.yaml
├── Makefile
└── pyproject.toml
```

---

## 配置

编辑 `config.yaml`：

| 配置段 | 说明 |
|--------|------|
| `ffmpeg` | 编码器、`crf`、`preset`、可选 `hardware_accel` |
| `tts` | 默认音色、语速、`max_concurrent` |
| `batch` | `max_workers`、模板匹配阈值 `match_threshold` |
| `output` | 默认输出模式（`ffmpeg` / 未来剪映草稿） |

---

## API 概览

前缀 **`/api`**：

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 健康检查 |
| GET | `/config` | 默认参数、`ffmpeg_available`、`ffmpeg_source`（`system` / `bundled`） |
| GET | `/voices` | 配音音色列表 |
| GET | `/templates` · `/templates/{name}` | 模板列表与详情（含文案变量） |
| POST | `/upload` | 上传单个视频，返回路径与 `asset` 元数据 |
| POST | `/scan` | 扫描本机路径（文件夹或文件） |
| POST | `/jobs` | 创建剪辑任务 |
| GET | `/jobs` · `/jobs/{id}` | 任务列表与状态 |
| WS | `/jobs/{id}/ws` | 实时进度（`snapshot` · `task_update` · `job_completed`） |
| GET | `/jobs/{id}/files/{name}` | 下载 / 流式播放成品 |
| GET | `/file?path=...` | 预览已上传的本地素材 |

---

## 开发计划

### 近期
- [ ] 参考视频逆向提取模板（场景切点、节奏、转场、语音转写）
- [ ] LLM 智能文案生成与润色
- [ ] 剪映草稿导出（`draft_content.json`）
- [ ] Web 端多视频 / 批量上传与任务列表

### 中期
- [ ] 多段素材编排（A-roll / B-roll）、多模板串联
- [ ] GPU 编码（NVENC / VideoToolbox / QSV）
- [ ] 渲染队列持久化、历史任务

### 长期
- [ ] 素材库与标签
- [ ] 同素材多版本 A/B
- [ ] OpenClaw / Agent Skill 封装
- [ ] 插件化特效与配音引擎

---

## 许可证与说明

本项目为本地优先工具：素材与成品默认落在 `uploads/`、`output/`，不上传云端。部署生产环境时请自行配置访问控制与磁盘清理策略。
