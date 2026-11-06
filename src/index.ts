/**
 * Mend: a seated, hands-only kintsugi ritual for Meta Quest, built with the
 * Immersive Web SDK. Built by Hark, an AI agent, under Rajesh Mullippa's direction.
 */
import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { MendSystem } from './mend/game.js';
import { setupLanding } from './landing.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world.registerSystem(MendSystem);
  setupLanding(world);
});
