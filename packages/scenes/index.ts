// Scene registry: every scene module the studio and the render worker know about.
import type { SceneModule } from '../core/index.ts';
import focalReflection from './focal-reflection/index.ts';
import rosette from './rosette-orbit/index.ts';
import pendulumWave from './pendulum-wave/index.ts';
import galton from './galton-board/index.ts';
import harmonograph from './harmonograph/index.ts';
import gravityBounce from './gravity-bounce/index.ts';
import resonance from './resonance-orbits/index.ts';
import billiard from './billiard/index.ts';
import hammerSmash from './hammer-smash/index.ts';
import syncLines from './sync-lines/index.ts';

export const SCENES: SceneModule[] = [focalReflection, rosette, pendulumWave, galton, harmonograph, gravityBounce, resonance, billiard, hammerSmash, syncLines];
export const sceneById = (id: string) => SCENES.find(s => s.meta.id === id);
