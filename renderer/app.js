/* ===== State ===== */
let currentData = null;       // { userProfile, stories, highlights, spotlight, allSnaps }
let activeTab = 'all';        // 'all' | 'story' | 'highlight' | 'spotlight'
let lightboxSnaps = [];       // snaps visible in current tab
let lightboxIndex = 0;
let unsubProgress = null;

/* ===== Download tracking (localStorage) ===== */
const DOWNLOADS_KEY = 'snapDownloads';

// Keep an in-memory Set for O(1) lookups; sync to localStorage on every write.
let downloadedIds = (function loadDownloads() {
  try { return new Set(JSON.parse(localStorage.getItem(DOWNLOADS_KEY)) || []); }
  catch { return new Set(); }
})();

function markDownloaded(id) {
  downloadedIds.add(id);
  localStorage.setItem(DOWNLOADS_KEY, JSON.stringify([...downloadedIds]));
}

function isDownloaded(id) {
  return downloadedIds.has(id);
}

/* ===== Recent searches (localStorage) ===== */
const HISTORY_KEY = 'snapHistory';
const MAX_HISTORY = 8;

function loadHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY)) || [];
    // Purge stale entries written before the username/displayName fix:
    // real Snapchat handles never contain spaces, so any entry that does
    // had the display name stored in the username field by mistake.
    const clean = raw.filter((h) => h.username && !h.username.includes(' '));
    if (clean.length !== raw.length) saveHistory(clean);
    return clean;
  } catch { return []; }
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function addToHistory(userProfile) {
  let history = loadHistory();
  // Remove existing entry for same username
  history = history.filter((h) => h.username !== userProfile.username);
  history.unshift({
    username: userProfile.username,
    displayName: userProfile.displayName,
    avatarUrl: userProfile.avatarUrl,
  });
  history = history.slice(0, MAX_HISTORY);
  saveHistory(history);
  renderRecentSearches();
}

function removeFromHistory(username) {
  const history = loadHistory().filter((h) => h.username !== username);
  saveHistory(history);
  renderRecentSearches();
}

function renderRecentSearches() {
  const history = loadHistory();
  const container = document.getElementById('recentSearches');
  const list = document.getElementById('recentList');
  if (!history.length) { container.classList.add('hidden'); return; }
  container.classList.remove('hidden');

  // Rebuild header each time (clear-all btn needs fresh handler)
  const existingHeader = container.querySelector('.recent-header');
  if (existingHeader) existingHeader.remove();
  const header = document.createElement('div');
  header.className = 'recent-header';
  const title = document.createElement('h3');
  title.className = 'recent-title';
  title.textContent = 'Recent';
  const clearBtn = document.createElement('button');
  clearBtn.className = 'recent-clear-btn';
  clearBtn.textContent = 'Clear All';
  clearBtn.addEventListener('click', () => { saveHistory([]); renderRecentSearches(); });
  header.appendChild(title);
  header.appendChild(clearBtn);
  container.insertBefore(header, list);

  list.innerHTML = '';
  history.forEach((entry) => {
    const card = document.createElement('div');
    card.className = 'recent-card';

    // Avatar
    if (entry.avatarUrl) {
      const img = document.createElement('img');
      img.className = 'recent-avatar';
      img.src = entry.avatarUrl;
      img.alt = '';
      img.onerror = function () {
        this.replaceWith(makePlaceholderAvatar());
      };
      card.appendChild(img);
    } else {
      card.appendChild(makePlaceholderAvatar());
    }

    // Name
    const name = document.createElement('span');
    name.className = 'recent-name';
    name.textContent = entry.displayName || entry.username;
    card.appendChild(name);

    // Remove button
    const removeBtn = document.createElement('button');
    removeBtn.className = 'recent-remove';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromHistory(entry.username);
    });
    card.appendChild(removeBtn);

    card.addEventListener('click', () => {
      searchInput.value = entry.username;
      doSearch();
    });

    list.appendChild(card);
  });
}

function makePlaceholderAvatar() {
  const el = document.createElement('div');
  el.className = 'recent-avatar-placeholder';
  el.textContent = '👻';
  return el;
}

