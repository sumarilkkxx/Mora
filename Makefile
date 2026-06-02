# ClipCraft 常用任务
# 依赖：uv（Python）、Node/npm（前端）。
# 若 uv/npm 不在 PATH，可执行：export PATH="$HOME/.local/bin:$PATH"

PY := .venv/bin/python
HOST ?= 127.0.0.1
PORT ?= 8000

.PHONY: help install install-py install-web build serve dev clean

help:
	@echo "ClipCraft 任务："
	@echo "  make install     安装后端(uv) + 前端(npm) 依赖"
	@echo "  make build       构建前端静态产物 (web/dist)"
	@echo "  make serve       启动 Web 工作台（托管已构建前端）"
	@echo "  make dev         开发模式（后端热重载 + Vite dev server）"
	@echo "  make clean       清理构建产物与缓存"

install: install-py install-web

install-py:
	uv venv --python 3.11 .venv 2>/dev/null || true
	uv pip install --python $(PY) -e .

install-web:
	cd web && npm install

build:
	cd web && npm run build

serve: build
	$(PY) -m server --host $(HOST) --port $(PORT)

# 开发模式：后端 :8000 + 前端 :5173（Vite 代理 /api 到后端）
dev:
	@echo "启动后端 :$(PORT) 与前端 :5173 ..."
	@($(PY) -m server --host $(HOST) --port $(PORT) --reload &) \
		&& cd web && npm run dev

clean:
	rm -rf web/dist web/.vite
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
