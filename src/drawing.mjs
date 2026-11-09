// Rebuild the visible drawing from the ordered, append-only room event log.
// Older stroke records have no action field and remain valid.
// Chunks with the same strokeId form one undoable pen stroke. Legacy events
// without an ID remain independent, so old drawings can still be replayed.
export function applyDrawingEvent(strokes, event) {
  if (!event || typeof event !== 'object') return;
  if (event.action === 'clear') { strokes.length = 0; return; }
  if (event.action === 'undo') { strokes.pop(); return; }
  if (typeof event.points !== 'string' || typeof event.color !== 'string' || typeof event.width !== 'number') return;
  const last=strokes[strokes.length-1];
  if (event.strokeId && last?.strokeId === event.strokeId) last.segments.push(event);
  else if (event.strokeId) strokes.push({strokeId:event.strokeId, segments:[event]});
  else strokes.push(event);
}
export function reduceDrawingEvents(events) {
  const strokes=[];
  for (const event of events) applyDrawingEvent(strokes,event);
  return strokes;
}

// Stroke events use the original 900 × 540 logical space across app versions.
export const DRAWING_WIDTH = 900;
export const DRAWING_HEIGHT = 540;
export function pointerToLogical(clientX, clientY, rect) {
  if (!rect.width || !rect.height) return [0, 0];
  const clamp=(value,max)=>Math.max(0,Math.min(max,Math.round(value)));
  return [clamp((clientX-rect.left)*DRAWING_WIDTH/rect.width,DRAWING_WIDTH),clamp((clientY-rect.top)*DRAWING_HEIGHT/rect.height,DRAWING_HEIGHT)];
}
export function logicalToCanvasY(value, canvasHeight) { return value*canvasHeight/DRAWING_HEIGHT; }
