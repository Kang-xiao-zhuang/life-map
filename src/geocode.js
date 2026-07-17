// 反向地理编码：坐标 → 城市名。用 BigDataCloud（免 key、免费、支持中文，国内一般可访问）。
// Esri 的 geocode 在国内常被墙，故不用。
let last = 0;

export async function reverseCity(lat, lng) {
  const wait = Math.max(0, 400 - (Date.now() - last));
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  try {
    const url =
      'https://api.bigdatacloud.net/data/reverse-geocode-client' +
      `?latitude=${lat}&longitude=${lng}&localityLanguage=zh`;
    const res = await fetch(url);
    const d = await res.json();
    return d.city || d.locality || d.principalSubdivision || '';
  } catch (_) {
    return ''; // 失败留空，不影响其他功能
  }
}
