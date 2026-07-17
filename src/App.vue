<template>
  <div class="app">
    <header class="topbar">
      <span class="topbar__title">🗺️ 我的人生地图</span>
      <div class="topbar__right">
        <span class="topbar__stat">城市 {{ cityCount }} · 足迹 {{ placed.length }} · 待定位 {{ pending.length }}</span>
        <label class="btn">➕ 上传<input type="file" accept="image/*" multiple hidden @change="onFiles" /></label>
        <label class="btn">📁 文件夹<input type="file" accept="image/*" webkitdirectory multiple hidden @change="onFiles" /></label>
        <label class="btn btn--ghost">📥 导入<input type="file" accept="application/json,.json" hidden @change="onImport" /></label>
        <button class="btn btn--ghost" @click="reviewOpen = !reviewOpen">🕐 回顾</button>
        <button class="btn btn--ghost" @click="onPoster">🖼️ 海报</button>
        <button class="btn btn--ghost" @click="onExport">📤 导出</button>
        <button class="btn btn--danger" @click="clearAll">🧹 清空</button>
      </div>
    </header>

    <div class="body" @dragover.prevent @drop.prevent="onDrop">
      <div ref="mapEl" class="map"></div>

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
        <img :src="selected.url" class="drawer__img" />
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
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount, ref, computed, watch } from 'vue';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import exifr from 'exifr';
import heic2any from 'heic2any';
import { db } from './db.js';
import { reverseCity } from './geocode.js';
import { drawPoster } from './poster.js';

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

let map;
let markersLayer;
const markers = new Map(); // id → L.marker

onMounted(async () => {
  map = L.map(mapEl.value, { zoomControl: true }).setView([32.0, 108.0], 4);
  const esriStreet = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: '&copy; Esri' },
  );
  const esriImagery = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: '&copy; Esri' },
  );
  esriStreet.addTo(map);
  L.control.layers({ '街道图': esriStreet, '卫星图': esriImagery }, {}, { collapsed: false }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
  map.on('click', onMapClick);
  setTimeout(() => map.invalidateSize(), 200);

  await reload();
});

onBeforeUnmount(() => {
  if (map) map.remove();
});

async function reload() {
  markersLayer.clearLayers();
  markers.clear();
  placed.value = [];
  pending.value = [];
  const all = await db.photos.orderBy('takenAt').toArray();
  for (const rec of all) {
    const url = URL.createObjectURL(rec.blob);
    if (Number.isFinite(rec.lat) && Number.isFinite(rec.lng)) {
      const p = { id: rec.id, lat: rec.lat, lng: rec.lng, takenAt: rec.takenAt, note: rec.note || '', city: rec.city, url };
      placed.value.push(p);
      addMarker(p);
    } else {
      pending.value.push({ id: rec.id, takenAt: rec.takenAt, note: rec.note || '', url });
    }
  }
  fitToPhotos();
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
        const p = { id: rec.id, lat: rec.lat, lng: rec.lng, takenAt, note: '', url };
        placed.value.push(p);
        addMarker(p);
      } else {
        pending.value.push({ id: rec.id, takenAt, note: '', url });
      }
    } catch (err) {
      console.error('处理失败：', file.name, err);
    }
    busy.value.done++;
  }
  busy.value = null;
  fitToPhotos();
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
  p.lat = e.latlng.lat;
  p.lng = e.latlng.lng;
  await db.photos.update(id, { lat: p.lat, lng: p.lng, placed: 1 });
  pending.value.splice(idx, 1);
  placed.value.push(p);
  addMarker(p);
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
  await db.photos.delete(id);
  const m = markers.get(id);
  if (m) { markersLayer.removeLayer(m); markers.delete(id); }
  placed.value = placed.value.filter((x) => x.id !== id);
  pending.value = pending.value.filter((x) => x.id !== id);
  if (selected.value?.id === id) selected.value = null;
  if (placingId.value === id) placingId.value = null;
}

async function clearAll() {
  if (!confirm('确定清空所有照片和足迹？此操作不可撤销（建议先「导出」备份）。')) return;
  await db.photos.clear();
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
    const items = [];
    for (const r of all) {
      items.push({
        id: r.id, lat: r.lat, lng: r.lng,
        takenAt: r.takenAt, note: r.note || '', city: r.city, placed: r.placed, createdAt: r.createdAt,
        image: await blobToDataUrl(r.blob),
      });
    }
    const json = JSON.stringify({ app: 'life-map', version: 1, photos: items });
    download(new Blob([json], { type: 'application/json' }), `life-map-备份-${stamp()}.json`);
  } catch (e) {
    alert('导出失败：' + (e?.message || e));
  }
}

