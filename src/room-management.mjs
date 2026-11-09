export const ABANDONED_AFTER_MS = 5 * 60 * 1000;
// Skip only once the presence system has recorded a disconnect.
export const DRAWER_ABSENT_AFTER_MS = 0;

export function isOnline(room, uid) {
  return !!room?.online?.[uid] && Object.keys(room.online[uid]).length > 0;
}
export function onlinePlayers(room) {
  return Object.keys(room?.players || {}).filter(uid => isOnline(room, uid)).sort();
}
export function isAbandoned(room, now) {
  return !!room && !Object.keys(room.online || {}).length &&
    Number.isFinite(room.lastOnline) && now >= room.lastOnline + ABANDONED_AFTER_MS;
}
export function canSkipAbsentDrawer(room, now) {
  const disconnected = room?.lastDisconnects?.[room?.drawer];
  return room?.phase === 'playing' && !isOnline(room, room.drawer) &&
    Number.isFinite(disconnected) && now >= disconnected + DRAWER_ABSENT_AFTER_MS;
}
