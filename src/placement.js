function markerBlockOrder(blockKeys, markerKey, mediaKey, removeMarkerBlock = false) {
  const keys = Array.from(blockKeys || []);
  if (!markerKey || !mediaKey || markerKey === mediaKey) return keys;
  const ordered = [];
  let placed = false;
  for (const key of keys) {
    if (key === mediaKey) continue;
    if (key === markerKey) {
      ordered.push(mediaKey);
      placed = true;
      if (!removeMarkerBlock) ordered.push(key);
      continue;
    }
    ordered.push(key);
  }
  return placed ? ordered : [...ordered, mediaKey];
}
