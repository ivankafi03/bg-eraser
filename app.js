

'use strict';

// ── CDN Imports ──────────────────────────────────────────────
import { removeBackground } from 'https://esm.sh/@imgly/background-removal@1.4.5';

// ── Constants ────────────────────────────────────────────────
const DB_NAME    = 'bgeraser_history';
const DB_VERSION = 1;
const DB_STORE   = 'images';
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB
const ACCEPTED_TYPES = ['image/jpeg','image/png','image/webp','image/avif'];

// ── State ────────────────────────────────────────────────────
const state = {
  mode: 'single',          // 'single' | 'batch'
  originalFile: null,
  originalBlob: null,
  resultBlob:   null,
  resultURL:    null,
  bgType:       'transparent',
  bgColor:      '#ffffff',
  bgImageBlob:  null,
  resultView:   'compare', // 'compare' | 'touchup'
  // touchup
  touchupCanvas: null,
  touchupCtx:    null,
  originalResultCanvas: null, // pristine snapshot for restore brush
  brushMode:    'erase',
  brushSize:    30,
  brushOpacity: 100,
  touchupHistory: [],
  touchupFuture:  [],
  canvasZoom:     1,
  // batch
  batchQueue: [],    // {id, file, status, resultBlob, url}
  batchRunning: false,
  batchAbort:   false,
  // db
  db: null,
  historyCount: 0,
};

// ── DOM Refs (lazy) ──────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initDB();
  initScrollAnimations();
  initPWA();
  initDropZone();
  initModeTabs();
  initBgOptions();
  initResultViewTabs();
  initTouchup();
  initBatchDrop();
  initHistoryModal();
  initFAQ();
  mountBrushCursor();

  // Hero upload button
  const heroUploadBtn = $('hero-upload-btn');
  if (heroUploadBtn) heroUploadBtn.addEventListener('click', () => {
    state.mode = 'single';
    activateModeTab('single');
    scrollTo($('upload-section'), 80);
    setTimeout(() => $('file-input')?.click(), 300);
  });

  const heroBatchBtn = $('hero-batch-btn');
  if (heroBatchBtn) heroBatchBtn.addEventListener('click', () => {
    state.mode = 'batch';
    activateModeTab('batch');
    scrollTo($('upload-section'), 80);
  });
});

// ── Scroll helper ────────────────────────────────────────────
function scrollTo(el, offset = 0) {
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top: y, behavior: 'smooth' });
}

// ── Scroll Animations ────────────────────────────────────────
function initScrollAnimations() {
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in-view'); obs.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  $$('.animate-on-scroll').forEach(el => obs.observe(el));

  // Premium floating navbar scrolled listener
  const navbar = document.querySelector('.navbar');
  if (navbar) {
    const handleScroll = () => {
      if (window.scrollY > 15) {
        navbar.classList.add('navbar-scrolled');
      } else {
        navbar.classList.remove('navbar-scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial run
  }
}

// ── Mode Tabs ────────────────────────────────────────────────
function initModeTabs() {
  $$('[data-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      const m = btn.dataset.mode;
      activateModeTab(m);
    });
  });
}

function activateModeTab(mode) {
  state.mode = mode;
  $$('[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  const singlePanel = $('single-panel');
  const batchPanel  = $('batch-panel');
  if (singlePanel) singlePanel.classList.toggle('hidden', mode !== 'single');
  if (batchPanel)  batchPanel.classList.toggle('hidden', mode !== 'batch');
}

// ── Drop Zone (Single) ───────────────────────────────────────
function initDropZone() {
  const zone  = $('drop-zone');
  const input = $('file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });

  ['dragenter','dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave','drop'].forEach(evt => zone.addEventListener(evt, () => zone.classList.remove('drag-over')));
  zone.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); });

  input.addEventListener('change', () => { if (input.files[0]) handleFile(input.files[0]); input.value = ''; });

  // Paste
  document.addEventListener('paste', e => {
    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith('image/'));
    if (item) { const f = item.getAsFile(); if (f) { activateModeTab('single'); handleFile(f); } }
  });
}

