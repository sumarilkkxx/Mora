import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:5174';

// Heuristic UI audit.
// Writes results to test-results/ui-findings.json for easy consumption.

test('ui audit: basic layout & text issues', async ({ page }, testInfo) => {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });

  const findings = await page.evaluate(() => {
    const out: any[] = [];

    const isVisible = (el: HTMLElement) => {
      const style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };

    const selectorFor = (el: Element) => {
      const parts: string[] = [];
      let cur: Element | null = el;
      for (let i = 0; i < 4 && cur; i++) {
        const id = (cur as HTMLElement).id;
        if (id) {
          parts.unshift(`#${CSS.escape(id)}`);
          break;
        }
        const cls = (cur as HTMLElement).className;
        const tag = cur.tagName.toLowerCase();
        const clsPart =
          typeof cls === 'string' && cls.trim()
            ? '.' + cls.trim().split(/\s+/).slice(0, 2).map((c) => CSS.escape(c)).join('.')
            : '';
        parts.unshift(tag + clsPart);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    };

    const els = Array.from(document.querySelectorAll<HTMLElement>('body *'));
    for (const el of els) {
      if (!isVisible(el)) continue;

      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;

      // Horizontal overflow candidates.
      if (el.scrollWidth - el.clientWidth > 2 && r.width > 120) {
        out.push({
          type: 'overflow-x',
          selector: selectorFor(el),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
          text: (el.innerText || '').trim().slice(0, 80),
        });
      }

      // likely clipped text (single-line)
      const style = window.getComputedStyle(el);
      const isSingleLine = style.whiteSpace === 'nowrap';
      if (isSingleLine && el.scrollWidth - el.clientWidth > 2) {
        out.push({
          type: 'text-clipped',
          selector: selectorFor(el),
          text: (el.innerText || '').trim().slice(0, 80),
        });
      }
    }

    // Buttons with suspicious labels.
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'));
    for (const b of buttons) {
      if (!isVisible(b)) continue;
      const label = (b.innerText || '').trim();
      if (!label) out.push({ type: 'button-empty', selector: selectorFor(b) });
    }

    return out;
  });

  const relOut = path.join(testInfo.project.outputDir, 'ui-findings.json');
  fs.mkdirSync(testInfo.project.outputDir, { recursive: true });
  fs.writeFileSync(relOut, JSON.stringify({ url: BASE_URL, count: findings.length, findings }, null, 2));
});
