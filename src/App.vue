<template>
  <div class="app" :class="'theme-' + theme">
    <header class="topbar">
      <span class="topbar__title">🗺️ 我的人生地图</span>
      <div class="topbar__right">
        <button class="btn btn--ghost" @click="toggleLang">{{ lang === 'zh' ? 'EN' : '中' }}</button>
        <button class="btn btn--ghost" @click="toggleTheme">{{ theme === 'dark' ? '☀️ 浅色' : '🌙 深色' }}</button>
        <input v-model="searchQ" class="search" placeholder="搜城市 / 备注" @keyup.enter="doSearch" />
        <span class="topbar__stat">城市 {{ cityCount }} · 足迹 {{ placed.length }} · 待定位 {{ pending.length }}</span>
        <label class="btn">➕ 上传<input type="file" accept="image/*" multiple hidden @change="onFiles" /></label>
        <label class="btn">📁 文件夹<input type="file" accept="image/*" webkitdirectory multiple hidden @change="onFiles" /></label>
        <label class="btn btn--ghost">📥 导入<input type="file" accept="application/json,.json,.zip" hidden @change="onImport" /></label>
        <button class="btn btn--ghost" @click="reviewOpen = !reviewOpen">🕐 回顾</button>
        <button class="btn btn--ghost" @click="onPoster">🖼️ 海报</button>
        <button class="btn btn--ghost" @click="onExport">📤 导出</button>
        <button class="btn btn--danger" @click="clearAll">🧹 清空</button>
      </div>
    </header>

    <div class="body" @dragover.prevent @drop.prevent="onDrop">
      <div ref="mapEl" class="map"></div>

      <!-- 空状态引导 -->
      <div v-if="!placed.length && !pending.length && !busy" class="empty">
        <div class="empty__emoji">🗺️</div>
        <div class="empty__title">开始你的人生地图</div>
        <div class="empty__sub">把照片拖进来，或点右上「➕ 上传 / 📁 文件夹」</div>
      </div>

      <!-- 去年今日 -->
      <div v-if="memories.length && !busy && !playing" class="memories" @click="openMemories">🎁 去年今日 · {{ memories.length }} 张回忆</div>

      <!-- 批量处理进度 -->
      <div v-if="busy" class="progress">⏳ 处理中 {{ busy.done }}/{{ busy.total }}…</div>

      <!-- 放置模式提示 -->
      <div v-if="placingId" class="banner">
        📍 点击地图，放置这张照片
        <button class="banner__cancel" @click="placingId = null">取消</button>
      </div>

      <!-- 详情抽屉 -->
      <aside v-if="selected" class="drawer">
        <button class="drawer__close" @click="selected = null">✕</button>
        <img :src="selected.url" class="drawer__img" title="点击全屏查看" @click="openFromDrawer" />
        <div class="drawer__date">📅 {{ fmt(selected.takenAt) }}<span v-if="selected.city"> · 📍 {{ selected.city }}</span></div>
        <textarea v-model="draftNote" class="drawer__note" placeholder="写点什么…（这次拍摄的故事）"></textarea>
        <div class="drawer__actions">
          <button class="btn btn--primary" @click="saveNote">保存</button>
          <button class="btn btn--danger" @click="deletePhoto(selected.id)">删除</button>
        </div>
      </aside>

      <!-- 回顾：年份筛选 + 行程 -->
      <aside v-if="reviewOpen" class="review">
        <div class="review__head">
          <span class="review__title">🕐 回顾</span>
          <button class="drawer__close" @click="reviewOpen = false">✕</button>
        </div>
        <div class="chips">
          <button class="chip" :class="{ 'chip--on': selectedYear == null }" @click="selectYear(null)">全部</button>
          <button v-for="y in years" :key="y" class="chip" :class="{ 'chip--on': selectedYear === y }" @click="selectYear(y)">{{ y }}</button>
        </div>
        <div class="trips">
          <div v-if="!trips.length" class="trips__empty">还没有足迹</div>
          <div v-for="(t, i) in trips" :key="i" class="trip" @click="zoomTo(t.photos)">
            <div class="trip__range">{{ fmt(t.start) }} → {{ fmt(t.end) }}</div>
            <div class="trip__meta">📸 {{ t.photos.length }}<span v-if="t.cities.length"> · 📍 {{ t.cities.join('、') }}</span></div>
          </div>
        </div>
      </aside>

      <!-- 悬浮功能按钮 -->
      <div class="fabs">
        <button class="fab" title="相册" @click="albumOpen = true">▦</button>
        <button class="fab" :class="{ 'fab--on': provincesOn }" title="点亮省份" @click="toggleProvinces">🗺️</button>
        <button class="fab" title="数据看板" @click="statsOpen = true">📊</button>
        <button class="fab fab--play" title="旅程回放" @click="playJourney">▶</button>
      </div>

      <!-- 旅程回放浮层 -->
      <div v-if="playing" class="playback">
        <img v-if="playCurrent" :src="playCurrent.url" class="playback__img" />
        <div class="playback__info">
          <div class="playback__date">
            <span v-if="playCurrent && playCurrent.city">{{ playCurrent.city }} · </span>{{ playCurrent ? fmt(playCurrent.takenAt) : '' }}<span v-if="playCurrent && playCurrent.count > 1"> · {{ playCurrent.count }} 张</span>
          </div>
          <div class="playback__prog">第 {{ playProgress.i }} / {{ playProgress.total }} 站</div>
        </div>
        <button class="playback__stop" @click="stopJourney">⏹ 停止</button>
      </div>

      <!-- 数据看板 -->
      <div v-if="statsOpen" class="modal" @click.self="statsOpen = false">
        <div class="dash">
          <button class="drawer__close" @click="statsOpen = false">✕</button>
          <div class="dash__title">📊 我的足迹数据</div>
          <div class="dash__km">{{ totalKm.toLocaleString() }}<span> km</span></div>
          <div class="dash__kmlabel">按时间顺序走过的总里程</div>
          <div class="dash__grid">
            <div class="dash__cell"><b>{{ cityCount }}</b><span>城市</span></div>
            <div class="dash__cell"><b>{{ placed.length }}</b><span>足迹</span></div>
            <div class="dash__cell"><b>{{ placed.length + pending.length }}</b><span>照片</span></div>
          </div>
          <div class="dash__row"><span>最常去</span><b>{{ topCity }}</b></div>
          <div class="dash__row"><span>时间跨度</span><b>{{ dateRange }}</b></div>
        </div>
      </div>

      <!-- 待定位照片条 -->
      <footer v-if="pending.length" class="tray">
        <span class="tray__hint">待定位（点缩略图 → 再点地图放置）</span>
        <div class="tray__list">
          <div v-for="p in pending" :key="p.id" class="tray__item" :class="{ 'tray__item--active': placingId === p.id }">
            <img :src="p.url" @click="startPlacing(p.id)" />
            <button class="tray__del" @click="deletePhoto(p.id)">×</button>
          </div>
        </div>
      </footer>
    </div>

    <!-- 全屏 lightbox -->
    <div v-if="lightbox" class="lb" @click.self="lbClose">
      <button class="lb__close" @click="lbClose">✕</button>
      <button v-if="lightbox.list.length > 1" class="lb__nav lb__prev" @click="lbGo(-1)">‹</button>
      <img :src="lightbox.list[lightbox.index].url" class="lb__img" />
      <button v-if="lightbox.list.length > 1" class="lb__nav lb__next" @click="lbGo(1)">›</button>
      <div class="lb__cap">
        <span v-if="lightbox.list[lightbox.index].city">📍 {{ lightbox.list[lightbox.index].city }} · </span>{{ fmt(lightbox.list[lightbox.index].takenAt) }}
        <span class="lb__idx">（{{ lightbox.index + 1 }}/{{ lightbox.list.length }}）</span>
        <div v-if="lightbox.list[lightbox.index].note" class="lb__note">{{ lightbox.list[lightbox.index].note }}</div>
      </div>
    </div>

    <!-- 相册网格 -->
    <div v-if="albumOpen" class="album">
      <div class="album__head">
        <span class="album__title">🖼️ 相册 · {{ allPhotos.length }} 张</span>
        <button class="drawer__close" @click="albumOpen = false">✕</button>
      </div>
      <div class="album__grid">
        <img v-for="(p, i) in allPhotos" :key="p.id" :src="p.url" @click="openLightbox(allPhotos, i)" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import exifr from 'exifr';