// ── Handle File (Single) ─────────────────────────────────────
async function handleFile(file) {
  if (!ACCEPTED_TYPES.includes(file.type)) { showToast('Unsupported format. Use JPG, PNG, WebP, or AVIF.', 'error'); return; }
  if (file.size > MAX_FILE_SIZE) { showToast('File too large. Max 15MB.', 'error'); return; }

  state.originalFile = file;
  state.originalBlob = file;
  state.resultBlob   = null;
  state.resultURL    = null;

  $('result-panel')?.classList.remove('hidden');
  showState('processing');
  setProgress(0, 'Loading model…');
  scrollTo($('result-panel'), 80);

  try {
    const config = {
      progress: (key, cur, total) => {
        if (total > 0) {
          const pct = Math.round((cur / total) * 100);
          const label = key.includes('fetch') ? 'Downloading model…' : key.includes('run') ? 'Removing background…' : 'Processing…';
          setProgress(pct, label);
        }
      },
      output: { format: 'image/png', quality: 1 },
    };

    const blob = await removeBackground(file, config);
    state.resultBlob = blob;
    state.resultURL  = URL.createObjectURL(blob);
    await renderResult();
    saveToHistory(file.name, blob);
    showToast('Background removed!', 'success');
  } catch (err) {
    console.error(err);
    showState('error');
    $('error-msg') && ($('error-msg').textContent = err.message || 'Processing failed.');
  }
}

function setProgress(pct, label) {
  const bar  = $('progress-bar');
  const text = $('progress-text');
  const step = $('processing-step');
  if (bar)  bar.style.width  = pct + '%';
  if (text) text.textContent = pct + '%';
  if (step) step.textContent = label || 'Processing…';
}

function showState(which) {
  ['processing','error','success'].forEach(s => {
    const el = $('state-' + s);
    if (el) el.classList.toggle('hidden', s !== which);
  });
}

// ── Render Result ────────────────────────────────────────────
async function renderResult() {
  showState('success');

  // Comparison images
  const imgBefore = $('img-before');
  const imgAfter  = $('img-after');
  if (imgBefore) imgBefore.src = URL.createObjectURL(state.originalBlob);
  if (imgAfter)  imgAfter.src  = state.resultURL;

  // Init comparison slider
  initComparisonSlider();

  // Switch to compare view by default
  setResultView('compare');

  // Reset touchup
  state.touchupHistory = [];
  state.touchupFuture  = [];
  updateTouchupHistoryBtns();
  if (state.resultURL) loadTouchupCanvas(state.resultURL);

  // Apply current bg
  applyBackground();
}

// ── Result View Tabs ─────────────────────────────────────────
function initResultViewTabs() {
  $$('[data-rv]').forEach(btn => {
    btn.addEventListener('click', () => setResultView(btn.dataset.rv));
  });
  $('retry-btn')?.addEventListener('click', () => { $('file-input')?.click(); });
}

function setResultView(view) {
  state.resultView = view;
  $$('[data-rv]').forEach(b => b.classList.toggle('active', b.dataset.rv === view));
  $('rv-compare')?.classList.toggle('hidden', view !== 'compare');
  $('rv-touchup')?.classList.toggle('hidden', view !== 'touchup');
  if (view === 'touchup' && state.resultURL) loadTouchupCanvas(state.resultURL);
}

// ── Comparison Slider ────────────────────────────────────────
function initComparisonSlider() {
  const wrapper   = $('comp-wrapper');
  const sliderEl  = $('comp-slider');
  const compBefore= $('comp-before');
  const compAfter = $('comp-after');
  if (!wrapper || !sliderEl) return;

  let dragging = false;
  const update = pct => {
    pct = Math.max(5, Math.min(95, pct));
    if (sliderEl)  sliderEl.style.left  = pct + '%';
    if (compBefore) compBefore.style.clipPath = `inset(0 ${100-pct}% 0 0)`;
    if (compAfter)  compAfter.style.clipPath  = `inset(0 0 0 ${pct}%)`;
  };

  const getPct = e => {
    const rect = wrapper.getBoundingClientRect();
    const x = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return (x / rect.width) * 100;
  };

  wrapper.addEventListener('mousedown',  e => { dragging = true; update(getPct(e)); });
  wrapper.addEventListener('touchstart', e => { dragging = true; update(getPct(e)); }, { passive: true });
  window.addEventListener('mousemove',  e => { if (dragging) update(getPct(e)); });
  window.addEventListener('touchmove',  e => { if (dragging) update(getPct(e)); }, { passive: true });
  window.addEventListener('mouseup',   () => { dragging = false; });
  window.addEventListener('touchend',  () => { dragging = false; });

  update(50);
}

