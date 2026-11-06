import { createComponent, Types } from '@iwsdk/core';

/** A broken piece of the day's vessel. `index` points into the shard table. */
export const Shard = createComponent('Shard', {
  index: { type: Types.Int16, default: 0 },
});

/** A pinchable button. `action` names what MendSystem does when it is pressed. */
export const MendButton = createComponent('MendButton', {
  action: { type: Types.String, default: '' },
});
