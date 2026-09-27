import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from './fixtures';

function database() {
  const state = JSON.parse(readFileSync(join(process.cwd(), 'test-results', 'e2e-server-state.json'), 'utf8')) as { root: string };
  const db = new Database(join(state.root, 'data', 'sqlite.db'));
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  return db;
}

function seedProject(id: string, name: string) {
  const db = database();
  try {
    db.prepare('INSERT INTO projects (id, name, status, production_mode, workflow_type, production_workflow) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, name, 'draft', 'local', 'generate', JSON.stringify([{ id: 'motion', enabled: false }]));
  } finally { db.close(); }
}

test('制作概览覆盖空项目与安全忽略旧工作流', async ({ page }) => {
  seedProject('overview-empty', '空项目');
  await page.goto('/project/overview-empty/production');
  await expect(page.getByRole('heading', { name: '制作概览' })).toBeVisible();
  await expect(page.getByText('尚未开始', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: '开始脚本' })).toHaveAttribute('href', '/project/overview-empty/script');
  await expect(page.getByText('旧版九阶段计划已安全忽略，实际制作状态不受影响。')).toBeVisible();
});

test('制作概览显示持久化运行中操作', async ({ page }) => {
  seedProject('overview-running', '运行项目');
  const db = database();
  try {
    db.prepare('INSERT INTO scripts (id, project_id, style_type, selected, shots) VALUES (?, ?, ?, ?, ?)')
      .run('overview-running-script', 'overview-running', 'custom', 1, JSON.stringify([{ shotId: 1, duration: 3 }]));
    db.prepare('INSERT INTO operation_runs (id, kind, subject_id, request_key, status, stage, owner, lease_until, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run('overview-running-operation', 'pipeline', 'overview-running', 'overview-running-request', 'running', 'stock_fill', 'e2e-owner', Date.now() + 60_000, Date.now(), Date.now());
  } finally { db.close(); }
  await page.goto('/project/overview-running/production');
  await expect(page.getByText('制作中', { exact: true })).toBeVisible();
  await expect(page.locator('[data-stage="operation"]')).toHaveAttribute('data-state', 'running');
  await expect(page.locator('[data-stage="operation"]')).toContainText('stock_fill');
});

test('制作概览显示失败可恢复与完成项目', async ({ page }) => {
  seedProject('overview-failed', '失败项目');
  seedProject('overview-complete', '完成项目');
  const db = database();
  try {
    db.prepare('INSERT INTO ai_tasks (id, project_id, provider, model, media_type, task_id, status, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('overview-failed-task', 'overview-failed', 'fixture', 'fixture-image', 'image', 'paid-task', 'failed', 'provider failed');
    db.prepare('INSERT INTO scripts (id, project_id, style_type, selected, shots) VALUES (?, ?, ?, ?, ?)')
      .run('overview-complete-script', 'overview-complete', 'custom', 1, JSON.stringify([{ shotId: 1, duration: 3 }]));
    db.prepare('INSERT INTO assets (id, project_id, shot_id, type, status) VALUES (?, ?, ?, ?, ?)')
      .run('overview-complete-asset', 'overview-complete', 1, 'user_upload', 'done');
    db.prepare('INSERT INTO compositions (id, project_id, output_path, status, video_origin) VALUES (?, ?, ?, ?, ?)')
      .run('overview-complete-video', 'overview-complete', '/fixture/output.mp4', 'done', 'local_render');
  } finally { db.close(); }

  await page.goto('/project/overview-failed/production');
  await expect(page.getByText('执行失败', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('当前阶段生成失败，可单独重试或切换备用模型')).toBeVisible();

  await page.goto('/project/overview-complete/production');
  await expect(page.getByText('成片已完成', { exact: true })).toBeVisible();
  await expect(page.getByText('100%', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '查看导出与发布' })).toHaveAttribute('href', '/project/overview-complete/export');
  await expect(page.locator('[data-stage="qc"]')).toHaveAttribute('data-state', 'ready');
});