// ── Background Options ───────────────────────────────────────
function initBgOptions() {
  $$('.bg-option[data-bg]').forEach(opt => {
    opt.addEventListener('click', () => {
      $$('.bg-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      const bg = opt.dataset.bg;
      if (bg === 'color') {
        state.bgType = 'color';
        // Open native color picker
        $('bg-color-picker')?.click();
      } else if (bg === 'image') {
        $('bg-image-input')?.click();
        return;
      } else {
        state.bgType = bg;
        applyBackground();
      }
    });
  });

  // Custom color picker
  const colorPicker = $('bg-color-picker');
  colorPicker?.addEventListener('input', e => {
    state.bgColor = e.target.value;
    state.bgType  = 'color';
    $$('.bg-option').forEach(o => o.classList.toggle('active', o.dataset.bg === 'color'));
    applyBackground();
  });
  // Also fire when picker closes (change event) in case input didn't fire
  colorPicker?.addEventListener('change', e => {
    state.bgColor = e.target.value;
    applyBackground();
  });

  // BG image upload
  const bgImgInput = $('bg-image-input');
  bgImgInput?.addEventListener('change', async () => {
    const f = bgImgInput.files[0];
    if (!f) return;
    state.bgImageBlob = f;
    state.bgType = 'image';
    $$('.bg-option').forEach(o => o.classList.toggle('active', o.dataset.bg === 'image'));
    applyBackground();
    bgImgInput.value = '';
  });
}

async function applyBackground() {
  const canvas = $('bg-preview-canvas');
  if (!canvas || !state.resultBlob) return;

  const ctx = canvas.getContext('2d');
  const img = new Image();
  img.src   = state.resultURL;
  await new Promise(r => { img.onload = r; img.onerror = r; });

  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (state.bgType === 'transparent') {
    ctx.drawImage(img, 0, 0);
  } else if (state.bgType === 'color') {
    ctx.fillStyle = state.bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  } else if (state.bgType === 'white') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  } else if (state.bgType === 'black') {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  } else if (state.bgType === 'image' && state.bgImageBlob) {
    const bgImg = new Image();
    bgImg.src   = URL.createObjectURL(state.bgImageBlob);
    await new Promise(r => { bgImg.onload = r; bgImg.onerror = r; });
    ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
  } else {
    ctx.drawImage(img, 0, 0);
  }

  // ── Update the visible comparison "after" image ──
  const imgAfter = $('img-after');
  if (imgAfter) {
    if (state.bgType === 'transparent') {
      imgAfter.src = state.resultURL;
    } else {
      imgAfter.src = canvas.toDataURL('image/png');
    }
  }
}

// ── Download / Copy ───────────────────────────────────────────
document.addEventListener('click', async e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;

  if (action === 'download-png') {
    if (!state.resultBlob) return;
    const canvas = $('bg-preview-canvas');
    if (canvas && state.bgType !== 'transparent') {
      canvas.toBlob(blob => { downloadBlob(blob, cleanName(state.originalFile?.name) + '_no_bg.png'); }, 'image/png');
    } else {
      downloadBlob(state.resultBlob, cleanName(state.originalFile?.name) + '_no_bg.png');
    }
    showToast('Downloaded!', 'success');
  }

  if (action === 'download-webp') {
    if (!state.resultURL) return;
    const img = new Image(); img.src = state.resultURL;
    await new Promise(r => img.onload = r);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img,0,0);
    c.toBlob(b => downloadBlob(b, cleanName(state.originalFile?.name)+'_no_bg.webp'),'image/webp',0.92);
    showToast('Downloaded as WebP!', 'success');
  }

  if (action === 'copy-clipboard') {
    if (!state.resultBlob) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': state.resultBlob })]);
      showToast('Copied to clipboard!', 'success');
    } catch { showToast('Copy failed – try downloading.', 'error'); }
  }

  if (action === 'retry') {
    $('file-input')?.click();
  }
});

function cleanName(name) { return name ? name.replace(/\.[^.]+$/, '') : 'image'; }
function downloadBlob(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}

// ── Touch-up Brush ────────────────────────────────────────────
function initTouchup() {
  // Mode buttons
  $$('[data-brush-mode]').forEach(btn => {
    btn.addEventListener('click', () => {
      state.brushMode = btn.dataset.brushMode;
      $$('[data-brush-mode]').forEach(b => b.classList.toggle('active', b.dataset.brushMode === state.brushMode));
    });
  });

  // Brush size
  const sizeRange = $('brush-size');
  sizeRange?.addEventListener('input', () => {
    state.brushSize = parseInt(sizeRange.value);
    $('brush-size-val') && ($('brush-size-val').textContent = state.brushSize + 'px');
    updateBrushCursor();
  });

  // Brush opacity
  const opacRange = $('brush-opacity');
  opacRange?.addEventListener('input', () => {
    state.brushOpacity = parseInt(opacRange.value);
    $('brush-opacity-val') && ($('brush-opacity-val').textContent = state.brushOpacity + '%');
  });

  // Undo / Redo
  $('touchup-undo')?.addEventListener('click', touchupUndo);
  $('touchup-redo')?.addEventListener('click', touchupRedo);
  $('touchup-reset')?.addEventListener('click', () => {
    if (state.resultURL) { state.touchupHistory = []; state.touchupFuture = []; loadTouchupCanvas(state.resultURL); }
  });

  // Zoom
  $('zoom-in')?.addEventListener('click', () => {
    state.canvasZoom = Math.min(4, state.canvasZoom + 0.25);
    applyCanvasZoom();
  });
  $('zoom-out')?.addEventListener('click', () => {
    state.canvasZoom = Math.max(0.25, state.canvasZoom - 0.25);
    applyCanvasZoom();
  });

  // Apply touch-up
  $('apply-touchup')?.addEventListener('click', commitTouchup);
}

