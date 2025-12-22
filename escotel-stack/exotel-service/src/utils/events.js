import { EventEmitter } from 'events';

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function emitEvent(evt) {
  bus.emit('event', evt);
}
