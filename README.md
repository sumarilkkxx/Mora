# AI_clip — 自动化批量视频剪辑系统

自动化批量视频剪辑系统，实现「素材输入 → 自动剪辑 → 成品输出」全流程自动化。

## 系统要求

- Python >= 3.10
- FFmpeg >= 6.0（需加入系统 PATH）
- Windows 10/11
- 网络连接（edge-tts 需联网）

## 快速开始

### 1. 安装依赖

```bash
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

### 4. 批量剪辑（FFmpeg 直出）

```bash
python cli.py process \
  --input "D:/素材/batch_001" \
  --output "D:/成品/batch_001" \
  --template default \
  --voice zh-CN-XiaoxiaoNeural \
  --workers 4
```

### 5. 单条视频测试

```bash
python cli.py process \
  --input "D:/素材/test.mp4" \
  --output "D:/成品/" \
  --template default
```

### 6. 指定文案变量

```bash
python cli.py process \
  --input "D:/素材/" \
  --output "D:/成品/" \
  --template product_showcase \
  --vars "product_name=超级手机壳" "product_feature=防摔又好看"
```

## 内置模板

| 模板名 | 适用场景 | 配音语音 |
|--------|---------|---------|
| `default` | 通用短视频 | 小晓（女声） |
| `product_showcase` | 电商产品展示 | 小晓（女声） |
| `tutorial` | 知识教程 | 云希（男声） |
| `emotional_story` | 情感故事 | 小艺（温柔女声） |

## 项目结构

```
AI_clip/
├── cli.py                # CLI 入口
├── config.yaml           # 全局配置
├── engine/               # 核心引擎
│   ├── scanner.py        # 素材扫描 + 元数据提取
│   ├── tts.py            # TTS 配音 + 字幕生成
│   ├── copy_writer.py    # 文案模板渲染
│   ├── ffmpeg_renderer.py # FFmpeg 渲染器
│   ├── template_loader.py # 模板加载器
│   ├── template_matcher.py # 模板匹配引擎
│   └── batch.py          # 批量调度
├── templates/            # 剪辑模板库
│   ├── _global.yaml      # 全局默认值
│   ├── _presets/         # 预设库
│   ├── default.yaml      # 默认模板
│   ├── product_showcase.yaml
│   ├── tutorial.yaml
│   └── emotional_story.yaml
└── assets/               # 素材资源
    ├── bgm/              # 背景音乐
    └── watermarks/       # 水印
```

## CLI 命令参考

### scan — 扫描素材

```
python cli.py scan --input <路径> [--detail] [--json]
```

### templates — 列出模板

```
python cli.py templates [--json]
```

### process — 批量剪辑

```
python cli.py process --input <路径> --output <路径> [选项]

选项:
  --template, -t    指定模板名称（不指定则自动匹配）
  --voice           TTS 语音 ID
  --rate            TTS 语速（如 "+10%", "-5%"）
  --workers, -w     FFmpeg 并发数（默认 4）
  --vars            文案变量（格式: key=value）
  --json            输出结构化 JSON
```

## 配置说明

编辑 `config.yaml` 调整全局参数：

- **ffmpeg**: 编码参数（codec, crf, preset）
- **tts**: 默认语音、并发限制、重试策略
- **batch**: 最大并发数、匹配阈值

## 自定义模板

在 `templates/` 目录创建 YAML 文件即可。模板支持：

- **继承**: `extends: _global` 继承全局配置
- **预设引用**: `$preset:subtitle_styles.bold_yellow`
- **文案变量**: Jinja2 模板语法 `{{ variable }}`
- **自动匹配规则**: 文件名/文件夹名关键词匹配

详见 `design.md` 第 4 章。
