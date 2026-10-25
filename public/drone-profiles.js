// Manufacturer references checked 2026-10-25. Ratings are not safe operating targets.
const spec = (slug) => `https://www.dji.com/${slug}/specs`;
export const DRONE_PROFILES = Object.freeze([
  { id: "lito-x1", name: "DJI Lito X1", maxWindMps: 10.7, source: "https://www.dji.com/global/lito-x1/specs" },
  { id: "mini-4-pro", name: "DJI Mini 4 Pro", maxWindMps: 10.7, source: spec("mini-4-pro") },
  { id: "mini-3", name: "DJI Mini 3", maxWindMps: 10.7, source: spec("mini-3") },
  { id: "mini-2-se", name: "DJI Mini 2 SE", maxWindMps: 10.7, source: spec("mini-2-se") },
  { id: "mini-4k", name: "DJI Mini 4K", maxWindMps: 10.7, source: spec("mini-2-se") },
  { id: "air-3", name: "DJI Air 3", maxWindMps: 12, source: spec("air-3") },
  { id: "air-3s", name: "DJI Air 3S", maxWindMps: 12, source: spec("air-3s") },
  { id: "mavic-3-pro", name: "DJI Mavic 3 Pro", maxWindMps: 12, source: spec("mavic-3-pro") },
  { id: "mavic-3-classic", name: "DJI Mavic 3 Classic", maxWindMps: 12, source: spec("mavic-3-classic") },
  { id: "neo", name: "DJI Neo", maxWindMps: 8, source: spec("neo") },
  { id: "flip", name: "DJI Flip", maxWindMps: 10.7, source: spec("flip") },
  { id: "avata-2", name: "DJI Avata 2", maxWindMps: 10.7, source: spec("avata-2") },
]);
export function droneProfile(id) {
  return DRONE_PROFILES.find((profile) => profile.id === id) ?? DRONE_PROFILES[0];
}