/* ===== DOM refs ===== */
const searchInput   = document.getElementById('searchInput');
const searchBtn     = document.getElementById('searchBtn');
const emptyState    = document.getElementById('emptyState');
const loadingState  = document.getElementById('loadingState');
const errorState    = document.getElementById('errorState');
const errorMsg      = document.getElementById('errorMsg');
const resultsState  = document.getElementById('resultsState');
const profileAvatar = document.getElementById('profileAvatar');
const profileName   = document.getElementById('profileName');
const profileSub    = document.getElementById('profileSub');
const downloadAllBtn = document.getElementById('downloadAllBtn');
const progressBar   = document.getElementById('progressBar');
const progressFill  = document.getElementById('progressFill');
const progressLabel = document.getElementById('progressLabel');
const storyGrid     = document.getElementById('storyGrid');
const tabs          = document.getElementById('tabs');
const lightbox      = document.getElementById('lightbox');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev  = document.getElementById('lightboxPrev');
const lightboxNext  = document.getElementById('lightboxNext');
const lightboxMediaWrap = document.getElementById('lightboxMediaWrap');
const lightboxMeta  = document.getElementById('lightboxMeta');

/* ===== Show/hide state helpers ===== */
function showState(which) {
  [emptyState, loadingState, errorState, resultsState].forEach((el) =>
    el.classList.add('hidden')
  );
  which.classList.remove('hidden');
  // Home button is visible on every screen except the home screen itself
  document.getElementById('homeBtn').classList.toggle('hidden', which === emptyState);
}

function updateDownloadAllBtn() {
  if (!currentData) return;
  const newCount = currentData.allSnaps.filter(s => !isDownloaded(s.id)).length;
  if (newCount === 0) {
    downloadAllBtn.textContent = 'All Downloaded';
    downloadAllBtn.disabled = true;
  } else if (newCount < currentData.allSnaps.length) {
    downloadAllBtn.textContent = `Download ${newCount} New`;
    downloadAllBtn.disabled = false;
  } else {
    downloadAllBtn.textContent = 'Download All';
    downloadAllBtn.disabled = false;
  }
}

function showError(msg) {
  errorMsg.textContent = msg;
  showState(errorState);
  // Keep recent searches visible when showing an error — re-render on home
}

function goHome() {
  showState(emptyState);
  renderRecentSearches();
}

/* ===== Search ===== */
async function doSearch() {
  const username = searchInput.value.trim();
  if (!username) return;

  showState(loadingState);
  searchBtn.disabled = true;

  const result = await window.snapAPI.searchUser(username);

  searchBtn.disabled = false;

  if (!result.ok) {
    showError(result.error || 'Something went wrong.');
    return;
  }

  currentData = result.data;
  activeTab = 'all';
  addToHistory(result.data.userProfile);
  renderResults();
}

searchBtn.addEventListener('click', doSearch);
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

/* ===== Render results ===== */
function renderResults() {
  const { userProfile } = currentData;

  // Profile bar
  if (userProfile.avatarUrl) {
    profileAvatar.src = userProfile.avatarUrl;
    profileAvatar.style.display = 'block';
  } else {
    profileAvatar.style.display = 'none';
  }
  profileName.textContent = userProfile.displayName || userProfile.username;
  if (userProfile.subscriberCount) {
    profileSub.textContent = `${formatCount(userProfile.subscriberCount)} subscribers`;
  } else {
    profileSub.textContent = '';
  }

  // Reset progress
  progressBar.classList.add('hidden');
  progressFill.style.width = '0%';

  // Tabs — update active
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === activeTab);
  });

  renderGrid();
  updateDownloadAllBtn();
  showState(resultsState);
}

function getSnapsForTab(tab) {
  if (!currentData) return [];
  switch (tab) {
    case 'story':     return currentData.stories;
    case 'highlight': return currentData.highlights;
    case 'spotlight': return currentData.spotlight;
    default:          return currentData.allSnaps;
  }
}