function applyCanvasZoom() {
  const c = $('touchup-canvas');
  if (c) { c.style.transform = `scale(${state.canvasZoom})`; c.style.transformOrigin = 'top left'; }
  $('zoom-label') && ($('zoom-label').textContent = Math.round(state.canvasZoom * 100) + '%');
}

async function loadTouchupCanvas(url) {
  const container = $('touchup-canvas-container');
  if (!container) return;

  let canvas = $('touchup-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'touchup-canvas';
    canvas.className = 'touchup-canvas';
    container.innerHTML = '';
    container.appendChild(canvas);
    initBrushOnCanvas(canvas);
  }

  const img = new Image();
  img.src   = url;
  await new Promise(r => { img.onload = r; img.onerror = r; });

  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  // ── Save pristine snapshot for restore brush ──
  const snap = document.createElement('canvas');
  snap.width  = canvas.width;
  snap.height = canvas.height;
  
  if (state.originalBlob) {
    const origImg = new Image();
    origImg.src = URL.createObjectURL(state.originalBlob);
    await new Promise(r => { origImg.onload = r; origImg.onerror = r; });
    snap.getContext('2d').drawImage(origImg, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(origImg.src);
  } else {
    snap.getContext('2d').drawImage(canvas, 0, 0);
  }
  state.originalResultCanvas = snap;

  state.touchupCanvas = canvas;
  state.touchupCtx    = ctx;
  state.canvasZoom    = 1;
  applyCanvasZoom();
  updateTouchupHistoryBtns();
}

// Brush painting
function initBrushOnCanvas(canvas) {
  let painting = false;
  let didPaint  = false;
  let lastX, lastY;

  const getPos = e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
    return [cx * scaleX, cy * scaleY];
  };

  const startPaint = e => {
    e.preventDefault();
    pushTouchupHistory();
    painting = true;
    didPaint  = false;
    [lastX, lastY] = getPos(e);
    paint(e);
  };

  const paint = e => {
    if (!painting) return;
    didPaint = true;
    const [x, y] = getPos(e);
    const ctx = state.touchupCtx;
    const alpha = state.brushOpacity / 100;

    if (state.brushMode === 'erase') {
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.moveTo(lastX, lastY);
      ctx.lineTo(x, y);
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth   = state.brushSize;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';
      ctx.stroke();
      ctx.restore();
    } else {
      // ── Restore: copy pixels from pristine original within the brush stroke ──
      const orig = state.originalResultCanvas;
      if (!orig) { lastX = x; lastY = y; return; }

      // Build a mask canvas for this stroke segment
      const maskC = document.createElement('canvas');
      maskC.width  = canvas.width;
      maskC.height = canvas.height;
      const mCtx  = maskC.getContext('2d');
      mCtx.strokeStyle = '#000';
      mCtx.lineWidth   = state.brushSize;
      mCtx.lineCap     = 'round';
      mCtx.lineJoin    = 'round';
      mCtx.beginPath();
      mCtx.moveTo(lastX, lastY);
      mCtx.lineTo(x, y);
      mCtx.stroke();

      // Extract original pixels through the mask
      const extC = document.createElement('canvas');
      extC.width  = canvas.width;
      extC.height = canvas.height;
      const eCtx  = extC.getContext('2d');
      eCtx.drawImage(orig, 0, 0);
      eCtx.globalCompositeOperation = 'destination-in';
      eCtx.drawImage(maskC, 0, 0);

      // Paint extracted original pixels onto current canvas
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(extC, 0, 0);
      ctx.restore();
    }

    lastX = x; lastY = y;
  };

  const stopPaint = () => {
    if (painting && !didPaint) {
      // Mousedown without move — pop the history snapshot we pushed
      state.touchupHistory.pop();
      updateTouchupHistoryBtns();
    } else if (painting && didPaint) {
      // Only clear redo stack if user actually painted something
      state.touchupFuture = [];
      updateTouchupHistoryBtns();
    }
    painting = false;
    didPaint  = false;
  };

  canvas.addEventListener('mousedown',  startPaint);
  canvas.addEventListener('mousemove',  paint);
  canvas.addEventListener('touchstart', startPaint, { passive: false });
  canvas.addEventListener('touchmove',  paint,       { passive: false });
  window.addEventListener('mouseup',   stopPaint);
  window.addEventListener('touchend',  stopPaint);
}

