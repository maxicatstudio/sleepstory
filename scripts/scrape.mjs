#!/usr/bin/env node
// Lấy danh sách truyện tiếng Anh + link audio từ thefablecottage.com và ghi vào stories.json.
//
// Cách dùng:
//   node scripts/scrape.mjs
//   FABLE_COOKIE="<cookie khi đăng nhập>" node scripts/scrape.mjs   # nếu bạn có tài khoản thành viên
//
// Audio vẫn được phát trực tiếp từ server của The Fable Cottage, script không tải file về.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const ORIGIN = process.env.FABLE_ORIGIN || 'https://www.thefablecottage.com';
const INDEX_PAGES = ['/languages/english'];
const MAX_INDEX_PAGES = 30;
const OUT = fileURLToPath(new URL('../stories.json', import.meta.url));
const DEBUG_DIR = fileURLToPath(new URL('../debug/', import.meta.url));
const headers = {
  'User-Agent': 'Mozilla/5.0 (sleepstory scraper)',
  ...(process.env.FABLE_COOKIE ? { Cookie: process.env.FABLE_COOKIE } : {}),
};

async function get(path) {
  const url = new URL(path, ORIGIN).href;
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return { url: res.url, html: await res.text() };
}

const decode = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

function storyLinks(html, base) {
  const links = new Set();
  for (const [, href] of html.matchAll(/href=["']([^"'#?]+)["']/gi)) {
    const u = new URL(href, base);
    if (u.origin !== new URL(ORIGIN).origin) continue;
    // Trang truyện có dạng /fables/<ten-truyen>
    if (/^\/fables\/[^/]+\/?$/.test(u.pathname)) links.add(u.origin + u.pathname.replace(/\/$/, ''));
  }
  return [...links];
}

// Link sang trang tiếp theo của danh sách (?page=2, /page/2 ...)
function pageLinks(html, base) {
  const links = new Set();
  for (const [, href] of html.matchAll(/href=["']([^"'#]+)["']/gi)) {
    const u = new URL(decode(href), base);
    if (u.pathname.startsWith('/languages/english') && /[?&]page=\d+|\/page\/\d+/.test(u.pathname + u.search)) {
      links.add(u.href);
    }
  }
  return [...links];
}

async function saveDebug(name, html) {
  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(DEBUG_DIR + name, html);
  console.log(`  (đã lưu HTML vào debug/${name})`);
}

function findAudio(html, base) {
  html = html.replace(/\\\//g, '/'); // URL trong JSON dạng https:\/\/...
  const candidates = [
    ...html.matchAll(/<(?:audio|source)[^>]+src=["']([^"']+)["']/gi),
    ...html.matchAll(/data-(?:src|audio|url)=["']([^"']+?\.(?:mp3|m4a|ogg)[^"']*)["']/gi),
    ...html.matchAll(/["'](https?:\/\/[^"'\s]+?\.(?:mp3|m4a|ogg)(?:\?[^"'\s]*)?)["']/gi),
    ...html.matchAll(/["']([^"'\s]+?\.mp3(?:\?[^"'\s]*)?)["']/gi),
  ].map((m) => new URL(decode(m[1]), base).href);
  return candidates[0] || null;
}

function findTitle(html) {
  const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const t = html.match(/<title>([\s\S]*?)<\/title>/i);
  return decode((h1 && h1[1]) || (og && og[1]) || (t && t[1]) || '').replace(/\s*[|–-]\s*The Fable Cottage.*$/i, '');
}

// Truyện nhiều phần có URL dạng <slug>, <slug>-2, <slug>-3 ... và bản gộp <slug>-full.
// Xếp các phần đúng thứ tự, đánh số "(Part n)" và bỏ bản gộp để không nghe trùng.
export function organize(stories) {
  const groups = new Map();
  for (const s of stories) {
    const slug = new URL(s.url).pathname.split('/').pop();
    const m = slug.match(/^(.*?)(?:-(full)|-(\d+))?$/);
    const key = m[1];
    const part = m[2] ? 'full' : Number(m[3] || 1);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ ...s, part });
  }
  const out = [];
  for (const items of groups.values()) {
    const parts = items.filter((s) => s.part !== 'full').sort((a, b) => a.part - b.part);
    if (parts.length > 1) {
      parts.forEach(({ part, ...s }) => out.push({ ...s, title: `${s.title} (Part ${part})` }));
    } else {
      // Chỉ có 1 phần: ưu tiên bản gộp nếu có
      const { part, ...s } = items.find((x) => x.part === 'full') || parts[0];
      out.push(s);
    }
  }
  return out;
}

async function main() {
  let index;
  for (const p of INDEX_PAGES) {
    try { index = await get(p); break; } catch (e) { console.warn('Bỏ qua', e.message); }
  }
  if (!index) throw new Error('Không mở được trang danh sách truyện tiếng Anh');

  const links = new Set(storyLinks(index.html, index.url));
  const seenPages = new Set([index.url]);
  const queue = pageLinks(index.html, index.url);
  while (queue.length && seenPages.size < MAX_INDEX_PAGES) {
    const p = queue.shift();
    if (seenPages.has(p)) continue;
    seenPages.add(p);
    try {
      const page = await get(p);
      storyLinks(page.html, page.url).forEach((l) => links.add(l));
      queue.push(...pageLinks(page.html, page.url));
    } catch (e) { console.warn('Bỏ qua', e.message); }
  }
  // Trang danh sách không phải lúc nào cũng link tới các phần sau / bản gộp.
  // Thử thêm <slug>-full và <slug>-2, -3 ... cho tới khi gặp trang không tồn tại.
  for (const link of [...links]) {
    if (/-(full|\d+)$/.test(link)) continue;
    const extra = [`${link}-full`];
    for (let n = 2; n <= 10; n++) extra.push(`${link}-${n}`);
    for (const url of extra) {
      if (links.has(url)) continue;
      const res = await fetch(url, { method: 'HEAD', headers, redirect: 'follow' }).catch(() => null);
      const path = (u) => new URL(u).pathname.replace(/\/$/, '');
      if (res && res.ok && path(res.url) === path(url)) links.add(url);
      else if (!url.endsWith('-full')) break;
    }
  }
  console.log(`Tìm thấy ${links.size} trang truyện`);
  if (!links.size) await saveDebug('index.html', index.html);
  let savedNoAudio = false;

  const stories = [];
  for (const link of links) {
    try {
      const page = await get(link);
      const audio = findAudio(page.html, page.url);
      const title = findTitle(page.html) || link.split('/').pop().replace(/-/g, ' ');
      if (audio) {
        stories.push({ title, url: link, audio });
        console.log('✓', title);
      } else {
        console.log('– không có audio (có thể cần tài khoản):', title);
        if (!savedNoAudio) { savedNoAudio = true; await saveDebug('no-audio.html', page.html); }
      }
    } catch (e) {
      console.warn('✗', e.message);
    }
  }

  const list = organize(stories);
  await writeFile(OUT, JSON.stringify(list, null, 2) + '\n');
  console.log(`\nĐã ghi ${list.length} truyện vào stories.json`);
}

const isMain = process.argv[1] && resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) main().catch((e) => { console.error(e.message); process.exit(1); });