import { db } from './db.js';
import { reverseCity } from './geocode.js';
import { drawPoster } from './poster.js';
import { wgs2gcj, gcj2wgs } from './gcj.js';

const mapEl = ref(null);
const placed = ref([]); // 已落点：{ id, lat, lng, takenAt, note, url }
const pending = ref([]); // 待定位：{ id, takenAt, note, url }
const selected = ref(null); // 详情抽屉中的照片
const draftNote = ref('');
const placingId = ref(null); // 正在放置的待定位照片 id
const busy = ref(null); // 批量处理进度 { done, total }
const cityCount = computed(() => new Set(placed.value.map((p) => p.city).filter(Boolean)).size);
let geocoding = false;

// 批 2：回顾（年份筛选 + 行程聚类）
const reviewOpen = ref(false);
const selectedYear = ref(null);
const years = computed(() => [...new Set(placed.value.map((p) => yearOf(p.takenAt)))].sort((a, b) => b - a));
const visiblePlaced = computed(() =>
  selectedYear.value == null ? placed.value : placed.value.filter((p) => yearOf(p.takenAt) === selectedYear.value),
);
// 行程：把可见足迹按时间排序，间隔 >3 天就切一段旅程
const trips = computed(() => {
  const list = [...visiblePlaced.value].sort((a, b) => ts(a.takenAt) - ts(b.takenAt));
  const GAP = 3 * 24 * 3600 * 1000;
  const out = [];
  let cur = null;
  for (const p of list) {
    const t = ts(p.takenAt);
    if (!cur || t - cur.lastT > GAP) { cur = { start: p.takenAt, end: p.takenAt, lastT: t, photos: [p] }; out.push(cur); }
    else { cur.photos.push(p); cur.end = p.takenAt; cur.lastT = t; }
  }
  return out.reverse().map((tr) => ({ ...tr, cities: [...new Set(tr.photos.map((x) => x.city).filter(Boolean))] }));
});
watch(selectedYear, () => renderMarkers());

// 杀手功能：旅程回放 / 数据看板 / 点亮省份
const playing = ref(false);
const playCurrent = ref(null);
const playProgress = ref({ i: 0, total: 0 });
const statsOpen = ref(false);
const provincesOn = ref(false);
const totalKm = computed(() => {
  const list = [...placed.value].sort((a, b) => ts(a.takenAt) - ts(b.takenAt));
  let d = 0;
  for (let i = 1; i < list.length; i++) d += haversine(list[i - 1], list[i]);
  return Math.round(d);
});
const topCity = computed(() => {
  const m = {};
  for (const p of placed.value) if (p.city) m[p.city] = (m[p.city] || 0) + 1;
  const e = Object.entries(m).sort((a, b) => b[1] - a[1])[0];
  return e ? `${e[0]}（${e[1]} 次）` : '—';
});
const dateRange = computed(() => {
  if (!placed.value.length) return '—';
  const ds = placed.value.map((p) => ts(p.takenAt)).sort((a, b) => a - b);
  return `${fmt(new Date(ds[0]))} ~ ${fmt(new Date(ds[ds.length - 1]))}`;
});
let playLine = null;
let playAbort = false;
let provinceLayer = null;
let provincesGeo = null;

