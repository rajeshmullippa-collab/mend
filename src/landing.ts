import type { World } from '@iwsdk/core';

/** A quiet 2D landing card for the flat browser; it hides during XR. */
export function setupLanding(world: World) {
  const el = document.getElementById('landing');
  const btn = document.getElementById('enter') as HTMLButtonElement | null;
  if (!el || !btn) return;
  btn.addEventListener('click', () => world.launchXR());
  const xr = world.renderer.xr;
  xr.addEventListener('sessionstart', () => el.classList.add('hidden'));
  xr.addEventListener('sessionend', () => el.classList.remove('hidden'));
  const nav = navigator as Navigator & { xr?: { isSessionSupported(m: string): Promise<boolean> } };
  nav.xr
    ?.isSessionSupported('immersive-ar')
    .then((ok) => {
      if (!ok) {
        btn.textContent = 'Open on Meta Quest to play';
        btn.disabled = true;
      }
    })
    .catch(() => {});
}
