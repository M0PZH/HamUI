// Keeps --ham-range-p in sync so .ham-range shows its filled portion.
export function syncRange(input) {
  const min = Number(input.min || 0), max = Number(input.max || 100);
  const p = ((Number(input.value) - min) / (max - min || 1)) * 100;
  input.style.setProperty('--ham-range-p', `${p}%`);
}

export function bindRanges(root = document) {
  root.querySelectorAll?.('input.ham-range').forEach(syncRange);
  const on = (e) => { if (e.target.matches?.('input.ham-range')) syncRange(e.target); };
  root.addEventListener('input', on);
  return () => root.removeEventListener('input', on);
}
