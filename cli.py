"""ClipCraft CLI 入口 — 素材扫描、模板管理、批量剪辑、启动 Web 工作台。"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

import yaml
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
from rich.table import Table

from engine.ffmpeg_runtime import ensure_ffmpeg
from engine.scanner import scan_folder, MediaAsset
from engine.template_loader import load_all_templates, load_template, validate_template
from engine.template_matcher import match_batch
from engine.batch import create_tasks, BatchProcessor, EditTask

console = Console()


def _load_config() -> dict:
    config_path = Path(__file__).parent / "config.yaml"
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


# ---- scan 命令 ----

def cmd_scan(args: argparse.Namespace) -> None:
    """扫描素材文件夹，预览信息。"""
    ensure_ffmpeg()
    input_path = Path(args.input)
    console.print(f"[bold blue]扫描素材:[/] {input_path}")

    assets = scan_folder(input_path)
    if not assets:
        console.print("[yellow]未找到任何媒体素材[/]")
        return

    videos = [a for a in assets if a.type == "video"]
    images = [a for a in assets if a.type == "image"]
    audios = [a for a in assets if a.type == "audio"]

    total_duration = sum(a.duration or 0 for a in assets)
    total_size = sum(a.file_size for a in assets)

    table = Table(title="素材扫描结果")
    table.add_column("类型", style="cyan")
    table.add_column("数量", justify="right")
    table.add_column("详情")

    table.add_row("视频", str(len(videos)),
                  f"总时长 {total_duration:.1f}s")
    table.add_row("图片", str(len(images)), "")
    table.add_row("音频", str(len(audios)), "")
    table.add_row("总计", str(len(assets)),
                  f"总大小 {total_size / 1024 / 1024:.1f} MB")
    console.print(table)

    if args.json:
        data = {
            "total": len(assets),
            "videos": len(videos),
            "images": len(images),
            "audios": len(audios),
            "total_duration": round(total_duration, 2),
            "total_size_bytes": total_size,
            "assets": [a.to_dict() for a in assets],
        }
        print(json.dumps(data, ensure_ascii=False, indent=2))

    if args.detail:
        detail_table = Table(title="素材详情")
        detail_table.add_column("文件名", style="green")
        detail_table.add_column("类型")
        detail_table.add_column("分辨率")
        detail_table.add_column("时长")
        detail_table.add_column("大小")

        for a in assets:
            duration_str = f"{a.duration:.1f}s" if a.duration else "-"
            size_str = f"{a.file_size / 1024 / 1024:.1f}MB"
            res_str = f"{a.width}x{a.height}" if a.width > 0 else "-"
            detail_table.add_row(
                a.path.name, a.type, res_str, duration_str, size_str
            )
        console.print(detail_table)


# ---- templates 命令 ----

def cmd_templates(args: argparse.Namespace) -> None:
    """列出所有可用模板。"""
    config = _load_config()
    templates_dir = Path(config.get("paths", {}).get("templates_dir", "./templates"))
    templates = load_all_templates(templates_dir)

    if not templates:
        console.print("[yellow]未找到任何模板[/]")
        return

    table = Table(title="可用模板")
    table.add_column("名称", style="cyan")
    table.add_column("描述")
    table.add_column("标签")
    table.add_column("画布")

    for tpl in templates:
        meta = tpl.get("meta", {})
        canvas = tpl.get("canvas", {})
        table.add_row(
            meta.get("name", "unknown"),
            meta.get("description", ""),
            ", ".join(meta.get("tags", [])),
            f"{canvas.get('width', '?')}x{canvas.get('height', '?')}@{canvas.get('fps', '?')}fps",
        )

    console.print(table)

    if args.json:
        data = [{"name": t.get("meta", {}).get("name"),
                 "description": t.get("meta", {}).get("description"),
                 "tags": t.get("meta", {}).get("tags", [])}
                for t in templates]
        print(json.dumps(data, ensure_ascii=False, indent=2))


# ---- process 命令 ----

def cmd_process(args: argparse.Namespace) -> None:
    """批量剪辑处理。"""
    ensure_ffmpeg()
    config = _load_config()
    input_path = Path(args.input)
    output_path = Path(args.output) if args.output else Path("./output")
    templates_dir = Path(config.get("paths", {}).get("templates_dir", "./templates"))
    ffmpeg_config = config.get("ffmpeg", {})

    # 1. 扫描素材
    console.print(f"[bold blue]1/4 扫描素材:[/] {input_path}")
    assets = scan_folder(input_path)
    if not assets:
        console.print("[red]未找到任何媒体素材，中止处理[/]")
        sys.exit(1)

    console.print(f"  找到 {len(assets)} 个素材文件")

    # 2. 加载模板 & 匹配
    console.print("[bold blue]2/4 匹配模板...[/]")
    if args.template:
        tpl_path = templates_dir / f"{args.template}.yaml"
        if not tpl_path.exists():
            console.print(f"[red]模板 '{args.template}' 不存在[/]")
            sys.exit(1)
        tpl = load_template(tpl_path, templates_dir)
        errors = validate_template(tpl)
        if errors:
            for e in errors:
                console.print(f"  [red]模板校验错误: {e}[/]")
            sys.exit(1)
        template_map = {str(a.path): (tpl, 100.0) for a in assets}
    else:
        all_templates = load_all_templates(templates_dir)
        threshold = config.get("batch", {}).get("match_threshold", 30)
        template_map = match_batch(assets, all_templates, threshold)

    # 3. 创建任务
    console.print("[bold blue]3/4 创建任务...[/]")
    copy_vars = {}
    if args.vars:
        for pair in args.vars:
            k, _, v = pair.partition("=")
            copy_vars[k.strip()] = v.strip()

    tasks = create_tasks(assets, template_map, output_path, copy_vars)
    console.print(f"  创建了 {len(tasks)} 个剪辑任务")

    # 4. 执行
    voice = args.voice or config.get("tts", {}).get("default_voice", "zh-CN-XiaoxiaoNeural")
    rate = args.rate or config.get("tts", {}).get("default_rate", "+0%")
    workers = args.workers or config.get("batch", {}).get("max_workers", 4)

    console.print(f"[bold blue]4/4 执行渲染[/] (并发: {workers}, 语音: {voice})")

    processor = BatchProcessor(
        max_workers=workers,
        tts_concurrent=config.get("tts", {}).get("max_concurrent", 2),
        ffmpeg_config=ffmpeg_config,
    )

    completed = 0
    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        BarColumn(),
        TextColumn("{task.completed}/{task.total}"),
        TimeElapsedColumn(),
        console=console,
    ) as progress:
        task_id = progress.add_task("渲染中", total=len(tasks))

        def on_progress(edit_task: EditTask) -> None:
            nonlocal completed
            if edit_task.status in ("success", "failed", "skipped"):
                completed += 1
                progress.update(task_id, completed=completed)

        report = asyncio.run(processor.process_all(
            tasks=tasks,
            output_dir=output_path,
            voice=voice,
            rate=rate,
            progress_callback=on_progress,
        ))

    # 输出报告
    console.print()
    result_table = Table(title="处理结果")
    result_table.add_column("指标", style="cyan")
    result_table.add_column("值", justify="right")

    result_table.add_row("总计", str(report.total))
    result_table.add_row("[green]成功[/]", str(report.success))
    result_table.add_row("[red]失败[/]", str(report.failed))
    result_table.add_row("跳过", str(report.skipped))
    result_table.add_row("耗时", f"{report.elapsed_seconds:.1f}s")
    result_table.add_row("输出目录", str(report.output_dir))

    console.print(result_table)

    # 失败详情
    failed_tasks = [t for t in report.tasks if t.status == "failed"]
    if failed_tasks:
        console.print("\n[red bold]失败任务详情:[/]")
        for t in failed_tasks:
            console.print(f"  - {t.asset.path.name}: {t.error}")

    if args.json:
        print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2))

    sys.exit(0 if report.failed == 0 else 1)


# ---- main ----

def cmd_serve(args: argparse.Namespace) -> None:
    """启动 ClipCraft Web 工作台。"""
    try:
        import uvicorn
    except ImportError:
        console.print("[red]缺少 Web 依赖，请先安装：pip install -e .[/]")
        sys.exit(1)

    dist = Path(__file__).parent / "web" / "dist"
    if not dist.exists():
        console.print(
            "[yellow]提示：前端尚未构建，仅 API 可用。"
            "构建命令：cd web && npm install && npm run build[/]"
        )
    console.print(
        f"[bold green]ClipCraft Web 工作台[/] → http://{args.host}:{args.port}"
    )
    uvicorn.run(
        "server.app:app",
        host=args.host,
        port=args.port,
        reload=args.reload,
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="clipcraft",
        description="ClipCraft — 模板驱动的自动化批量视频剪辑工作台",
    )
    parser.add_argument("--json", action="store_true", help="输出结构化 JSON")
    subparsers = parser.add_subparsers(dest="command", help="可用命令")

    # scan
    scan_parser = subparsers.add_parser("scan", help="扫描素材文件夹")
    scan_parser.add_argument("--input", "-i", required=True, help="输入文件夹路径")
    scan_parser.add_argument("--detail", "-d", action="store_true", help="显示详细信息")
    scan_parser.add_argument("--json", action="store_true", help="输出 JSON")

    # templates
    tpl_parser = subparsers.add_parser("templates", help="列出可用模板")
    tpl_parser.add_argument("--json", action="store_true", help="输出 JSON")

    # process
    proc_parser = subparsers.add_parser("process", help="批量剪辑处理")
    proc_parser.add_argument("--input", "-i", required=True, help="输入路径（文件/文件夹）")
    proc_parser.add_argument("--output", "-o", help="输出目录")
    proc_parser.add_argument("--template", "-t", help="指定模板名称")
    proc_parser.add_argument("--voice", help="TTS 语音 ID")
    proc_parser.add_argument("--rate", help="TTS 语速")
    proc_parser.add_argument("--workers", "-w", type=int, help="并发数")
    proc_parser.add_argument("--vars", nargs="*", help="文案变量 (key=value)")
    proc_parser.add_argument("--json", action="store_true", help="输出 JSON")

    # serve
    serve_parser = subparsers.add_parser("serve", help="启动 Web 工作台")
    serve_parser.add_argument("--host", default="127.0.0.1", help="监听地址")
    serve_parser.add_argument("--port", type=int, default=8000, help="监听端口")
    serve_parser.add_argument("--reload", action="store_true", help="开发热重载")

    args = parser.parse_args()

    if args.command == "scan":
        cmd_scan(args)
    elif args.command == "templates":
        cmd_templates(args)
    elif args.command == "process":
        cmd_process(args)
    elif args.command == "serve":
        cmd_serve(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
