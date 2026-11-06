import { defineAssets } from '@iwsdk/core';

// Mend builds every mesh procedurally at runtime (seeded per day), so there
// are no downloaded models or textures in the asset manifest.
export default defineAssets({});
