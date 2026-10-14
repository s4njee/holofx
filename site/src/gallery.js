const BATCH_SIZE = 12;
const visiblePreviews = new Set();
let previewsSuspended = document.hidden;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function syncPreview(image) {
  if (visiblePreviews.has(image) && !previewsSuspended && image.isConnected) {
    const src = image.dataset.previewStill && (reducedMotion.matches || image.dataset.previewFailed === 'true') ? image.dataset.previewStill : image.dataset.previewSrc;
    if (image.getAttribute('src') !== src) { image.classList.remove('is-loaded'); image.src = src; }
  } else {
    image.classList.remove('is-loaded');
    image.removeAttribute('src');
  }
}
const previewObserver = new IntersectionObserver(entries => {
  for (const entry of entries) {
    const image = entry.target;
    if (!image.isConnected) { previewObserver.unobserve(image); visiblePreviews.delete(image); continue; }
    if (entry.isIntersecting && entry.intersectionRatio > 0) visiblePreviews.add(image);
    else visiblePreviews.delete(image);
    syncPreview(image);
  }
}, { rootMargin: '0px', threshold: 0 });

export function watchPreview(image, src, still) {
  const base = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  if (src && src.startsWith('/')) src = base + src.slice(1);
  if (still && still.startsWith('/')) still = base + still.slice(1);
  image.dataset.previewSrc = src;
  if (still) image.dataset.previewStill = still;
  image.addEventListener('error', () => {
    if (image.hasAttribute('src') && image.dataset.previewStill && image.getAttribute('src') !== image.dataset.previewStill) { image.dataset.previewFailed = 'true'; syncPreview(image); }
  });
  image.decoding = 'async';
  image.classList.add('viewport-preview');
  image.addEventListener('load', () => {
    if (image.hasAttribute('src') && visiblePreviews.has(image)) image.classList.add('is-loaded');
  });
  previewObserver.observe(image);
}
reducedMotion.addEventListener('change', () => { for (const image of visiblePreviews) syncPreview(image); });

export function suspendPreviews(suspended) {
  previewsSuspended = suspended || document.hidden;
  for (const image of visiblePreviews) syncPreview(image);
}
function resetPreviewObserver() {
  previewObserver.disconnect();
  for (const image of visiblePreviews) { image.classList.remove('is-loaded'); image.removeAttribute('src'); }
  visiblePreviews.clear();
  for (const image of document.querySelectorAll('#cards [data-preview-src]')) previewObserver.observe(image);
}

export function createGallery({ catalogues, getProject, labUrl, openLab }) {
  const grid = document.getElementById('experiment-cards');
  const search = document.getElementById('experiment-search');
  const count = document.getElementById('experiment-count');
  const empty = document.getElementById('experiment-empty');
  const sentinel = document.getElementById('gallery-sentinel');
  const more = document.getElementById('gallery-more');
  const status = document.getElementById('gallery-status');
  let filtered = [];
  let rendered = 0;
  let generation = 0;
  let batchObserver;

  function card(effect, project) {
    const el = document.createElement('a');
    el.className = 'effect-card experiment-card';
    el.href = labUrl(project, effect.id);
    const visual = document.createElement('div');
    visual.className = 'card-image';
    if (effect.image) {
      const image = document.createElement('img');
      image.alt = `${effect.title} preview`;
      visual.append(image);
      watchPreview(image, effect.image, effect.imageStatic);
    } else {
      visual.classList.add('experiment-placeholder');
      if (effect.background) visual.style.background = effect.background;
      const label = document.createElement('span');
      label.className = 'placeholder-title';
      label.textContent = effect.title;
      visual.append(label);
    }
    const tag = document.createElement('span');
    tag.className = 'image-tag';
    tag.textContent = effect.category || effect.tags.slice(0, 2).join(' / ').replace(/-/g, ' ').toUpperCase() || 'WEBGPU EXPERIMENT';
    visual.append(tag);
    const body = document.createElement('div');
    body.className = 'card-body';
    const title = document.createElement('div');
    title.className = 'card-title';
    const heading = document.createElement('h3');
    heading.textContent = effect.title;
    const arrow = document.createElement('span');
    arrow.textContent = '↗';
    arrow.setAttribute('aria-hidden', 'true');
    title.append(heading, arrow);
    const description = document.createElement('p');
    description.textContent = effect.summary;
    const bottom = document.createElement('div');
    bottom.className = 'card-bottom';
    const meta = document.createElement('span');
    meta.textContent = effect.tier ? `TIER ${effect.tier}` : 'LIVE EXPERIMENT';
    const action = document.createElement('span');
    action.className = 'card-action';
    action.textContent = 'Try the effect ↗';
    bottom.append(meta, action);
    body.append(title, description, bottom);
    el.append(visual, body);
    el.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openLab(project, effect.id);
    });
    return el;
  }

  function appendBatch(focus = false) {
    if (rendered >= filtered.length) return;
    batchObserver?.unobserve(sentinel);
    const revision = generation;
    const project = getProject();
    const fragment = document.createDocumentFragment();
    const end = Math.min(rendered + BATCH_SIZE, filtered.length);
    let first;
    for (; rendered < end; rendered++) {
      const el = card(filtered[rendered], project);
      first ??= el;
      fragment.append(el);
    }
    grid.append(fragment);
    const total = catalogues[project].length;
    const hasMore = rendered < filtered.length;
    count.textContent = search.value.trim()
      ? `${filtered.length} of ${total} experiments · ${rendered} shown`
      : `${total} experiments · ${rendered} shown`;
    more.hidden = !hasMore;
    sentinel.hidden = filtered.length === 0;
    status.textContent = hasMore ? 'Keep scrolling to explore more experiments' : `All ${filtered.length} experiments shown`;
    if (focus) first?.focus();
    if (hasMore) requestAnimationFrame(() => {
      if (generation === revision) batchObserver?.observe(sentinel);
    });
  }

  function render() {
    generation++;
    batchObserver?.disconnect();
    resetPreviewObserver();
    grid.replaceChildren();
    rendered = 0;
    const query = search.value.trim().toLowerCase();
    const effects = catalogues[getProject()];
    filtered = effects.filter(effect => [effect.title, effect.summary, ...effect.tags].join(' ').toLowerCase().includes(query));
    empty.hidden = filtered.length > 0;
    sentinel.hidden = filtered.length === 0;
    const revision = generation;
    batchObserver = new IntersectionObserver(entries => {
      if (revision === generation && !previewsSuspended && entries.some(entry => entry.isIntersecting)) appendBatch();
    }, { rootMargin: '500px 0px', threshold: 0 });
    if (filtered.length) appendBatch();
    else { count.textContent = `0 of ${effects.length} experiments`; status.textContent = ''; more.hidden = true; }
  }
  function reset() { search.value = ''; render(); }
  function resume() {
    if (rendered < filtered.length && !previewsSuspended) {
      batchObserver?.unobserve(sentinel);
      batchObserver?.observe(sentinel);
    }
  }
  function destroy() { generation++; batchObserver?.disconnect(); previewObserver.disconnect(); visiblePreviews.clear(); }
  search.addEventListener('input', render);
  more.addEventListener('click', event => appendBatch(event.detail === 0));
  return { reset, resume, destroy };
}