// 锦上：lightbox / 相册 / 搜索 / 去年今日
const lightbox = ref(null); // { list, index }
const albumOpen = ref(false);
const searchQ = ref('');
const allPhotos = computed(() => [...placed.value, ...pending.value].sort((a, b) => ts(b.takenAt) - ts(a.takenAt)));
const memories = computed(() => {
  const now = new Date();
  const md = `${now.getMonth()}-${now.getDate()}`;
  return allPhotos.value.filter((p) => {
    const d = p.takenAt instanceof Date ? p.takenAt : new Date(p.takenAt);
    return `${d.getMonth()}-${d.getDate()}` === md && d.getFullYear() < now.getFullYear();
  });
});

let map;
let markersLayer;
const markers = new Map(); // id → L.marker
const theme = ref(localStorage.getItem('life-map-theme') || 'dark');
const lang = ref(localStorage.getItem('life-map-lang') || 'en');
let darkLayer;
let lightLayer;
let gaodeLayer;

onMounted(async () => {
  // 请求持久化存储，避免浏览器在磁盘紧张时回收掉本地照片数据
  if (navigator.storage?.persist) navigator.storage.persist();
  map = L.map(mapEl.value, { zoomControl: true }).setView([32.0, 108.0], 4);
  // 深/浅两套底图（Esri 灰底 Canvas，都是 WGS-84、国内可访问），由顶部按钮切换
  darkLayer = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: '&copy; Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: '&copy; Esri' }),
  ]);
  lightLayer = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: '&copy; Esri' }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: '&copy; Esri' }),
  ]);
  // 中文底图：高德（GCJ-02 坐标 + 中文标注）；英文用上面的 Esri（WGS-84）
  gaodeLayer = L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', { subdomains: '1234', maxZoom: 18, attribution: '&copy; 高德' });
  applyBasemap();
  // 地点聚合：markercluster 自动按缩放把邻近足迹聚成数字气泡，放大自动散开，同点可展开
  markersLayer = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 55,
    spiderfyOnMaxZoom: true,
    // 聚合气泡用簇内一张照片当封面 + 角标数字，整张图像照片墙
    iconCreateFunction: (cluster) => {
      const first = cluster.getAllChildMarkers()[0];
      const url = first?.options?.photoUrl || '';
      const count = cluster.getChildCount();
      return L.divIcon({
        className: 'cluster-pin',
        html: `<div class="cluster-pin__wrap"><img src="${url}" alt="" /><span class="cluster-pin__badge">${count}</span></div>`,
        iconSize: [56, 56],
        iconAnchor: [28, 28],
      });
    },
  }).addTo(map);
  map.on('click', onMapClick);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  setTimeout(() => map.invalidateSize(), 200);

  await reload();
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('resize', onResize);
  if (map) map.remove();
});

function onResize() { if (map) map.invalidateSize(); }

// 坐标换算：中文(高德)底图用 GCJ-02，英文(Esri)用 WGS-84。数据永远存 WGS-84。
function toMap(lat, lng) { return lang.value === 'zh' ? wgs2gcj(lat, lng) : [lat, lng]; }
function fromMap(lat, lng) { return lang.value === 'zh' ? gcj2wgs(lat, lng) : [lat, lng]; }

function applyBasemap() {
  if (!map) return;
  [darkLayer, lightLayer, gaodeLayer].forEach((l) => l && map.removeLayer(l));
  if (lang.value === 'zh') gaodeLayer.addTo(map);
  else (theme.value === 'light' ? lightLayer : darkLayer).addTo(map);
}
function toggleTheme() {
  theme.value = theme.value === 'dark' ? 'light' : 'dark';
  localStorage.setItem('life-map-theme', theme.value);
  applyBasemap();
}
function toggleLang() {
  lang.value = lang.value === 'en' ? 'zh' : 'en';
  localStorage.setItem('life-map-lang', lang.value);
  applyBasemap();
  renderMarkers(); // 切底图后按新坐标系重投影所有钉子（WGS↔GCJ）
}

async function reload() {
  [...placed.value, ...pending.value].forEach((p) => p.url && URL.revokeObjectURL(p.url)); // 回收旧的 blob URL
  markersLayer.clearLayers();
  markers.clear();
  placed.value = [];
  pending.value = [];
  const all = await db.photos.orderBy('takenAt').toArray();
  for (const rec of all) {
    const url = URL.createObjectURL(rec.blob);
    if (Number.isFinite(rec.lat) && Number.isFinite(rec.lng)) {
      placed.value.push({ id: rec.id, lat: rec.lat, lng: rec.lng, takenAt: rec.takenAt, note: rec.note || '', city: rec.city, url });
    } else {
      pending.value.push({ id: rec.id, takenAt: rec.takenAt, note: rec.note || '', url });
    }
  }
  renderMarkers();
  geocodePending();
}

function onFiles(e) {
  processFiles(e.target.files);
  e.target.value = ''; // 允许再次选同一批
}

function onDrop(e) {
  if (e.dataTransfer?.files?.length) processFiles(e.dataTransfer.files);
}

