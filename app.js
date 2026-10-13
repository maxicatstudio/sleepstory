(() => {
  const $ = (id) => document.getElementById(id);
  const audio = $('audio');
  const CUSTOM_KEY = 'sleepstory.custom';
  const AUTONEXT_KEY = 'sleepstory.autoNext';

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
    },
  };

  let stories = [];
  let index = 0;
  let failedInRow = 0;

  // ---------- Playlist ----------
  async function loadStories() {
    let base = [];
    try {
      const res = await fetch('stories.json', { cache: 'no-cache' });
      if (res.ok) base = await res.json();
    } catch { /* no stories.json yet */ }
    const custom = store.get(CUSTOM_KEY, []);
    stories = [...base, ...custom.map((s) => ({ ...s, custom: true }))]
      .filter((s) => s && s.audio);
    renderList();
  }

  function renderList() {
    const list = $('list');
    list.innerHTML = '';
    stories.forEach((s, i) => {
      const li = document.createElement('li');
      li.className = i === index ? 'playing' : '';
      li.innerHTML = `<span class="num">${i + 1}</span><span class="name"></span>`;
      li.querySelector('.name').textContent = s.title;
      li.onclick = () => playAt(i);
      if (s.custom) {
        const del = document.createElement('button');
        del.className = 'del';
        del.textContent = '✕';
        del.title = 'Xóa';
        del.onclick = (e) => { e.stopPropagation(); removeCustom(s); };
        li.appendChild(del);
      }
      list.appendChild(li);
    });
    $('count').textContent = stories.length;
    $('empty').classList.toggle('hidden', stories.length > 0);
  }

  function removeCustom(story) {
    const custom = store.get(CUSTOM_KEY, []).filter((s) => s.audio !== story.audio);
    store.set(CUSTOM_KEY, custom);
    const wasCurrent = stories[index] === story;
    stories = stories.filter((s) => s !== story);
    if (index >= stories.length) index = 0;
    renderList();
    if (wasCurrent) stories.length ? playAt(index) : resetPlayer();
  }

  function resetPlayer() {
    audio.pause();
    audio.removeAttribute('src');
    $('title').textContent = '—';
    updatePlayButton();
  }

  // ---------- Playback ----------
  function load(i) {
    if (!stories.length) return;
    index = (i + stories.length) % stories.length;
    const s = stories[index];
    audio.src = s.audio;
    $('title').textContent = s.title;
    document.title = `${s.title} · Sleep Story`;
    renderList();
    const active = $('list').children[index];
    if (active) active.scrollIntoView({ block: 'nearest' });
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: 'The Fable Cottage' });
    }
  }

  function play() {
    return audio.play().catch((err) => {
      if (err.name === 'NotAllowedError') $('startOverlay').classList.remove('hidden');
      throw err;
    });
  }

  function playAt(i) {
    load(i);
    play().catch(() => {});
  }

  function next() { playAt(index + 1); }
  function prev() {
    if (audio.currentTime > 5) { audio.currentTime = 0; return; }
    playAt(index - 1);
  }

  function togglePlay() {
    if (!stories.length) return;
    if (!audio.src) { playAt(index); return; }
    audio.paused ? play().catch(() => {}) : audio.pause();
  }

  function updatePlayButton() {
    $('play').textContent = audio.paused ? '▶' : '⏸';
  }

  audio.addEventListener('ended', () => {
    if ($('autoNext').checked) {
      next();
    } else {
      // Tắt chuyển bài: lặp lại truyện hiện tại
      audio.currentTime = 0;
      play().catch(() => {});
    }
  });
  audio.addEventListener('playing', () => { failedInRow = 0; });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    failedInRow++;
    if (failedInRow < stories.length) next(); // bỏ qua truyện lỗi
  });
  audio.addEventListener('play', updatePlayButton);
  audio.addEventListener('pause', updatePlayButton);

  // ---------- Progress ----------
  const fmt = (t) => {
    if (!isFinite(t)) return '0:00';
    t = Math.floor(t);
    const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    const mm = h ? String(m).padStart(2, '0') : m;
    return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`;
  };
  let seeking = false;
  audio.addEventListener('timeupdate', () => {
    $('cur').textContent = fmt(audio.currentTime);
    if (!seeking && audio.duration) $('seek').value = (audio.currentTime / audio.duration) * 100;
  });
  audio.addEventListener('loadedmetadata', () => { $('dur').textContent = fmt(audio.duration); });
  $('seek').addEventListener('input', () => { seeking = true; });
  $('seek').addEventListener('change', () => {
    if (audio.duration) audio.currentTime = ($('seek').value / 100) * audio.duration;
    seeking = false;
  });

  // ---------- Auto-next toggle ----------
  function syncAutoNext() {
    const on = $('autoNext').checked;
    $('autoNextState').textContent = on ? 'BẬT' : 'TẮT';
    $('autoNextHint').textContent = on
      ? 'Hết truyện sẽ phát truyện tiếp theo, lặp lại từ đầu danh sách.'
      : 'Hết truyện sẽ phát lại chính truyện đang nghe.';
    store.set(AUTONEXT_KEY, on);
  }
  $('autoNext').checked = store.get(AUTONEXT_KEY, true);
  $('autoNext').addEventListener('change', syncAutoNext);
  syncAutoNext();

  // ---------- Sleep timer ----------
  let timerEnd = 0;
  let timerId = null;
  let activeChip = null;

  function setTimer(minutes, chip) {
    cancelTimer();
    timerEnd = Date.now() + minutes * 60_000;
    activeChip = chip;
    if (chip) chip.classList.add('active');
    $('timerStatus').classList.remove('hidden');
    tick();
    timerId = setInterval(tick, 1000);
    if (audio.paused && stories.length) togglePlay();
  }

  function cancelTimer() {
    clearInterval(timerId);
    timerId = null;
    timerEnd = 0;
    if (activeChip) activeChip.classList.remove('active');
    activeChip = null;
    $('timerStatus').classList.add('hidden');
    audio.volume = 1;
  }

  function tick() {
    const left = timerEnd - Date.now();
    $('timerLeft').textContent = fmt(Math.max(0, left) / 1000);
    // Giảm dần âm lượng trong 30 giây cuối
    if (left <= 30_000) audio.volume = Math.max(0, Math.min(1, left / 30_000));
    if (left <= 0) {
      audio.pause();
      cancelTimer();
    }
  }

  document.querySelectorAll('.chip[data-min]').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (activeChip === chip) { cancelTimer(); return; }
      $('customForm').classList.add('hidden');
      setTimer(Number(chip.dataset.min), chip);
    });
  });
  $('customBtn').addEventListener('click', () => {
    $('customForm').classList.toggle('hidden');
    $('customMin').focus();
  });
  $('customForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const min = Number($('customMin').value);
    if (!(min > 0)) return;
    $('customForm').classList.add('hidden');
    setTimer(min, $('customBtn'));
  });
  $('timerCancel').addEventListener('click', cancelTimer);

  // ---------- Manual add ----------
  $('addForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const story = { title: $('addTitle').value.trim(), audio: $('addUrl').value.trim() };
    if (!story.title || !story.audio) return;
    store.set(CUSTOM_KEY, [...store.get(CUSTOM_KEY, []), story]);
    stories.push({ ...story, custom: true });
    renderList();
    e.target.reset();
    if (stories.length === 1) playAt(0);
  });

  // ---------- Controls ----------
  $('play').addEventListener('click', togglePlay);
  $('next').addEventListener('click', next);
  $('prev').addEventListener('click', prev);
  $('startBtn').addEventListener('click', () => {
    $('startOverlay').classList.add('hidden');
    play().catch(() => {});
  });

  if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => play().catch(() => {}));
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
    navigator.mediaSession.setActionHandler('nexttrack', next);
    navigator.mediaSession.setActionHandler('previoustrack', prev);
  }

  // ---------- Start: tự phát truyện đầu tiên ----------
  loadStories().then(() => { if (stories.length) playAt(0); });
})();