function renderGrid() {
  const snaps = getSnapsForTab(activeTab);
  lightboxSnaps = snaps;
  storyGrid.innerHTML = '';

  if (snaps.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'no-snaps';
    msg.textContent = 'No snaps in this category.';
    storyGrid.appendChild(msg);
    return;
  }

  snaps.forEach((snap, idx) => {
    storyGrid.appendChild(buildCard(snap, idx));
  });
}

/* ===== Card builder ===== */
function buildCard(snap, idx) {
  const card = document.createElement('div');
  card.className = 'story-card';
  card.dataset.index = idx;

  // Thumbnail
  if (snap.thumbnailUrl) {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.src = snap.thumbnailUrl;
    img.alt = '';
    img.onerror = function () {
      this.parentElement.innerHTML =
        '<div class="no-preview">Preview unavailable</div>';
    };
    card.appendChild(img);
  } else {
    const noPreview = document.createElement('div');
    noPreview.className = 'no-preview';
    noPreview.textContent = 'No preview';
    card.appendChild(noPreview);
  }

  // Video badge
  if (snap.mediaType === 'video') {
    const badge = document.createElement('div');
    badge.className = 'card-badge';
    badge.textContent = '▶ Video';
    card.appendChild(badge);
  }

  // Source tag
  const sourceTag = document.createElement('div');
  sourceTag.className = 'card-source';
  sourceTag.textContent = snap.source;
  card.appendChild(sourceTag);

  // Downloaded checkmark badge
  if (isDownloaded(snap.id)) {
    const check = document.createElement('div');
    check.className = 'card-downloaded';
    check.textContent = '✓';
    card.appendChild(check);
  }

  // Hover overlay
  const overlay = document.createElement('div');
  overlay.className = 'card-overlay';

  const viewBtn = document.createElement('button');
  viewBtn.className = 'btn-view';
  viewBtn.textContent = 'View';
  viewBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openLightbox(idx);
  });

  const dlBtn = document.createElement('button');
  dlBtn.className = 'btn-dl';
  dlBtn.textContent = isDownloaded(snap.id) ? 'Re-download' : 'Download';
  dlBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadSnap(snap, dlBtn, card);
  });

  overlay.appendChild(viewBtn);
  overlay.appendChild(dlBtn);
  card.appendChild(overlay);

  // Click card to view
  card.addEventListener('click', () => openLightbox(idx));

  return card;
}

/* ===== Download single snap ===== */
async function downloadSnap(snap, btn, cardEl) {
  if (btn) { btn.disabled = true; btn.textContent = '…'; }

  const result = await window.snapAPI.downloadStory(snap);

  if (result.ok) {
    markDownloaded(snap.id);
    updateDownloadAllBtn();
    // Add checkmark badge to this card if not already there
    if (cardEl && !cardEl.querySelector('.card-downloaded')) {
      const check = document.createElement('div');
      check.className = 'card-downloaded';
      check.textContent = '✓';
      cardEl.appendChild(check);
    }
    if (btn) { btn.disabled = false; btn.textContent = 'Re-download'; }
  } else {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Error';
      setTimeout(() => {
        btn.textContent = isDownloaded(snap.id) ? 'Re-download' : 'Download';
      }, 2000);
    }
  }
}

/* ===== Download all ===== */
downloadAllBtn.addEventListener('click', async () => {
  if (!currentData) return;
  // Only download snaps that haven't been saved before
  const newSnaps = currentData.allSnaps.filter(s => !isDownloaded(s.id));
  if (!newSnaps.length) return;

  downloadAllBtn.disabled = true;
  progressBar.classList.remove('hidden');
  progressFill.style.width = '0%';
  progressLabel.textContent = `0 / ${newSnaps.length}`;

  if (unsubProgress) unsubProgress();
  unsubProgress = window.snapAPI.onDownloadProgress(({ current, total }) => {
    const pct = Math.round((current / total) * 100);
    progressFill.style.width = `${pct}%`;
    progressLabel.textContent = `${current} / ${total}`;
  });

  const username = currentData.userProfile.username;
  const result = await window.snapAPI.downloadAll(newSnaps, username);

  if (unsubProgress) { unsubProgress(); unsubProgress = null; }

  if (!result.ok) {
    progressLabel.textContent = 'Error: ' + result.error;
    downloadAllBtn.disabled = false;
  } else {
    // Mark every downloaded snap and refresh the grid to show checkmarks
    newSnaps.forEach(s => markDownloaded(s.id));
    progressFill.style.width = '100%';
    progressLabel.textContent = 'Done!';
    setTimeout(() => progressBar.classList.add('hidden'), 3000);
    renderGrid();
    updateDownloadAllBtn();
  }
});