// 批量处理：选文件/选文件夹/拖拽都走这里。逐张读 EXIF+压缩+入库，带进度。
async function processFiles(fileList) {
  const files = [...fileList].filter(isImage);
  if (!files.length || busy.value) return;
  busy.value = { done: 0, total: files.length };
  for (const file of files) {
    try {
      // EXIF 从原始文件读（HEIC 也能读到 GPS）；转码仅用于缩略图显示
      let gps = null;
      let meta = null;
      try { gps = await exifr.gps(file); } catch (_) { /* 无 GPS */ }
      try { meta = await exifr.parse(file, ['DateTimeOriginal']); } catch (_) { /* 无日期 */ }
      const hasGeo = gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude);
      const takenAt = meta?.DateTimeOriginal instanceof Date ? meta.DateTimeOriginal : new Date(file.lastModified);
      const source = await toDisplayable(file); // HEIC → JPEG，其它原样
      const blob = await makeThumb(source);
      const rec = {
        id: crypto.randomUUID(), blob,
        lat: hasGeo ? gps.latitude : null, lng: hasGeo ? gps.longitude : null,
        takenAt, note: '', placed: hasGeo ? 1 : 0, createdAt: new Date(),
      };
      await db.photos.add(rec);
      const url = URL.createObjectURL(blob);
      if (hasGeo) {
        placed.value.push({ id: rec.id, lat: rec.lat, lng: rec.lng, takenAt, note: '', url });
      } else {
        pending.value.push({ id: rec.id, takenAt, note: '', url });
      }
    } catch (err) {
      console.error('处理失败：', file.name, err);
    }
    busy.value.done++;
  }
  busy.value = null;
  renderMarkers();
  geocodePending();
}

function isImage(f) {
  return f.type.startsWith('image/') || /\.(jpe?g|png|gif|webp|bmp|heic|heif|tiff?)$/i.test(f.name);
}

// HEIC/HEIF → JPEG(用于缩略图显示);其它类型原样返回。
async function toDisplayable(file) {
  const isHeic = /image\/hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
  if (!isHeic) return file;
  try {
    const { default: heic2any } = await import('heic2any'); // 懒加载：仅在遇到 HEIC 时才拉这个大包
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    return Array.isArray(out) ? out[0] : out;
  } catch (_) {
    return file;
  }
}

// ---- 放置待定位照片 ----
function startPlacing(id) {
  placingId.value = placingId.value === id ? null : id;
}

async function onMapClick(e) {
  if (!placingId.value) return;
  const id = placingId.value;
  const idx = pending.value.findIndex((x) => x.id === id);
  placingId.value = null;
  if (idx < 0) return;
  const p = pending.value[idx];
  const [wlat, wlng] = fromMap(e.latlng.lat, e.latlng.lng); // 高德点击是 GCJ-02，转回 WGS-84 存库
  p.lat = wlat;
  p.lng = wlng;
  await db.photos.update(id, { lat: p.lat, lng: p.lng, placed: 1 });
  pending.value.splice(idx, 1);
  placed.value.push(p);
  renderMarkers();
  geocodePending();
}

// ---- 备注 / 删除 ----
function openDetail(p) {
  const found = placed.value.find((x) => x.id === p.id) || p;
  selected.value = found;
  draftNote.value = found.note || '';
}

async function saveNote() {
  if (!selected.value) return;
  await db.photos.update(selected.value.id, { note: draftNote.value });
  selected.value.note = draftNote.value;
  selected.value = null;
}

async function deletePhoto(id) {
  if (!confirm('确定删除这张照片？')) return;
  const gone = [...placed.value, ...pending.value].find((x) => x.id === id);
  if (gone?.url) URL.revokeObjectURL(gone.url);
  await db.photos.delete(id);
  placed.value = placed.value.filter((x) => x.id !== id);
  pending.value = pending.value.filter((x) => x.id !== id);
  if (selected.value?.id === id) selected.value = null;
  if (placingId.value === id) placingId.value = null;
  renderMarkers();
}

async function clearAll() {
  if (!confirm('确定清空所有照片和足迹？此操作不可撤销（建议先「导出」备份）。')) return;
  await db.photos.clear();
  [...placed.value, ...pending.value].forEach((p) => p.url && URL.revokeObjectURL(p.url)); // 回收 blob URL
  stopJourney(); // 去掉回放动画线
  if (provinceLayer) { map.removeLayer(provinceLayer); provinceLayer = null; provincesOn.value = false; } // 收起省份高亮
  markersLayer.clearLayers();
  markers.clear();
  placed.value = [];
  pending.value = [];
  selected.value = null;
  placingId.value = null;
}

// 给已落点但还没城市名的照片反查城市（串行 + 节流），结果写回库。
async function geocodePending() {
  if (geocoding) return;
  geocoding = true;
  try {
    for (const p of placed.value) {
      if (!p.city) {
        const city = await reverseCity(p.lat, p.lng);
        p.city = city;
        await db.photos.update(p.id, { city });
      }
    }
  } finally {
    geocoding = false;
  }
}

// ---- 导出 / 导入 ----
async function onExport() {
  try {
    const all = await db.photos.toArray();
    if (!all.length) { alert('还没有照片可导出'); return; }
    const { default: JSZip } = await import('jszip'); // 懒加载
    const zip = new JSZip();
    const folder = zip.folder('photos');
    const meta = [];
    for (const r of all) {
      const ext = (r.blob.type || '').includes('png') ? 'png' : 'jpg';
      const file = `${r.id}.${ext}`;
      folder.file(file, r.blob);
      meta.push({ id: r.id, lat: r.lat, lng: r.lng, takenAt: r.takenAt, note: r.note || '', city: r.city, placed: r.placed, createdAt: r.createdAt, file });
    }
    zip.file('data.json', JSON.stringify({ app: 'life-map', version: 2, photos: meta }));
    const blob = await zip.generateAsync({ type: 'blob' });
    download(blob, `life-map-备份-${stamp()}.zip`);
  } catch (e) {
    alert('导出失败：' + (e?.message || e));
  }
}