async function onImport(e) {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
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
    await reload();
    alert('导入完成');
  } catch (err) {
    alert('导入失败：' + err.message);
  }
}

// ---- 地图/工具 ----
function addMarker(p) {
  const m = L.marker([p.lat, p.lng], { icon: photoIcon(p.url) });
  m.on('click', () => openDetail(p));
  m.addTo(markersLayer);
  markers.set(p.id, m);
}

function photoIcon(url) {
  return L.divIcon({ className: 'photo-pin', html: `<img src="${url}" alt="" />`, iconSize: [48, 48], iconAnchor: [24, 24] });
}

function fitToPhotos() {
  const list = visiblePlaced.value;
  if (list.length) {
    map.fitBounds(L.latLngBounds(list.map((p) => [p.lat, p.lng])), { maxZoom: 12, padding: [60, 60] });
  }
}

function yearOf(d) { return (d instanceof Date ? d : new Date(d)).getFullYear(); }
function ts(d) { return (d instanceof Date ? d : new Date(d)).getTime(); }

// 按当前年份筛选重绘钉子
function renderMarkers() {
  markersLayer.clearLayers();
  markers.clear();
  for (const p of visiblePlaced.value) addMarker(p);
  fitToPhotos();
}

function selectYear(y) { selectedYear.value = y; }

function zoomTo(photos) {
  if (!photos.length) return;
  map.fitBounds(L.latLngBounds(photos.map((p) => [p.lat, p.lng])), { maxZoom: 13, padding: [60, 60] });
  reviewOpen.value = false;
}

async function onPoster() {
  try {
    const pts = placed.value.map((p) => ({ lat: p.lat, lng: p.lng }));
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
      pts,
    );
    download(blob, `life-map-海报-${stamp()}.png`);
  } catch (e) {
    alert('生成海报失败：' + (e?.message || e));
  }
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

.drawer { position: absolute; top: 0; right: 0; bottom: 0; width: 340px; max-width: 82vw; z-index: 1200; background: #fff; box-shadow: -2px 0 16px rgba(0, 0, 0, 0.18); padding: 16px; overflow-y: auto; }
.drawer__close { position: absolute; top: 10px; right: 10px; border: none; background: #f1f1f4; width: 30px; height: 30px; border-radius: 50%; cursor: pointer; font-size: 14px; }
.drawer__img { width: 100%; border-radius: 10px; display: block; margin-top: 24px; }
.drawer__date { color: #666; font-size: 13px; margin: 10px 0; }
.drawer__note { width: 100%; min-height: 100px; border: 1px solid #e2e2e8; border-radius: 10px; padding: 10px; font-size: 14px; resize: vertical; font-family: inherit; }
.drawer__actions { display: flex; gap: 10px; margin-top: 12px; }

.review { position: absolute; top: 0; left: 0; bottom: 0; width: 300px; max-width: 82vw; z-index: 1200; background: #fff; box-shadow: 2px 0 16px rgba(0, 0, 0, 0.18); padding: 14px; overflow-y: auto; }
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

.tray { position: absolute; left: 0; right: 0; bottom: 0; z-index: 1100; background: rgba(255, 255, 255, 0.96); border-top: 1px solid #e6e6ea; padding: 8px 12px; }
.tray__hint { font-size: 12px; color: #888; }
.tray__list { display: flex; gap: 8px; overflow-x: auto; padding-top: 6px; }
.tray__item { position: relative; flex-shrink: 0; }
.tray__item img { width: 56px; height: 56px; object-fit: cover; border-radius: 8px; border: 2px solid transparent; cursor: pointer; }
.tray__item--active img { border-color: #6366f1; }
.tray__del { position: absolute; top: -6px; right: -6px; width: 18px; height: 18px; border-radius: 50%; border: none; background: #ef4444; color: #fff; font-size: 12px; line-height: 1; cursor: pointer; }

.photo-pin img { width: 48px; height: 48px; object-fit: cover; border-radius: 8px; border: 2px solid #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.45); }
</style>
