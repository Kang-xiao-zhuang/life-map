import Dexie from 'dexie';

// 本地 IndexedDB。一条 photo：
// { id, blob(缩略图 Blob), lat, lng, takenAt(Date), note, placed(0/1), createdAt(Date) }
// 没坐标的也存(placed=0，lat/lng 为 null)，Step 5 手动补点用，避免重传。
export const db = new Dexie('life-map');
db.version(1).stores({
  photos: 'id, takenAt, placed', // 这些字段建索引；blob/lat/lng/note 直接存不建索引
});