async function onImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    if (/\.zip$/i.test(file.name)) await importZip(file);
    else await importJson(file);
    await reload();
    alert('导入完成');
  } catch (err) {
    alert('导入失败：' + (err?.message || err));
  }
}

// 旧版 JSON 备份（图片 base64）
async function importJson(file) {
  const data = JSON.parse(await file.text());
  const list = Array.isArray(data) ? data : data.photos;
  if (!Array.isArray(list)) throw new Error('文件格式不对');
  for (const it of list) {
    await db.photos.put({
      id: it.id, blob: await dataUrlToBlob(it.image),
      lat: it.lat ?? null, lng: it.lng ?? null,
      takenAt: it.takenAt ? new Date(it.takenAt) : new Date(),
      note: it.note || '', city: it.city, placed: it.placed ? 1 : 0,
      createdAt: it.createdAt ? new Date(it.createdAt) : new Date(),
    });
  }
}

// 新版 ZIP 备份（photos/ 目录 + data.json）
async function importZip(file) {
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(file);
  const dataFile = zip.file('data.json');
  if (!dataFile) throw new Error('压缩包缺少 data.json');
  const data = JSON.parse(await dataFile.async('string'));
  for (const it of data.photos || []) {
    const pf = it.file && zip.file('photos/' + it.file);
    if (!pf) continue;
    const ab = await pf.async('arraybuffer');
    const blob = new Blob([ab], { type: it.file.endsWith('png') ? 'image/png' : 'image/jpeg' });
    await db.photos.put({
      id: it.id, blob,
      lat: it.lat ?? null, lng: it.lng ?? null,
      takenAt: it.takenAt ? new Date(it.takenAt) : new Date(),
      note: it.note || '', city: it.city, placed: it.placed ? 1 : 0,
      createdAt: it.createdAt ? new Date(it.createdAt) : new Date(),
    });
  }
}

// ---- 地图/工具 ----
// 点级聚合：把 ~11m 内的照片归为同一地点，一个钉子代表一组
function groupBySpot(list) {
  const g = new Map();
  for (const p of list) {
    const key = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
    if (!g.has(key)) g.set(key, { lat: p.lat, lng: p.lng, photos: [] });
    g.get(key).photos.push(p);
  }
  return [...g.values()];
}

function addGroupMarker(group) {
  const cover = group.photos[0];
  const n = group.photos.length;
  const m = L.marker(toMap(group.lat, group.lng), { icon: spotIcon(cover.url, n), photoUrl: cover.url });
  m.on('click', () => (n > 1 ? openLightbox(group.photos, 0) : openDetail(cover)));
  markersLayer.addLayer(m);
  markers.set(cover.id, m);
}

