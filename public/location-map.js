const tileSize = 256;
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const project = (latitude, longitude, zoom) => {
  const scale = tileSize * 2 ** zoom;
  const lat = clamp(latitude, -85.0511, 85.0511) * Math.PI / 180;
  return { x: (longitude + 180) / 360 * scale, y: (1 - Math.asinh(Math.tan(lat)) / Math.PI) / 2 * scale };
};
const unproject = (x, y, zoom) => {
  const scale = tileSize * 2 ** zoom;
  return { latitude: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI, longitude: ((x / scale * 360) % 360 + 360) % 360 - 180 };
};

export function createLocationMap({ element, tiles, onSelect = null, interactive = true, initialZoom = 2 }) {
  let center = { latitude: 20, longitude: 0 };
  let zoom = initialZoom;
  let active = false;
  let drag = null;
  function render() {
    if (!active) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const point = project(center.latitude, center.longitude, zoom);
    const left = point.x - rect.width / 2, top = point.y - rect.height / 2;
    const firstX = Math.floor(left / tileSize), lastX = Math.floor((left + rect.width) / tileSize);
    const firstY = Math.floor(top / tileSize), lastY = Math.floor((top + rect.height) / tileSize);
    const count = 2 ** zoom;
    const fragment = document.createDocumentFragment();
    for (let y = firstY; y <= lastY; y++) for (let x = firstX; x <= lastX; x++) {
      if (y < 0 || y >= count) continue;
      const img = document.createElement("img");
      img.alt = "";
      img.draggable = false;
      img.loading = "lazy";
      img.src = `https://tile.openstreetmap.org/${zoom}/${((x % count) + count) % count}/${y}.png`;
      img.style.left = `${x * tileSize - left}px`;
      img.style.top = `${y * tileSize - top}px`;
      fragment.append(img);
    }
    tiles.replaceChildren(fragment);
  }
  function setCenter(latitude, longitude) {
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    center = { latitude: clamp(latitude, -85.0511, 85.0511), longitude: clamp(longitude, -180, 180) };
    render();
  }
  function setZoom(next) { zoom = clamp(next, 2, 16); render(); }
  if (interactive) element.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest("button,a")) return;
    drag = { x: event.clientX, y: event.clientY, center: project(center.latitude, center.longitude, zoom), moved: false };
    element.setPointerCapture(event.pointerId);
  });
  if (interactive) element.addEventListener("pointermove", (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) drag.moved = true;
    if (!drag.moved) return;
    center = unproject(drag.center.x - dx, drag.center.y - dy, zoom);
    render();
  });
  if (interactive) element.addEventListener("pointerup", (event) => {
    if (!drag) return;
    const moved = drag.moved;
    drag = null;
    if (!moved) {
      const rect = element.getBoundingClientRect(), point = project(center.latitude, center.longitude, zoom);
      center = unproject(point.x + event.clientX - rect.left - rect.width / 2, point.y + event.clientY - rect.top - rect.height / 2, zoom);
      onSelect?.(center);
      render();
    }
  });
  if (interactive) element.addEventListener("pointercancel", () => { drag = null; });
  if (interactive) element.addEventListener("keydown", (event) => {
    if (event.target !== element) return;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(center); }
  });
  const resizeObserver = new ResizeObserver(() => render());
  resizeObserver.observe(element);
  return { open() { active = true; render(); }, setCenter, setZoom: (delta) => setZoom(zoom + delta), render };
}
