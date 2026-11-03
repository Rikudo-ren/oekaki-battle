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