function pushTouchupHistory() {
  const canvas = state.touchupCanvas;
  if (!canvas) return;
  const snap = document.createElement('canvas');
  snap.width  = canvas.width;
  snap.height = canvas.height;
  snap.getContext('2d').drawImage(canvas, 0, 0);
  state.touchupHistory.push(snap);
  if (state.touchupHistory.length > 30) state.touchupHistory.shift();
  updateTouchupHistoryBtns();
}

function touchupUndo() {
  const canvas = state.touchupCanvas;
  if (!canvas || !state.touchupHistory.length) return;
  // Save current to future
  const snap = document.createElement('canvas');
  snap.width  = canvas.width;
  snap.height = canvas.height;
  snap.getContext('2d').drawImage(canvas, 0, 0);
  state.touchupFuture.push(snap);
  // Restore last
  const prev = state.touchupHistory.pop();
  state.touchupCtx.clearRect(0, 0, canvas.width, canvas.height);
  state.touchupCtx.drawImage(prev, 0, 0);
  updateTouchupHistoryBtns();
}

function touchupRedo() {
  const canvas = state.touchupCanvas;
  if (!canvas || !state.touchupFuture.length) return;
  const snap = document.createElement('canvas');
  snap.width  = canvas.width;
  snap.height = canvas.height;
  snap.getContext('2d').drawImage(canvas, 0, 0);
  state.touchupHistory.push(snap);
  const next = state.touchupFuture.pop();
  state.touchupCtx.clearRect(0, 0, canvas.width, canvas.height);
  state.touchupCtx.drawImage(next, 0, 0);
  updateTouchupHistoryBtns();
}

function updateTouchupHistoryBtns() {
  const undo = $('touchup-undo');
  const redo = $('touchup-redo');
  if (undo) undo.disabled = !state.touchupHistory.length;
  if (redo) redo.disabled = !state.touchupFuture.length;
}

async function commitTouchup() {
  const canvas = state.touchupCanvas;
  if (!canvas) { showToast('No touch-up to apply.', 'error'); return; }
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  state.resultBlob = blob;
  if (state.resultURL) URL.revokeObjectURL(state.resultURL);
  state.resultURL = URL.createObjectURL(blob);
  // Update comparison after view
  const imgAfter = $('img-after');
  if (imgAfter) imgAfter.src = state.resultURL;
  applyBackground();
  showToast('Touch-up applied! ✨', 'success');
}

// ── Brush Cursor ──────────────────────────────────────────────
function mountBrushCursor() {
  let cursor = document.createElement('div');
  cursor.className = 'brush-cursor';
  cursor.id = 'brush-cursor';
  document.body.appendChild(cursor);

  document.addEventListener('mousemove', e => {
    if (state.resultView !== 'touchup') { cursor.style.display = 'none'; return; }
    const canvas = $('touchup-canvas');
    if (!canvas) { cursor.style.display = 'none'; return; }
    const rect = canvas.getBoundingClientRect();
    const inside = e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (inside) {
      cursor.style.display = 'block';
      cursor.style.left    = e.clientX + 'px';
      cursor.style.top     = e.clientY + 'px';
      updateBrushCursor();
    } else {
      cursor.style.display = 'none';
    }
  });
}

function updateBrushCursor() {
  const cursor = $('brush-cursor');
  const canvas = $('touchup-canvas');
  if (!cursor || !canvas) return;
  
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / canvas.width;
  const sz = state.brushSize * scale;
  
  cursor.style.width  = sz + 'px';
  cursor.style.height = sz + 'px';
}

// ── Batch Processing ──────────────────────────────────────────
function initBatchDrop() {
  const zone  = $('batch-drop-zone');
  const input = $('batch-file-input');
  if (!zone || !input) return;

  zone.addEventListener('click', () => input.click());
  ['dragenter','dragover'].forEach(e => zone.addEventListener(e, ev => { ev.preventDefault(); zone.classList.add('drag-over'); }));
  ['dragleave','drop'].forEach(e => zone.addEventListener(e, () => zone.classList.remove('drag-over')));
  zone.addEventListener('drop', e => { e.preventDefault(); addToQueue(Array.from(e.dataTransfer.files)); });
  input.addEventListener('change', () => { addToQueue(Array.from(input.files)); input.value = ''; });

  $('batch-process-btn')?.addEventListener('click', runBatch);
  $('batch-download-btn')?.addEventListener('click', downloadBatchZip);
  $('batch-clear-btn')?.addEventListener('click', clearBatch);
  $('batch-stop-btn')?.addEventListener('click', () => { state.batchAbort = true; showToast('Stopping…', 'info'); });
}