function spotIcon(url, n) {
  const badge = n > 1 ? `<span class="photo-pin__badge">${n}</span>` : '';
  return L.divIcon({
    className: 'photo-pin',
    html: `<div class="photo-pin__wrap"><img src="${url}" alt="" />${badge}</div>`,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

function fitToPhotos() {
  const list = visiblePlaced.value;
  if (list.length) {
    map.flyToBounds(L.latLngBounds(list.map((p) => toMap(p.lat, p.lng))), { maxZoom: 12, padding: [60, 60], duration: 0.8 });
  }
}

function yearOf(d) { return (d instanceof Date ? d : new Date(d)).getFullYear(); }
function ts(d) { return (d instanceof Date ? d : new Date(d)).getTime(); }

// 按当前年份筛选重绘钉子
function renderMarkers() {
  markersLayer.clearLayers();
  markers.clear();
  for (const g of groupBySpot(visiblePlaced.value)) addGroupMarker(g);
  fitToPhotos();
}

function selectYear(y) { selectedYear.value = y; }

function zoomTo(photos) {
  if (!photos.length) return;
  map.flyToBounds(L.latLngBounds(photos.map((p) => toMap(p.lat, p.lng))), { maxZoom: 13, padding: [60, 60], duration: 0.8 });
  reviewOpen.value = false;
}

async function onPoster() {
  try {
    const list = [...placed.value].sort((a, b) => ts(a.takenAt) - ts(b.takenAt));
    const route = buildStops(list).map((s) => ({ lat: s.lat, lng: s.lng })); // 按时间的行程站点
    const cities = [...new Set(placed.value.map((p) => p.city).filter(Boolean))];
    const ys = years.value;
    const blob = await drawPoster(
      {
        cities: cities.length,
        spots: placed.value.length,
        photos: placed.value.length + pending.value.length,
        yearFrom: ys.length ? ys[ys.length - 1] : null,
        yearTo: ys.length ? ys[0] : null,
        topCities: cities.slice(0, 8),
      },
      route,
    );
    download(blob, `life-map-海报-${stamp()}.png`);
  } catch (e) {
    alert('生成海报失败：' + (e?.message || e));
  }
}

// ---- 5. 旅程回放：按时间顺序画飞线 + 镜头依次飞过 ----
async function playJourney() {
  const list = [...placed.value].sort((a, b) => ts(a.takenAt) - ts(b.takenAt));
  const stops = buildStops(list); // 同一地区连续的多张合成一“站”，只在站间连线飞行
  if (stops.length < 2) { alert('至少要有 2 个不同地区的足迹才能回放旅程'); return; }
  reviewOpen.value = false;
  selected.value = null;
  playAbort = false;
  playing.value = true;
  if (playLine) map.removeLayer(playLine);
  playLine = L.polyline([], { color: '#a855f7', weight: 3, opacity: 0.9 }).addTo(map);
  const coords = [];
  for (let i = 0; i < stops.length; i++) {
    if (playAbort) break;
    const s = stops[i];
    playCurrent.value = { url: s.photos[0].url, takenAt: s.photos[0].takenAt, city: s.region, count: s.photos.length };
    playProgress.value = { i: i + 1, total: stops.length };
    const [mlat, mlng] = toMap(s.lat, s.lng);
    coords.push([mlat, mlng]);
    playLine.setLatLngs(coords);
    map.flyTo([mlat, mlng], Math.max(map.getZoom(), 6), { duration: 1.1 });
    await sleep(1600);
  }
  playing.value = false;
  playCurrent.value = null;
}

// 把按时间排序的足迹，按“地区”（优先城市，否则 ~11km 网格）把连续同区合并为一“站”
function buildStops(list) {
  const stops = [];
  let cur = null;
  for (const p of list) {
    const key = p.city || `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`;
    if (!cur || cur.key !== key) {
      cur = { key, region: p.city || '', photos: [p] };
      stops.push(cur);
    } else {
      cur.photos.push(p);
    }
  }
  for (const s of stops) {
    s.lat = s.photos.reduce((a, p) => a + p.lat, 0) / s.photos.length;
    s.lng = s.photos.reduce((a, p) => a + p.lng, 0) / s.photos.length;
  }
  return stops;
}
function stopJourney() {
  playAbort = true;
  playing.value = false;
  playCurrent.value = null;
  if (playLine) { map.removeLayer(playLine); playLine = null; }
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---- 6. 里程：按时间顺序相邻足迹的大圆距离求和 ----
function haversine(a, b) {
  const R = 6371;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---- 7. 点亮去过的省份 ----
async function toggleProvinces() {
  if (provinceLayer) {
    map.removeLayer(provinceLayer);
    provinceLayer = null;
    provincesOn.value = false;
    return;
  }
  provincesOn.value = true;
  try {
    if (!provincesGeo) {
      const res = await fetch('https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json');
      provincesGeo = await res.json();
    }
    const visited = new Set();
    for (const f of provincesGeo.features) {
      for (const p of placed.value) {
        if (pointInFeature(p.lng, p.lat, f)) { visited.add(f.properties.adcode); break; }
      }
    }
    provinceLayer = L.geoJSON(provincesGeo, {
      style: (f) =>
        visited.has(f.properties.adcode)
          ? { color: '#a855f7', weight: 1, fillColor: '#a855f7', fillOpacity: 0.35 }
          : { color: '#999', weight: 0.5, fillColor: '#000', fillOpacity: 0.04 },
    }).addTo(map);
  } catch (e) {
    provincesOn.value = false;
    alert('加载省界失败：' + (e?.message || e));
  }
}

function pointInFeature(lng, lat, feature) {
  const g = feature.geometry;
  if (!g) return false;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  for (const poly of polys) {
    if (pointInRing(lng, lat, poly[0])) return true;
  }
  return false;
}
function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// ---- 8/9. lightbox / 相册 / 搜索 / 去年今日 ----
function openLightbox(list, index) { lightbox.value = { list, index }; }
function lbGo(delta) {
  if (!lightbox.value) return;
  const n = lightbox.value.list.length;
  lightbox.value.index = (lightbox.value.index + delta + n) % n;
}
function lbClose() { lightbox.value = null; }

// 从详情抽屉点大图 → 打开同地区的照片组
function openFromDrawer() {
  const s = selected.value;
  if (!s) return;
  const key = s.city || `${s.lat.toFixed(1)},${s.lng.toFixed(1)}`;
  const list = placed.value.filter((p) => (p.city || `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`) === key);
  openLightbox(list, Math.max(0, list.findIndex((p) => p.id === s.id)));
}

function doSearch() {
  const q = searchQ.value.trim();
  if (!q) return;
  const hits = placed.value.filter((p) => (p.city || '').includes(q) || (p.note || '').includes(q));
  if (!hits.length) { alert('没找到匹配的足迹'); return; }
  map.flyToBounds(L.latLngBounds(hits.map((p) => toMap(p.lat, p.lng))), { maxZoom: 12, padding: [60, 60], duration: 0.8 });
}

function openMemories() { if (memories.value.length) openLightbox(memories.value, 0); }

function onKey(e) {
  if (!lightbox.value) return;
  if (e.key === 'ArrowLeft') lbGo(-1);
  else if (e.key === 'ArrowRight') lbGo(1);
  else if (e.key === 'Escape') lbClose();
}

async function makeThumb(file, maxSize = 1200, quality = 0.82) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return (await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality))) || file;
  } catch (_) {
    return file;
  }
}

function fmt(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
function stamp() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
async function dataUrlToBlob(dataUrl) {
  return await (await fetch(dataUrl)).blob();
}
function download(blob, name) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a); // 部分浏览器需挂到 DOM 才能触发
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(u); }, 1500); // 延迟释放，避免下载被取消
}
</script>

<style>
html, body, #app { height: 100%; margin: 0; }
* { box-sizing: border-box; }
.app { height: 100vh; display: flex; flex-direction: column; font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif; }

.topbar { height: 52px; flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 0 16px; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; }
.topbar__title { font-size: 17px; font-weight: 700; }
.topbar__right { display: flex; align-items: center; gap: 10px; }
.topbar__stat { font-size: 13px; opacity: 0.92; margin-right: 4px; }

