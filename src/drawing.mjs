// Rebuild the visible drawing from the ordered, append-only room event log.
// Older stroke records have no action field and remain valid.
export function reduceDrawingEvents(events) {
  let strokes = [];
  for (const event of events) {
    if (!event || typeof event !== 'object') continue;
    if (event.action === 'clear') strokes = [];
    else if (event.action === 'undo') strokes.pop();
    else if (typeof event.points === 'string' && typeof event.color === 'string' && typeof event.width === 'number') strokes.push(event);
  }
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