function addToQueue(files) {
  const valid = files.filter(f => ACCEPTED_TYPES.includes(f.type) && f.size <= MAX_FILE_SIZE);
  if (valid.length < files.length) showToast(`${files.length - valid.length} file(s) skipped (wrong type/size).`, 'info');
  valid.forEach(f => {
    const id = Math.random().toString(36).slice(2);
    state.batchQueue.push({ id, file: f, status: 'waiting', resultBlob: null, url: null });
  });
  renderBatchQueue();
  const toolbar = $('batch-toolbar');
  if (toolbar) toolbar.classList.toggle('hidden', !state.batchQueue.length);
  updateBatchCount();
}

function renderBatchQueue() {
  const grid = $('batch-queue-grid');
  if (!grid) return;
  grid.innerHTML = '';
  state.batchQueue.forEach(item => {
    const el = document.createElement('div');
    el.className = 'batch-item';
    el.id = 'batch-item-' + item.id;
    const thumbURL = URL.createObjectURL(item.file);
    el.innerHTML = `
      <div class="batch-item-thumb">
        <img src="${thumbURL}" alt="${item.file.name}" loading="lazy">
        <div class="batch-item-status ${item.status}" id="bstat-${item.id}">
          ${statusIcon(item.status)}
        </div>
        <div class="batch-item-progress"><div class="batch-item-progress-bar" id="bprog-${item.id}"></div></div>
      </div>
      <div class="batch-item-info">
        <div class="batch-item-name" title="${item.file.name}">${item.file.name}</div>
        <div class="batch-item-size">${formatSize(item.file.size)}</div>
      </div>
      <div class="batch-item-actions">
        ${item.status === 'done' ? `<button class="btn btn-ghost btn-sm" onclick="downloadBatchItem('${item.id}')">↓ Save</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="removeBatchItem('${item.id}')">✕ Remove</button>
      </div>`;
    grid.appendChild(el);
  });
}

function statusIcon(status) {
  if (status === 'waiting')    return '…';
  if (status === 'processing') return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="batch-spin"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>';
  if (status === 'done')       return '✓';
  if (status === 'error')      return '✗';
  return '';
}

function updateBatchItem(id) {
  const item = state.batchQueue.find(i => i.id === id);
  if (!item) return;
  const stat = $('bstat-' + id);
  if (stat) { stat.className = 'batch-item-status ' + item.status; stat.innerHTML = statusIcon(item.status); }
  const actions = document.querySelector(`#batch-item-${id} .batch-item-actions`);
  if (actions) {
    actions.innerHTML = `
      ${item.status === 'done' ? `<button class="btn btn-ghost btn-sm" onclick="downloadBatchItem('${id}')">↓ Save</button>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="removeBatchItem('${id}')">✕</button>`;
  }
}

function updateBatchCount() {
  const done = state.batchQueue.filter(i => i.status === 'done').length;
  const total = state.batchQueue.length;
  const el = $('batch-count-label');
  if (el) el.innerHTML = `<strong>${total}</strong> file${total !== 1 ? 's' : ''} in queue`;
  const prog = $('batch-progress-info');
  if (prog) prog.textContent = done > 0 ? `${done} / ${total} done` : '';
  const dlBtn = $('batch-download-btn');
  if (dlBtn) dlBtn.disabled = done === 0;
}

async function runBatch() {
  if (state.batchRunning) return;
  state.batchRunning = true;
  state.batchAbort   = false;

  $('batch-process-btn')?.classList.add('hidden');
  $('batch-stop-btn')?.classList.remove('hidden');

  const queue = state.batchQueue.filter(i => i.status === 'waiting' || i.status === 'error');
  for (const item of queue) {
    if (state.batchAbort) break;
    item.status = 'processing';
    updateBatchItem(item.id);
    try {
      const blob = await removeBackground(item.file, {
        progress: (k, cur, tot) => {
          if (tot > 0) {
            const pct = Math.round((cur / tot) * 100);
            const bar = $('bprog-' + item.id);
            if (bar) bar.style.width = pct + '%';
          }
        }
      });
      item.resultBlob = blob;
      item.url        = URL.createObjectURL(blob);
      item.status     = 'done';
      saveToHistory(item.file.name, blob);
    } catch (err) {
      console.error(err);
      item.status = 'error';
    }
    updateBatchItem(item.id);
    updateBatchCount();
  }

  state.batchRunning = false;
  $('batch-process-btn')?.classList.remove('hidden');
  $('batch-stop-btn')?.classList.add('hidden');
  const doneCount = state.batchQueue.filter(i => i.status === 'done').length;
  showToast(`Batch complete! ${doneCount} image${doneCount !== 1 ? 's' : ''} processed.`, 'success');
}

window.downloadBatchItem = id => {
  const item = state.batchQueue.find(i => i.id === id);
  if (!item?.resultBlob) return;
  downloadBlob(item.resultBlob, cleanName(item.file.name) + '_no_bg.png');
};

window.removeBatchItem = id => {
  state.batchQueue = state.batchQueue.filter(i => i.id !== id);
  document.getElementById('batch-item-' + id)?.remove();
  updateBatchCount();
  const toolbar = $('batch-toolbar');
  if (toolbar) toolbar.classList.toggle('hidden', !state.batchQueue.length);
};

async function downloadBatchZip() {
  const done = state.batchQueue.filter(i => i.status === 'done');
  if (!done.length) return;
  showToast('Packaging ZIP…', 'info');
  try {
    const JSZip = (await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm')).default;
    const zip   = new JSZip();
    const folder = zip.folder('bg-erased');
    for (const item of done) {
      const arr = await item.resultBlob.arrayBuffer();
      folder.file(cleanName(item.file.name) + '_no_bg.png', arr);
    }
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } }, meta => {
      $('batch-download-btn') && ($('batch-download-btn').textContent = `Zipping… ${meta.percent.toFixed(0)}%`);
    });
    downloadBlob(blob, 'bg_erased_' + Date.now() + '.zip');
    showToast('ZIP downloaded!', 'success');
  } catch (err) {
    console.error(err);
    showToast('ZIP creation failed.', 'error');
  } finally {
    const btn = $('batch-download-btn');
    if (btn) btn.textContent = 'Download ZIP';
  }
}

function clearBatch() {
  state.batchQueue = [];
  const grid = $('batch-queue-grid');
  if (grid) grid.innerHTML = '';
  const toolbar = $('batch-toolbar');
  if (toolbar) toolbar.classList.add('hidden');
  updateBatchCount();
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

// ── IndexedDB History ─────────────────────────────────────────
function initDB() {
  const req = indexedDB.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = e => {
    const db = e.target.result;
    if (!db.objectStoreNames.contains(DB_STORE)) {
      const store = db.createObjectStore(DB_STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('ts', 'ts', { unique: false });
    }
  };
  req.onsuccess = e => {
    state.db = e.target.result;
    loadHistoryCount();
  };
  req.onerror = e => console.warn('IndexedDB error:', e);
}

function saveToHistory(name, blob) {
  if (!state.db) return;
  const reader = new FileReader();
  reader.onload = () => {
    const tx    = state.db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.add({ name, blob: reader.result, ts: Date.now() });
    tx.oncomplete = loadHistoryCount;
  };
  reader.readAsDataURL(blob);
}

function loadHistoryCount() {
  if (!state.db) return;
  const tx    = state.db.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  const req   = store.count();
  req.onsuccess = () => {
    state.historyCount = req.result;
    const badge = $('history-badge');
    if (badge) { badge.textContent = req.result; badge.classList.toggle('hidden', req.result === 0); }
  };
}

function loadHistoryItems(callback) {
  if (!state.db) { callback([]); return; }
  const tx    = state.db.transaction(DB_STORE, 'readonly');
  const store = tx.objectStore(DB_STORE);
  const idx   = store.index('ts');
  const req   = idx.openCursor(null, 'prev');
  const items = [];
  req.onsuccess = e => {
    const cursor = e.target.result;
    if (cursor) { items.push(cursor.value); cursor.continue(); }
    else callback(items);
  };
}

function deleteHistoryItem(id, callback) {
  if (!state.db) return;
  const tx    = state.db.transaction(DB_STORE, 'readwrite');
  tx.objectStore(DB_STORE).delete(id);
  tx.oncomplete = () => { loadHistoryCount(); callback?.(); };
}

function clearHistory() {
  if (!state.db) return;
  const tx = state.db.transaction(DB_STORE, 'readwrite');
  tx.objectStore(DB_STORE).clear();
  tx.oncomplete = () => { loadHistoryCount(); showHistoryModal(); };
}

// ── History Modal ─────────────────────────────────────────────
function initHistoryModal() {
  $('history-float-btn')?.addEventListener('click', showHistoryModal);
  $('history-modal-close')?.addEventListener('click', closeHistoryModal);
  $('history-clear-btn')?.addEventListener('click', () => {
    if (confirm('Clear all history? This cannot be undone.')) clearHistory();
  });
  $('history-modal-overlay')?.querySelector('.modal-backdrop')?.addEventListener('click', closeHistoryModal);
}

function showHistoryModal() {
  const overlay = $('history-modal-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
  loadHistoryItems(renderHistoryGrid);
}function closeHistoryModal() {
  const overlay = $('history-modal-overlay');
  if (!overlay) return;
  overlay.classList.add('hidden');
  document.body.style.overflow = '';
}
window.closeHistoryModal = closeHistoryModal;
function renderHistoryGrid(items) {
  const grid = $('history-grid');
  if (!grid) return;
  grid.innerHTML = '';

  if (!items.length) {
    grid.classList.add('empty');
    grid.innerHTML = `<div class="history-empty">
      <div class="empty-icon-glow">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="url(#emptyGrad)" stroke-width="1.5">
          <defs>
            <linearGradient id="emptyGrad" x1="0" y1="0" x2="24" y2="24">
              <stop offset="0%" stop-color="#6366f1"/>
              <stop offset="100%" stop-color="#a855f7"/>
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="18" height="18" rx="4" stroke-dasharray="4 2"/>
          <path d="m9 14 3-3 3 3" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12 11v6" stroke-linecap="round"/>
        </svg>
      </div>
      <h3>Your History is Empty</h3>
      <p class="history-empty-sub">Processed images will appear here locally for instant offline access.</p>
      <button class="btn btn-primary btn-sm" onclick="closeHistoryModal(); document.getElementById('hero-upload-btn-2').click();" style="margin-top: var(--space-sm);">
        Upload Image Now
      </button>
    </div>`;
    return;
  } else {
    grid.classList.remove('empty');
  }

  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    const date = new Date(item.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    el.innerHTML = `
      <div class="history-item-thumb"><img src="${item.blob}" alt="${item.name}" loading="lazy"></div>
      <div class="history-item-info">
        <div class="history-item-name" title="${item.name}">${item.name}</div>
        <div class="history-item-date">${date}</div>
      </div>
      <div class="history-item-actions">
        <button class="btn btn-ghost btn-sm" onclick="historyRestore(${item.id})">Restore</button>
        <button class="btn btn-ghost btn-sm" onclick="historyDownload(${item.id})">↓</button>
        <button class="btn btn-ghost btn-sm" onclick="historyDelete(${item.id})">✕</button>
      </div>`;
    grid.appendChild(el);
  });
}

window.historyRestore = id => {
  loadHistoryItems(items => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    fetch(item.blob).then(r => r.blob()).then(blob => {
      state.resultBlob = blob;
      if (state.resultURL) URL.revokeObjectURL(state.resultURL);
      state.resultURL = URL.createObjectURL(blob);
      $('result-panel')?.classList.remove('hidden');
      renderResult();
      closeHistoryModal();
      activateModeTab('single');
      scrollTo($('result-panel'), 80);
      showToast('Image restored from history!', 'success');
    });
  });
};

window.historyDownload = id => {
  loadHistoryItems(items => {
    const item = items.find(i => i.id === id);
    if (!item) return;
    const a = Object.assign(document.createElement('a'), { href: item.blob, download: cleanName(item.name) + '_no_bg.png' });
    a.click();
  });
};

window.historyDelete = id => {
  deleteHistoryItem(id, () => loadHistoryItems(renderHistoryGrid));
};

// ── PWA ───────────────────────────────────────────────────────
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    const banner = $('install-banner');
    if (banner) banner.classList.remove('hidden');
  });

  $('install-btn')?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { showToast('App installed!', 'success'); }
    deferredPrompt = null;
    $('install-banner')?.classList.add('hidden');
  });

  $('install-dismiss')?.addEventListener('click', () => {
    $('install-banner')?.classList.add('hidden');
  });
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = $('toast-container') || (() => {
    const el = document.createElement('div');
    el.id = 'toast-container';
    el.className = 'toast-container';
    document.body.appendChild(el);
    return el;
  })();

  const icons = {
    success: `<svg class="toast-icon-success" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`,
    error:   `<svg class="toast-icon-error"   width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    info:    `<svg class="toast-icon-info"    width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = (icons[type] || '') + `<span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.animation = 'toastOut .3s var(--ease) forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// ── FAQ ───────────────────────────────────────────────────────
function initFAQ() {
  // details/summary elements handle themselves; just ensure only one open at a time
  $$('.faq-item').forEach(item => {
    item.addEventListener('toggle', () => {
      if (item.open) {
        $$('.faq-item').forEach(other => { if (other !== item) other.open = false; });
      }
    });
  });
}

// ── Keyboard Shortcuts ────────────────────────────────────────
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); touchupUndo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) { e.preventDefault(); touchupRedo(); }
  if (e.key === 'Escape') closeHistoryModal();
});