.btn { cursor: pointer; font-size: 13px; font-weight: 600; padding: 7px 13px; border-radius: 999px; border: none; background: rgba(255, 255, 255, 0.22); color: #fff; user-select: none; }
.btn:hover { background: rgba(255, 255, 255, 0.34); }
.btn--ghost { background: rgba(255, 255, 255, 0.14); }
.btn--primary { background: #6366f1; }
.btn--danger { background: #ef4444; }

.body { flex: 1; position: relative; overflow: hidden; }
.map { position: absolute; inset: 0; }

.progress { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1300; background: rgba(99, 102, 241, 0.95); color: #fff; padding: 8px 16px; border-radius: 999px; font-size: 14px; font-weight: 600; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3); }

.banner { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1200; background: rgba(17, 17, 17, 0.85); color: #fff; padding: 8px 14px; border-radius: 999px; font-size: 14px; display: flex; align-items: center; gap: 10px; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3); }
.banner__cancel { border: none; background: rgba(255, 255, 255, 0.25); color: #fff; border-radius: 999px; padding: 3px 10px; cursor: pointer; }

.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 340px; max-width: 82vw; z-index: 1200; background: rgba(255, 255, 255, 0.72); backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); box-shadow: -2px 0 24px rgba(0, 0, 0, 0.22); padding: 16px; overflow-y: auto; }
.drawer__close { position: absolute; top: 10px; right: 10px; border: none; background: #f1f1f4; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 14px; }
.drawer__img { width: 100%; border-radius: 10px; display: block; margin-top: 24px; }
.drawer__date { color: #666; font-size: 13px; margin: 10px 0; }
.drawer__note { width: 100%; min-height: 100px; border: 1px solid #e2e2e8; border-radius: 10px; padding: 10px; font-size: 14px; resize: vertical; font-family: inherit; }
.drawer__actions { display: flex; gap: 10px; margin-top: 12px; }

.review { position: absolute; top: 0; left: 0; bottom: 0; width: 300px; max-width: 82vw; z-index: 1200; background: rgba(255, 255, 255, 0.72); backdrop-filter: blur(16px) saturate(1.3); -webkit-backdrop-filter: blur(16px) saturate(1.3); box-shadow: 2px 0 24px rgba(0, 0, 0, 0.22); padding: 14px; overflow-y: auto; }
.review__head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.review__title { font-weight: 700; font-size: 16px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.chip { border: 1px solid #d9d9e3; background: #fff; color: #444; border-radius: 999px; padding: 4px 12px; font-size: 13px; cursor: pointer; }
.chip--on { background: #6366f1; color: #fff; border-color: #6366f1; }
.trips { display: flex; flex-direction: column; gap: 8px; }
.trips__empty { color: #999; font-size: 13px; padding: 12px 0; }
.trip { border: 1px solid #eee; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
.trip:hover { background: #f7f7fb; }
.trip__range { font-weight: 600; font-size: 14px; color: #333; }
.trip__meta { font-size: 12px; color: #777; margin-top: 4px; }

.tray { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1100; background: rgba(255, 255, 255, 0.7); backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); border-top: 1px solid rgba(255, 255, 255, 0.5); padding: 8px 12px; }
.tray__hint { font-size: 12px; color: #888; }
.tray__list { display: flex; gap: 8px; overflow-x: auto; padding-top: 6px; }
.tray__item { position: relative; flex-shrink: 0; }
.tray__item img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; }
.tray__item--active img { border-color: #6366f1; }
.tray__del { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: none; background: #ef4444; color: #fff; font-size: 12px; line-height: 1; cursor: pointer; }

.photo-pin img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 2px solid #fff; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.5); transition: transform 0.15s ease; animation: pin-drop 0.35s ease both; }
.photo-pin img:hover { transform: scale(1.18); }
.photo-pin__wrap { position: relative; width: 48px; height: 48px; }
.photo-pin__badge { position: absolute; top: -6px; right: -6px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 999px; background: #6366f1; color: #fff; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4); }
.leaflet-marker-icon:hover { z-index: 1000 !important; }

/* 聚合气泡：照片封面 + 数字角标 */
.cluster-pin__wrap { position: relative; width: 56px; height: 56px; }
.cluster-pin__wrap img { width: 56px; height: 56px; object-fit: cover; border-radius: 12px; border: 2px solid #fff; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.55); }
.cluster-pin__badge { position: absolute; top: -6px; right: -6px; min-width: 22px; height: 22px; padding: 0 6px; border-radius: 999px; background: #6366f1; color: #fff; font-size: 12px; font-weight: 700; display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 5px rgba(0, 0, 0, 0.4); }

@keyframes pin-drop { from { transform: translateY(-12px) scale(0.6); opacity: 0; } to { transform: none; opacity: 1; } }

/* 悬浮功能按钮 */
.fabs { position: absolute; right: 16px; bottom: 34px; z-index: 1100; display: flex; flex-direction: column; gap: 10px; }
.fab { width: 46px; height: 46px; border-radius: 50%; border: none; cursor: pointer; font-size: 18px; background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(10px); box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3); display: flex; align-items: center; justify-content: center; transition: transform 0.12s; }
.fab:hover { transform: scale(1.08); }
.fab--on { background: #a855f7; }
.fab--play { background: linear-gradient(135deg, #6366f1, #a855f7); color: #fff; }

/* 旅程回放浮层 */
.playback { position: absolute; left: 50%; bottom: 30px; transform: translateX(-50%); z-index: 1300; display: flex; align-items: center; gap: 12px; background: rgba(20, 20, 24, 0.82); backdrop-filter: blur(14px); color: #fff; padding: 10px 14px; border-radius: 16px; box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4); max-width: 92vw; }
.playback__img { width: 56px; height: 56px; object-fit: cover; border-radius: 10px; }
.playback__info { min-width: 0; }
.playback__date { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.playback__prog { font-size: 12px; opacity: 0.7; margin-top: 2px; }
.playback__stop { border: none; background: rgba(255, 255, 255, 0.2); color: #fff; border-radius: 999px; padding: 6px 12px; font-size: 13px; cursor: pointer; white-space: nowrap; }

/* 数据看板 */
.modal { position: absolute; inset: 0; z-index: 1400; background: rgba(0, 0, 0, 0.45); display: flex; align-items: center; justify-content: center; }
.dash { position: relative; width: 340px; max-width: 88vw; background: rgba(255, 255, 255, 0.92); backdrop-filter: blur(18px); border-radius: 20px; padding: 24px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35); text-align: center; }
.dash__title { font-size: 16px; font-weight: 700; color: #333; }
.dash__km { margin-top: 16px; font-size: 52px; font-weight: 900; background: linear-gradient(135deg, #6366f1, #a855f7); -webkit-background-clip: text; background-clip: text; color: transparent; }
.dash__km span { font-size: 22px; }
.dash__kmlabel { font-size: 13px; color: #888; margin-bottom: 18px; }
.dash__grid { display: flex; gap: 10px; margin-bottom: 16px; }
.dash__cell { flex: 1; background: rgba(99, 102, 241, 0.08); border-radius: 12px; padding: 12px 0; }
.dash__cell b { display: block; font-size: 24px; color: #4f46e5; }
.dash__cell span { font-size: 12px; color: #888; }
.dash__row { display: flex; justify-content: space-between; font-size: 14px; padding: 8px 2px; border-top: 1px solid #eee; }
.dash__row span { color: #888; }
.dash__row b { color: #333; }

/* 搜索框 */
.search { width: 150px; border: none; border-radius: 999px; padding: 6px 12px; font-size: 13px; background: rgba(255, 255, 255, 0.9); outline: none; }

/* 去年今日 */
.memories { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); z-index: 1150; background: linear-gradient(135deg, #f59e0b, #ef4444); color: #fff; padding: 8px 16px; border-radius: 999px; font-size: 13px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3); }
.memories:hover { filter: brightness(1.05); }

/* 全屏 lightbox */
.lb { position: absolute; inset: 0; z-index: 1500; background: rgba(0, 0, 0, 0.9); display: flex; align-items: center; justify-content: center; }
.lb__img { max-width: 92vw; max-height: 82vh; border-radius: 8px; box-shadow: 0 8px 40px rgba(0, 0, 0, 0.6); }
.lb__close { position: absolute; top: 16px; right: 20px; z-index: 2; width: 40px; height: 40px; border-radius: 50%; border: none; background: rgba(255, 255, 255, 0.15); color: #fff; font-size: 18px; cursor: pointer; }
.lb__nav { position: absolute; top: 50%; transform: translateY(-50%); z-index: 2; width: 52px; height: 52px; border-radius: 50%; border: none; background: rgba(255, 255, 255, 0.15); color: #fff; font-size: 30px; cursor: pointer; }
.lb__prev { left: 16px; }
.lb__next { right: 16px; }
.lb__nav:hover, .lb__close:hover { background: rgba(255, 255, 255, 0.3); }
.lb__cap { position: absolute; bottom: 24px; left: 50%; transform: translateX(-50%); max-width: 90vw; text-align: center; color: #fff; font-size: 14px; background: rgba(0, 0, 0, 0.4); padding: 8px 16px; border-radius: 12px; }
.lb__idx { opacity: 0.7; }
.lb__note { margin-top: 6px; font-size: 13px; opacity: 0.9; }

/* 相册网格 */
.album { position: absolute; inset: 0; z-index: 1450; background: rgba(20, 20, 24, 0.96); display: flex; flex-direction: column; }
.album__head { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; color: #fff; }
.album__title { font-size: 16px; font-weight: 700; }
.album__grid { flex: 1; overflow-y: auto; padding: 0 12px 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.album__grid img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; cursor: pointer; transition: transform 0.12s; }
.album__grid img:hover { transform: scale(1.04); }

/* 浅色主题：底图变亮时，面板略加不透明度以保证对比 */
.app.theme-light .drawer, .app.theme-light .review, .app.theme-light .tray { background: rgba(255, 255, 255, 0.86); }

/* 空状态引导 */
.empty { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 500; text-align: center; pointer-events: none; background: rgba(0, 0, 0, 0.42); backdrop-filter: blur(6px); color: #fff; padding: 28px 36px; border-radius: 20px; }
.empty__emoji { font-size: 48px; }
.empty__title { font-size: 20px; font-weight: 700; margin-top: 8px; }
.empty__sub { font-size: 13px; opacity: 0.85; margin-top: 6px; }

/* 移动端适配 */
@media (max-width: 640px) {
  .topbar { height: auto; flex-wrap: wrap; padding: 8px 12px; gap: 6px; }
  .topbar__right { flex-wrap: wrap; gap: 6px; }
  .topbar__title { font-size: 15px; }
  .topbar__stat { font-size: 11px; }
  .search { width: 120px; }
  .btn { padding: 6px 9px; font-size: 12px; }
  .drawer, .review { width: 100%; max-width: 100%; }
  .album__grid { grid-template-columns: repeat(auto-fill, minmax(88px, 1fr)); }
  .fabs { right: 12px; bottom: 24px; }
  .fab { width: 42px; height: 42px; font-size: 16px; }
  .playback { max-width: 94vw; }
}
</style>