/* ===== Tabs ===== */
tabs.addEventListener('click', (e) => {
  const tab = e.target.closest('.tab');
  if (!tab) return;
  activeTab = tab.dataset.tab;
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t === tab)
  );
  renderGrid();
});

/* ===== Lightbox ===== */
function openLightbox(idx) {
  lightboxIndex = idx;
  renderLightboxMedia();
  lightbox.classList.remove('hidden');
  document.addEventListener('keydown', lightboxKeyHandler);
}

function closeLightbox() {
  lightbox.classList.add('hidden');
  lightboxMediaWrap.innerHTML = '';
  document.removeEventListener('keydown', lightboxKeyHandler);
}

function renderLightboxMedia() {
  const snap = lightboxSnaps[lightboxIndex];
  if (!snap) return;

  lightboxMediaWrap.innerHTML = '';

  if (snap.mediaType === 'video') {
    const video = document.createElement('video');
    video.src = snap.mediaUrl;
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.style.maxWidth = '100%';
    video.style.maxHeight = '85vh';
    lightboxMediaWrap.appendChild(video);
  } else {
    const img = document.createElement('img');
    img.src = snap.mediaUrl;
    img.alt = '';
    lightboxMediaWrap.appendChild(img);
  }

  // Meta
  const parts = [`${lightboxIndex + 1} / ${lightboxSnaps.length}`, snap.source];
  if (snap.timestamp) {
    parts.push(new Date(snap.timestamp).toLocaleDateString());
  }
  lightboxMeta.textContent = parts.join(' · ');

  // Nav buttons
  lightboxPrev.disabled = lightboxIndex === 0;
  lightboxNext.disabled = lightboxIndex === lightboxSnaps.length - 1;
}

lightboxClose.addEventListener('click', closeLightbox);
lightbox.querySelector('.lightbox-backdrop').addEventListener('click', closeLightbox);

lightboxPrev.addEventListener('click', () => {
  if (lightboxIndex > 0) { lightboxIndex--; renderLightboxMedia(); }
});

lightboxNext.addEventListener('click', () => {
  if (lightboxIndex < lightboxSnaps.length - 1) { lightboxIndex++; renderLightboxMedia(); }
});

function lightboxKeyHandler(e) {
  switch (e.key) {
    case 'ArrowLeft':  if (lightboxIndex > 0) { lightboxIndex--; renderLightboxMedia(); } break;
    case 'ArrowRight': if (lightboxIndex < lightboxSnaps.length - 1) { lightboxIndex++; renderLightboxMedia(); } break;
    case 'Escape':     closeLightbox(); break;
  }
}

/* ===== Helpers ===== */
function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

/* ===== Init ===== */
renderRecentSearches();

document.getElementById('homeBtn').addEventListener('click', () => {
  searchInput.value = '';
  goHome();
});

/* ===== Update banner ===== */
window.snapAPI.onUpdateAvailable(({ version, releaseUrl }) => {
  const banner    = document.getElementById('updateBanner');
  const msg       = document.getElementById('updateMsg');
  const nowBtn    = document.getElementById('updateNowBtn');
  const laterBtn  = document.getElementById('updateLaterBtn');

  msg.textContent = `Version ${version} is available.`;
  banner.classList.remove('hidden');

  nowBtn.addEventListener('click', () => {
    window.snapAPI.openReleaseUrl(releaseUrl);
    banner.classList.add('hidden');
  });

  laterBtn.addEventListener('click', () => banner.classList.add('hidden'));
});
