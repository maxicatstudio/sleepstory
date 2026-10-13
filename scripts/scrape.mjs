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

  await writeFile(OUT, JSON.stringify(stories, null, 2) + '\n');
  console.log(`\nĐã ghi ${stories.length} truyện vào stories.json`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
