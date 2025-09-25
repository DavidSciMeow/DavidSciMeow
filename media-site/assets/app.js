// Lightweight media gallery with left repo tree (uses GitHub Contents API unauthenticated).
// Targets: owner=DavidSciMeow repo=DavidSciMeow ref=main
const OWNER = 'DavidSciMeow';
const REPO = 'DavidSciMeow';
const REF = 'main';

const treeEl = document.getElementById('tree');
const galleryEl = document.getElementById('gallery');
const currentPathEl = document.getElementById('currentPath');
const globalSearch = document.getElementById('globalSearch');

const modal = document.getElementById('modal');
const modalContent = document.getElementById('modalContent');
const modalCaption = document.getElementById('modalCaption');
const modalClose = document.getElementById('modalClose');

let cache = {}; // simple in-memory cache for fetched directory listings
let mediaCache = {}; // cache of media listing per path
let allVisibleMedia = []; // current visible media items for search

// helper: GitHub API fetch with simple backoff on 403 (rate limit) or 429
async function ghFetch(path) {
  const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}?ref=${REF}`;
  let attempt = 0;
  while (attempt < 5) {
    attempt++;
    const res = await fetch(url, { headers: { Accept: 'application/vnd.github.v3+json' } });
    if (res.status === 200) {
      return res.json();
    } else if (res.status === 403 || res.status === 429) {
      // backoff
      const wait = Math.pow(2, attempt) * 500;
      await new Promise(r => setTimeout(r, wait));
      continue;
    } else if (res.status === 404) {
      return []; // treat as empty
    } else {
      console.error('GitHub API error', res.status, await res.text());
      return [];
    }
  }
  throw new Error('GitHub API: rate limited or unavailable');
}

function isMediaFile(name) {
  const ext = name.split('.').pop().toLowerCase();
  return ['png','jpg','jpeg','webp','gif','mp4','webm','ogv'].includes(ext);
}
function isImage(name){
  const ext = name.split('.').pop().toLowerCase();
  return ['png','jpg','jpeg','webp','gif'].includes(ext);
}
function isVideo(name){
  const ext = name.split('.').pop().toLowerCase();
  return ['mp4','webm','ogv'].includes(ext);
}
function rawUrl(path){
  return `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${path}`;
}

// Render a folder node (lazy-load children)
function makeFolderNode(name, path) {
  const node = document.createElement('div');
  node.className = 'node folder';
  node.tabIndex = 0;
  node.setAttribute('role','treeitem');
  node.setAttribute('aria-expanded','false');

  const left = document.createElement('div');
  left.innerHTML = `<strong>${name}</strong>`;
  const right = document.createElement('div');
  right.className = 'meta';
  right.textContent = '展开';

  node.appendChild(left);
  node.appendChild(right);

  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'children';
  childrenContainer.style.display = 'none';
  node.appendChild(childrenContainer);

  node.addEventListener('click', async (e) => {
    e.stopPropagation();
    const expanded = node.getAttribute('aria-expanded') === 'true';
    if (expanded) {
      node.setAttribute('aria-expanded','false');
      childrenContainer.style.display = 'none';
      right.textContent = '展开';
    } else {
      node.setAttribute('aria-expanded','true');
      right.textContent = '收起';
      childrenContainer.style.display = 'block';
      if (!childrenContainer.hasChildNodes()) {
        await loadAndRenderDir(path, childrenContainer);
      }
    }
  });
  node.addEventListener('keydown',(e)=>{
    if(e.key==='Enter'){ node.click(); }
  });
  return node;
}

// Render a file node
function makeFileNode(item) {
  const node = document.createElement('div');
  node.className = 'node file';
  node.tabIndex = 0;
  node.setAttribute('role','treeitem');
  node.textContent = item.name;
  node.addEventListener('click', (e) => {
    e.stopPropagation();
    showMediaForPath(item.path);
  });
  node.addEventListener('keydown',(e)=>{ if(e.key==='Enter') node.click(); });
  return node;
}

// Load directory contents and append nodes to container
async function loadAndRenderDir(path, container) {
  const key = path || '';
  if (cache[key]) {
    renderDirListing(cache[key], container);
    return;
  }
  const items = await ghFetch(path || '');
  cache[key] = items;
  renderDirListing(items, container);
}

function renderDirListing(items, container) {
  container.innerHTML = '';
  // directories first
  const dirs = items.filter(i => i.type === 'dir').sort((a,b)=>a.name.localeCompare(b.name));
  const files = items.filter(i => i.type === 'file').sort((a,b)=>a.name.localeCompare(b.name));
  dirs.forEach(d => {
    const node = makeFolderNode(d.name, d.path);
    container.appendChild(node);
  });
  files.forEach(f => {
    // only show media files as leaf clickable entries; other files are shown but dimmed
    const node = makeFileNode(f);
    if (!isMediaFile(f.name)) node.style.opacity = 0.5;
    container.appendChild(node);
  });
}

// When a directory is selected, list media items in right gallery
async function showMediaForPath(path) {
  currentPathEl.textContent = `/${path}`;
  galleryEl.innerHTML = '<p class="placeholder">加载中……</p>';
  const key = path || '';
  if (mediaCache[key]) {
    renderGallery(mediaCache[key]);
    return;
  }
  // fetch directory contents
  const items = await ghFetch(path || '');
  // find media files in this directory
  const media = [];
  for (const it of items) {
    if (it.type === 'file' && isMediaFile(it.name)) {
      const mimetype = isVideo(it.name) ? 'video' : 'image';
      const posterCandidates = ['jpg','jpeg','webp','png'].map(ext => {
        const base = it.name.replace(/\.[^/.]+$/, '');
        return `${it.path.replace(it.name,'')}${base}.${ext}`;
      });
      let poster = null;
      // try to detect poster among items
      for (const p of posterCandidates) {
        if (items.find(x => x.path === p)) { poster = rawUrl(p); break; }
      }
      media.push({
        name: it.name,
        path: it.path,
        type: mimetype,
        src: rawUrl(it.path),
        poster
      });
    }
  }
  // Also look into subfolders for media (shallow)
  for (const it of items) {
    if (it.type === 'dir') {
      const sub = await ghFetch(it.path);
      for (const s of sub) {
        if (s.type === 'file' && isMediaFile(s.name)) {
          media.push({
            name: s.name,
            path: s.path,
            type: isVideo(s.name) ? 'video' : 'image',
            src: rawUrl(s.path),
            poster: null
          });
        }
      }
    }
  }

  // If no repo media, fallback to demo sample list from media.json (local file)
  if (media.length === 0) {
    try {
      const demo = await fetch('assets/media.json').then(r=>r.json());
      media.push(...demo);
    } catch(e){
      // ignore
    }
  }

  mediaCache[key] = media;
  renderGallery(media);
}

function renderGallery(list) {
  allVisibleMedia = list;
  galleryEl.innerHTML = '';
  if (!list || list.length === 0) {
    galleryEl.innerHTML = '<p class="placeholder">该目录下没有图片或视频。</p>';
    return;
  }
  list.forEach(item => {
    const card = document.createElement('article');
    card.className = 'card';
    card.tabIndex = 0;

    const thumb = document.createElement('img');
    thumb.className = 'thumb';
    thumb.loading = 'lazy';
    thumb.alt = item.name;
    if (item.type === 'video') {
      thumb.src = item.poster || item.src;
    } else {
      thumb.src = item.src;
    }

    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('h3');
    title.className = 'card-title';
    title.textContent = item.name;
    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.innerHTML = `${item.type === 'video' ? '<span class="badge">VIDEO</span>' : '<span class="badge">IMAGE</span>'}`;

    body.appendChild(title);
    body.appendChild(meta);

    card.appendChild(thumb);
    card.appendChild(body);

    card.addEventListener('click', () => openModal(item));
    card.addEventListener('keydown', (e) => { if (e.key === 'Enter') openModal(item); });

    galleryEl.appendChild(card);
  });
}

// Modal functions
let lastFocused = null;
function openModal(item) {
  lastFocused = document.activeElement;
  modalContent.innerHTML = '';
  modalCaption.textContent = item.name || '';

  if (item.type === 'video') {
    const v = document.createElement('video');
    v.controls = true;
    v.preload = 'metadata';
    v.playsInline = true;
    v.style.maxHeight = '80vh';
    if (item.poster) v.poster = item.poster;
    const src = document.createElement('source');
    src.src = item.src;
    v.appendChild(src);
    modalContent.appendChild(v);
    v.play().catch(()=>{ /* autoplay may be blocked */ });
  } else {
    const img = document.createElement('img');
    img.src = item.src;
    img.alt = item.name || '';
    modalContent.appendChild(img);
  }

  modal.setAttribute('aria-hidden','false');
  modal.style.display = 'flex';
  trapFocus(modal);
}

function closeModal() {
  // stop media
  const media = modalContent.querySelector('video');
  if (media) {
    media.pause();
    media.removeAttribute('src');
    try{ media.load(); }catch(e){}
  }
  modal.setAttribute('aria-hidden','true');
  modal.style.display = 'none';
  modalContent.innerHTML = '';
  modalCaption.textContent = '';
  if (lastFocused) lastFocused.focus();
}

// focus trap simple implementation
function trapFocus(container) {
  const focusable = container.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length -1];
  if (first) first.focus();
  function handler(e){
    if (e.key === 'Tab') {
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    } else if (e.key === 'Escape') {
      closeModal();
    }
  }
  container.addEventListener('keydown', handler);
  // remove listener when closed
  const obs = new MutationObserver(()=> {
    if (container.getAttribute('aria-hidden') === 'true') {
      container.removeEventListener('keydown', handler);
      obs.disconnect();
    }
  });
  obs.observe(container, { attributes: true, attributeFilter: ['aria-hidden'] });
}

// wire modal close
modalClose.addEventListener('click', closeModal);
modal.addEventListener('click', (e) => {
  if (e.target === modal || e.target.classList.contains('modal-backdrop')) closeModal();
});
document.addEventListener('keydown', (e)=> {
  if (e.key === 'Escape' && modal.getAttribute('aria-hidden') === 'false') closeModal();
});

// initial tree root
(async function init(){
  // root folders: load root dir
  const rootItems = await ghFetch('');
  // render top-level nodes
  treeEl.innerHTML = '';
  const dirs = rootItems.filter(i=> i.type === 'dir').sort((a,b)=>a.name.localeCompare(b.name));
  const files = rootItems.filter(i=> i.type === 'file').sort((a,b)=>a.name.localeCompare(b.name));
  dirs.forEach(d=>{
    const node = makeFolderNode(d.name, d.path);
    treeEl.appendChild(node);
  });
  // show top-level media files as quick links
  if (files.length > 0) {
    const header = document.createElement('div');
    header.className = 'node';
    header.textContent = '仓库根目录文件';
    treeEl.appendChild(header);
    const fileList = document.createElement('div');
    fileList.className = 'children';
    files.forEach(f=>{
      const fn = makeFileNode(f);
      fileList.appendChild(fn);
    });
    treeEl.appendChild(fileList);
  }
})();

// global search filters gallery items client-side
globalSearch.addEventListener('input', (e)=>{
  const q = e.target.value.trim().toLowerCase();
  if (!q) return renderGallery(allVisibleMedia);
  const filtered = allVisibleMedia.filter(item => (item.name||'').toLowerCase().includes(q));
  renderGallery(filtered);
});
