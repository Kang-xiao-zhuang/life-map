// 生成分享海报(纯 canvas 绘制,不截地图 → 稳,不受瓦片跨域限制)。返回 PNG Blob。
export async function drawPoster(stats, points) {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // 背景渐变
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#6366f1');
  g.addColorStop(0.5, '#8b5cf6');
  g.addColorStop(1, '#a855f7');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '700 60px system-ui, "Microsoft YaHei", sans-serif';
  ctx.fillText('🗺️ 我的人生地图', W / 2, 128);

  if (stats.yearFrom) {
    ctx.font = '400 34px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    const span = stats.yearFrom === stats.yearTo ? `${stats.yearFrom}` : `${stats.yearFrom} — ${stats.yearTo}`;
    ctx.fillText(span, W / 2, 182);
  }

  // 足迹散点(经纬度归一化到框内)
  drawScatter(ctx, points, { x: 90, y: 235, w: W - 180, h: 640 });

  // 统计三连
  const sy = 985;
  drawStat(ctx, W * 0.22, sy, stats.cities, '城市');
  drawStat(ctx, W * 0.5, sy, stats.spots, '足迹');
  drawStat(ctx, W * 0.78, sy, stats.photos, '照片');

  // 城市列表(最多三行)
  if (stats.topCities?.length) {
    ctx.font = '400 30px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    wrapText(ctx, stats.topCities.join('  ·  '), W / 2, 1130, W - 160, 44);
  }

  ctx.font = '400 26px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('life-map', W / 2, H - 46);

  return await new Promise((res) => c.toBlob(res, 'image/png'));
}

function drawScatter(ctx, points, box) {
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(ctx, box.x, box.y, box.w, box.h, 24);
  ctx.fill();
  if (!points.length) return;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const spanLat = maxLat - minLat || 1;
  const spanLng = maxLng - minLng || 1;
  const m = 44;
  for (const p of points) {
    const nx = (p.lng - minLng) / spanLng;
    const ny = (p.lat - minLat) / spanLat;
    const x = box.x + m + nx * (box.w - 2 * m);
    const y = box.y + box.h - m - ny * (box.h - 2 * m); // 纬度大→靠上
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.15)';
    ctx.stroke();
  }
}

function drawStat(ctx, x, y, num, label) {
  ctx.textAlign = 'center';
  ctx.fillStyle = '#fff';
  ctx.font = '800 72px system-ui, sans-serif';
  ctx.fillText(String(num), x, y);
  ctx.font = '400 30px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(label, x, y + 44);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrapText(ctx, text, cx, y, maxW, lh) {
  const chars = [...text];
  const lines = [];
  let line = '';
  for (const ch of chars) {
    if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; }
    else line += ch;
  }
  if (line) lines.push(line);
  lines.slice(0, 3).forEach((ln, i) => ctx.fillText(ln, cx, y + i * lh));
}
