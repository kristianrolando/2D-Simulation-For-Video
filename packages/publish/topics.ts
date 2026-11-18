// What each scene is really about, written once so every title, description and tag stays true to the video.
// Pure data (no DOM, no fs). The copywriter fills the {placeholders} from the video's own parameters and drops
// any sentence whose placeholder it cannot fill, so a text never contains a number the video does not have.
//
// Rule for everything in this file: describe only what the simulation really shows. No "impossible", no
// "you won't believe", no outcome the physics does not produce. `quality.ts` enforces the same rule on edited texts.

export const TITLE_STYLES = ['question', 'stakes', 'number', 'curious', 'explain'] as const;
export type TitleStyle = typeof TITLE_STYLES[number];
export const TITLE_STYLE_LABEL: Record<TitleStyle, string> = {
  question: 'Direct question', stakes: 'What is at stake', number: 'Starts with a number', curious: 'Curious statement', explain: 'How / why explainer',
};

export interface Topic {
  key: string;
  /** the main search phrase: it must appear in every title and in the first line of the description */
  keyword: string;
  /** every phrase that counts as "the keyword is there" (lower case, matched as a substring) */
  keywords: string[];
  emoji: string;
  /** one sentence that contains the keyword; it follows the hook in the description's first line */
  lead: string;
  /** plain, true sentences about what happens (placeholders allowed) */
  mechanic: string[];
  /** short "what was set" line (placeholders allowed), shown in some description layouts */
  setup?: string;
  /** two variants per style; a variant with a placeholder the video cannot fill is skipped */
  titles: Record<TitleStyle, string[]>;
  tags: string[];
  /** the two topic hashtags that go with #Shorts */
  hash: [string, string];
  /** words this video truthfully shows; claims outside this set are flagged by the checker */
  vocab: string[];
}

const T = (t: Topic): Topic => t;

export const TOPICS: Record<string, Topic> = {
  'galton-board': T({
    key: 'galton-board', keyword: 'bell curve', keywords: ['bell curve', 'galton board', 'normal distribution'], emoji: '🔔',
    lead: 'A Galton board turns pure chance into a bell curve.',
    mechanic: ['Every ball bounces left or right at random on each peg, and the piles at the bottom grow into a bell curve.', 'Each bounce is random, yet the piles follow the shape that probability predicts.'],
    setup: '{n} balls falling through {rows} rows of pegs',
    titles: {
      question: ['Can pure chance draw a bell curve?', 'Will {n} random balls form a bell curve?'],
      stakes: ['Every peg is a coin flip. Will a bell curve appear?', 'Will chance alone build a bell curve in {rows} rows?'],
      number: ['{n} balls, {rows} rows of pegs: a bell curve?', '{n} random balls vs. one bell curve'],
      curious: ['Random bounces that add up to a bell curve', 'Chaos on every peg, a bell curve at the bottom'],
      explain: ['Galton board: why random balls make a bell curve', 'Why does chance draw a bell curve? The Galton board'],
    },
    tags: ['galton board', 'bell curve', 'normal distribution', 'probability', 'statistics', 'randomness', 'central limit theorem', 'binomial distribution', 'probability simulation'],
    hash: ['#probability', '#math'], vocab: ['ball', 'balls', 'peg', 'pegs', 'random', 'chance', 'probability', 'curve', 'bell', 'statistics', 'galton', 'distribution', 'coin'],
  }),
  'gravity-bounce': T({
    key: 'gravity-bounce', keyword: 'butterfly effect', keywords: ['butterfly effect', 'chaos', 'bouncing balls'], emoji: '🦋',
    lead: 'The butterfly effect, shown with bouncing balls under gravity.',
    mechanic: ['{n} balls start almost exactly on top of each other inside a circle and fall under gravity.', 'The gap between them is tiny (about {gap} pixels), yet every bounce magnifies it until the balls go their separate ways.'],
    setup: '{n} balls, starting gap of about {gap} pixels',
    titles: {
      question: ['Will these bouncing balls ever separate?', 'Can a tiny gap split {n} bouncing balls apart?'],
      stakes: ['One tiny gap, {n} balls: how long until chaos?', 'How long until chaos pulls them apart?'],
      number: ['{n} balls, a gap of {gap} px: the butterfly effect', '{n} bouncing balls, one tiny gap'],
      curious: ['A gap too small to see, and then chaos', 'Same start, same rules, different ending: chaos'],
      explain: ['The butterfly effect, explained with bouncing balls', 'Why tiny differences grow: chaos in a circle'],
    },
    tags: ['butterfly effect', 'chaos theory', 'chaos', 'bouncing balls', 'sensitive dependence', 'gravity', 'physics simulation', 'deterministic chaos', 'ball physics'],
    hash: ['#chaos', '#physics'], vocab: ['ball', 'balls', 'bounce', 'bouncing', 'gravity', 'chaos', 'butterfly', 'circle', 'tiny', 'gap', 'separate'],
  }),
  billiard: T({
    key: 'billiard', keyword: 'billiard path', keywords: ['billiard', 'bounce', 'path'], emoji: '🎱',
    lead: 'A single billiard path bouncing inside a {shape}.',
    mechanic: ['One ball bounces off the walls of a {shape}, always leaving at the mirror angle, and it leaves a trail behind it.', 'Whether the path ever closes depends only on where it starts and how it turns, and the video shows exactly what happens.'],
    setup: 'a {shape} table, up to {max} bounces',
    titles: {
      question: ['Will this billiard path ever close?', 'Does a ball in a {shape} ever retrace its path?'],
      stakes: ['One ball, endless bounces: does the billiard path close?', 'Will the billiard ball find its way back to the start?'],
      number: ['{max} bounces in a {shape}: does the path close?', '{max} bounces, one billiard path'],
      curious: ['A billiard path that may never close', 'Straight lines and mirror bounces draw this path'],
      explain: ['Billiard paths in a {shape}: when does the path close?', 'How a bouncing ball draws a billiard path'],
    },
    tags: ['billiards', 'billiard path', 'billiard ball', 'bouncing ball', 'geometry', 'math puzzle', 'periodic orbit', 'mathematical billiards', 'golden ratio'],
    hash: ['#geometry', '#math'], vocab: ['ball', 'bounce', 'bounces', 'billiard', 'billiards', 'path', 'circle', 'triangle', 'square', 'trail', 'close', 'closes', 'geometry', 'angle'],
  }),
  'focal-reflection': T({
    key: 'focal-reflection', keyword: 'focal point', keywords: ['focal point', 'focus', 'mirror', 'reflection'], emoji: '🔭',
    lead: 'Waves of balls bounce off a {mirror} mirror and meet at its focal point.',
    mechanic: ['Rows of balls bounce off a {mirror} mirror and are steered toward one spot, the focal point.', 'The mirror shape decides where the balls go, and the video counts every ball as it arrives.'],
    setup: 'a {mirror} mirror',
    titles: {
      question: ['Will every ball reach the same focal point?', 'Where do the balls go after this {mirror} mirror?'],
      stakes: ['One {mirror} mirror, many balls: do they share a focal point?', 'Can a {mirror} mirror send every ball to one spot?'],
      number: ['{waves} waves of balls and one focal point', 'One mirror, one focal point, every ball counted'],
      curious: ['A {mirror} mirror that aims every ball at its focal point', 'Mirror reflection that finds the focal point'],
      explain: ['Why mirrors have a focal point: {mirror} mirror reflection', 'How a {mirror} mirror reflection finds its focus'],
    },
    tags: ['focal point', 'mirror reflection', 'conic section', 'ellipse', 'parabola', 'optics', 'ray reflection', 'ball optics', 'geometry', 'reflection physics'],
    hash: ['#optics', '#physics'], vocab: ['ball', 'balls', 'mirror', 'mirrors', 'reflect', 'reflection', 'focus', 'focal', 'ellipse', 'parabola', 'peanut', 'corner', 'optics', 'wave', 'waves', 'count', 'geometry'],
  }),
  'hammer-smash:split': T({
    key: 'hammer-smash:split', keyword: 'chain reaction', keywords: ['chain reaction', 'smash', 'exponential growth', 'hammer'], emoji: '🔨',
    lead: 'A hammer chain reaction where every crushed ball splits into {k} balls.',
    mechanic: ['Hammers slam out of the walls and every ball they crush splits into {k} balls.', 'The number of balls explodes until the {shape} is full and bursts.'],
    setup: 'start with {n0} ball{s}, each smash turns one ball into {k}, the {shape} bursts at {cap} balls',
    titles: {
      question: ['How many smashes until the {shape} bursts?', 'Can the {shape} hold this chain reaction?'],
      stakes: ['Every smash turns one ball into {k}. When does it burst?', 'One hammer vs. a chain reaction: every ball becomes {k}'],
      number: ['Smash {n0}, get {k}, repeat: how full can it get?', 'One ball becomes {k} per smash: how long until it bursts?'],
      curious: ['The hammer chain reaction that fills the whole {shape}', 'Exponential growth, one hammer swing at a time'],
      explain: ['Why smashing balls fills the {shape}: exponential growth', 'Chain reaction explained: one ball becomes {k} per smash'],
    },
    tags: ['chain reaction', 'exponential growth', 'hammer smash', 'bouncing balls', 'satisfying simulation', 'oddly satisfying', 'ball physics', 'multiplying balls', 'physics simulation'],
    hash: ['#satisfying', '#physics'], vocab: ['ball', 'balls', 'hammer', 'hammers', 'smash', 'crush', 'split', 'bursts', 'burst', 'full', 'container', 'octagon', 'circle', 'square', 'triangle', 'ring', 'growth', 'exponential', 'chain', 'reaction', 'satisfying'],
  }),
  'hammer-smash:box': T({
    key: 'hammer-smash:box', keyword: 'chain reaction', keywords: ['chain reaction', 'bounce', 'hammer', 'bouncing balls'], emoji: '📦',
    lead: 'A hammer chain reaction where every bounce inside the box adds a ball.',
    mechanic: ['Hammers push out of the walls and meet to build a box. Every bounce inside the box adds one more ball.', 'The balls multiply until the walls give way.'],
    setup: 'start with {n0} ball{s}, bursts at {cap} balls',
    titles: {
      question: ['Will the walls hold when every bounce adds a ball?', 'How long until this hammer box bursts?'],
      stakes: ['Trapped balls multiply. Can the box hold the chain reaction?', 'Hammers build a box, every bounce adds a ball: how long?'],
      number: ['{n0} trapped ball{s}, one more per bounce: how long until it bursts?', 'One hammer box, {cap} balls to burst it'],
      curious: ['The hammer box where every bounce adds a ball', 'A chain reaction that starts with one bounce'],
      explain: ['Why trapped bouncing balls multiply: the hammer box', 'Chain reaction in a box: one bounce, one more ball'],
    },
    tags: ['chain reaction', 'bouncing balls', 'hammer box', 'exponential growth', 'satisfying simulation', 'oddly satisfying', 'ball physics', 'multiplying balls', 'physics simulation'],
    hash: ['#satisfying', '#physics'], vocab: ['ball', 'balls', 'hammer', 'hammers', 'box', 'bounce', 'bounces', 'walls', 'burst', 'bursts', 'multiply', 'chain', 'reaction', 'growth', 'exponential', 'satisfying'],
  }),
  'hammer-smash:survive': T({
    key: 'hammer-smash:survive', keyword: 'hammer', keywords: ['hammer', 'survive', 'bouncing balls'], emoji: '🔨',
    lead: 'One hammer against {n0} bouncing ball{s}: crushed balls are gone for good, a lucky wall bounce adds one.',
    mechanic: ['Hammers slam out of the walls and every ball they crush is gone for good.', 'Each bounce off a wall has a chance to add a new ball, so it is a race between the hammer and the luck of the bounces.'],
    setup: '{n0} starting ball{s}, hammers on the walls',
    titles: {
      question: ['Will any bouncing ball survive the hammer?', 'Can {n0} balls outgrow the hammer?'],
      stakes: ['Balls or hammer: who wins this race?', 'Lucky bounces add balls, the hammer removes them: who wins?'],
      number: ['{n0} ball{s} vs. the hammer: will any survive?', '{n0} bouncing ball{s}, one hammer, one winner'],
      curious: ['A hammer that erases bouncing balls for good', 'Lucky bounces against a hammer'],
      explain: ['Hammer vs. bouncing balls: how a lucky bounce changes the race', 'Why some balls survive the hammer and some do not'],
    },
    tags: ['hammer', 'survival', 'bouncing balls', 'probability', 'satisfying simulation', 'oddly satisfying', 'ball physics', 'luck vs hammer', 'physics simulation'],
    hash: ['#satisfying', '#physics'], vocab: ['ball', 'balls', 'hammer', 'hammers', 'crush', 'survive', 'luck', 'lucky', 'bounce', 'bounces', 'wall', 'walls', 'race', 'satisfying', 'chance', 'probability'],
  }),
  harmonograph: T({
    key: 'harmonograph', keyword: 'harmonograph', keywords: ['harmonograph', 'pendulum', 'lissajous'], emoji: '🌀',
    lead: 'A harmonograph draws a pattern from two pairs of swinging pendulums.',
    mechanic: ['Two pairs of damped pendulums steer one pen, one pair for left-right and one pair for up-down.', 'A frequency ratio of {a}:{b} draws this figure, and as the swings fade the pattern slowly settles.'],
    setup: 'frequency ratio {a}:{b}',
    titles: {
      question: ['What does a {a}:{b} harmonograph draw?', 'What do two swinging pendulums draw together?'],
      stakes: ['Two pendulum pairs steer one pen: what shape appears?', 'Will this harmonograph ever repeat?'],
      number: ['Ratio {a}:{b}: what does this harmonograph draw?', '{a}:{b} pendulums, one pen, one figure'],
      curious: ['A harmonograph that draws with the swing of pendulums', 'Fading pendulum swings that draw a hidden pattern'],
      explain: ['Harmonograph explained: how {a}:{b} pendulums draw a figure', 'How a harmonograph turns pendulum swings into a pattern'],
    },
    tags: ['harmonograph', 'lissajous curve', 'pendulum', 'damped oscillation', 'frequency ratio', 'harmonic motion', 'math art', 'drawing machine', 'physics simulation'],
    hash: ['#physics', '#math'], vocab: ['pendulum', 'pendulums', 'pen', 'swing', 'swings', 'harmonograph', 'lissajous', 'frequency', 'ratio', 'pattern', 'figure', 'damped', 'fade', 'draw', 'draws', 'oscillation'],
  }),
  'pendulum-wave': T({
    key: 'pendulum-wave', keyword: 'pendulum wave', keywords: ['pendulum wave', 'pendulum', 'pendulums'], emoji: '🎵',
    lead: 'A pendulum wave: {n} pendulums of tuned lengths drift apart and line up again.',
    mechanic: ['{n} pendulums are released together, and each one is tuned to swing slightly faster than the one before.', 'They drift out of step into waves and patterns, and at the right moment they line up again.'],
    setup: '{n} pendulums',
    titles: {
      question: ['Will {n} pendulums line up again?', 'Can this pendulum wave sort itself out?'],
      stakes: ['Will the pendulum wave ever line up again?', 'Out of step now: when does the pendulum wave realign?'],
      number: ['{n} pendulums, one pendulum wave: when do they align?', '{n} pendulums drift apart. Do they line up again?'],
      curious: ['A pendulum wave that turns chaos back into a line', 'Pendulums drift into waves, then line up'],
      explain: ['Pendulum wave explained: why they line up again', 'Why a pendulum wave drifts apart and realigns'],
    },
    tags: ['pendulum wave', 'pendulum', 'harmonic motion', 'synchronization', 'wave patterns', 'physics demonstration', 'satisfying physics', 'oscillation', 'physics simulation'],
    hash: ['#physics', '#satisfying'], vocab: ['pendulum', 'pendulums', 'wave', 'waves', 'swing', 'swings', 'line', 'align', 'realign', 'drift', 'sync', 'synchronization', 'tuned', 'satisfying', 'oscillation'],
  }),
  'resonance-orbits': T({
    key: 'resonance-orbits', keyword: 'orbital resonance', keywords: ['orbital resonance', 'resonance', 'orbit'], emoji: '🌸',
    lead: 'Orbital resonance: two planets in a {a}:{b} orbit pattern draw a flower.',
    mechanic: ['Two planets circle a star: in the time the inner one makes {a} orbits, the outer one makes {b}.', 'Joining the two planets with a line over time draws a flower with {petals} petals.'],
    setup: 'inner planet {a} orbits, outer planet {b} orbits',
    titles: {
      question: ['What do {a}:{b} orbits draw?', 'What flower do two planets in orbital resonance draw?'],
      stakes: ['Two planets in orbital resonance, one line between them: which flower appears?', 'Can an orbital resonance draw a flower?'],
      number: ['{a} : {b} orbits: what shape do they draw?', '{a} orbits against {b}: a flower?'],
      curious: ['Orbital resonance that draws a flower', 'Two planets in orbital resonance draw a flower together'],
      explain: ['Orbital resonance explained: how a {a}:{b} orbit draws a flower', 'Why a {a}:{b} resonance makes {petals} petals'],
    },
    tags: ['orbital resonance', 'orbit', 'planets', 'resonance', 'astronomy', 'space', 'string art', 'planetary orbits', 'math art', 'physics simulation'],
    hash: ['#space', '#astronomy'], vocab: ['planet', 'planets', 'orbit', 'orbits', 'resonance', 'flower', 'petal', 'petals', 'star', 'sun', 'line', 'draw', 'draws', 'astronomy', 'space'],
  }),
  'rosette-orbit': T({
    key: 'rosette-orbit', keyword: 'rosette orbit', keywords: ['rosette orbit', 'orbit', 'precession'], emoji: '🪐',
    lead: 'A rosette orbit: an elliptical orbit that turns a little more with every lap.',
    mechanic: ['An elliptical orbit shifts by {deg}° on every lap, so each new lap lands a little further around.', 'After about {turns} laps the shifts add up to a full turn and the orbit closes into a rosette.'],
    setup: '{deg}° of precession per orbit',
    titles: {
      question: ['Will this rosette orbit ever close?', 'How many laps until the rosette orbit closes?'],
      stakes: ['Every lap shifts by {deg}°. When does the orbit close?', 'Will the precession close this orbit?'],
      number: ['{deg}° per lap: when does the rosette orbit close?', 'About {turns} laps to close one rosette orbit'],
      curious: ['An orbit that draws a rosette lap by lap', 'A shifting ellipse that becomes a rosette orbit'],
      explain: ['Rosette orbits explained: precession, lap by lap', 'Why precession turns an orbit into a rosette'],
    },
    tags: ['rosette orbit', 'orbit precession', 'precession', 'planetary orbit', 'ellipse', 'astronomy', 'space', 'orbital mechanics', 'physics simulation'],
    hash: ['#space', '#physics'], vocab: ['orbit', 'orbits', 'rosette', 'precession', 'lap', 'laps', 'ellipse', 'elliptical', 'planet', 'turn', 'close', 'closes', 'astronomy', 'space', 'sun'],
  }),
  'sync-lines:orbits': T({
    key: 'sync-lines:orbits', keyword: 'synchronization', keywords: ['synchronization', 'line up', 'sync', 'laps'], emoji: '⭕',
    lead: 'Synchronization test: {n} dots circle at different speeds and may line up again.',
    mechanic: ['{n} dots start in one line and each one laps at its own pace.', 'Because every pace is different, they spread out, and the video shows when they come back into one line.'],
    setup: '{n} dots, each with its own speed',
    titles: {
      question: ['Will {n} dots ever line up again?', 'Do {n} different speeds ever sync again?'],
      stakes: ['They all start in one line. When do they line up again?', 'How long until the synchronization happens again?'],
      number: ['{n} dots, {n} speeds: will they line up again?', '{n} laps at {n} paces: a synchronization?'],
      curious: ['Different speeds, one perfect line: synchronization', 'A synchronization that takes a while to come back'],
      explain: ['Why different speeds line up again: synchronization', 'How synchronization works with {n} different laps'],
    },
    tags: ['synchronization', 'sync', 'orbit lines', 'laps', 'least common multiple', 'patterns', 'satisfying simulation', 'oddly satisfying', 'math visualization'],
    hash: ['#satisfying', '#math'], vocab: ['dot', 'dots', 'ball', 'balls', 'lap', 'laps', 'speed', 'speeds', 'line', 'sync', 'synchronization', 'orbit', 'circle', 'satisfying', 'pace'],
  }),
  'sync-lines:lid': T({
    key: 'sync-lines:lid', keyword: 'sync', keywords: ['sync', 'lid', 'rhythm', 'bounce'], emoji: '🥁',
    lead: 'Sync check: {n} balls bounce at {n} different rhythms and may hit the lid together.',
    mechanic: ['{n} balls bounce up and down, each with its own rhythm.', 'The video shows whether they ever hit the lid at the same moment.'],
    setup: '{n} balls, {n} rhythms',
    titles: {
      question: ['Can {n} bounce rhythms hit the lid in sync?', 'Will every ball hit the lid at the same time?'],
      stakes: ['Every ball has its own beat. Will they sync at the lid?', 'Different bounces, one lid: do they ever sync?'],
      number: ['{n} balls, {n} rhythms: one shared hit?', '{n} bounce rhythms vs. one lid'],
      curious: ['Different bounce rhythms, one lid, one moment of sync', 'Rhythms that only sync at the lid'],
      explain: ['Why different bounce rhythms can sync at the lid', 'How rhythm works: {n} balls, one lid, sync'],
    },
    tags: ['sync', 'synchronization', 'rhythm', 'bouncing balls', 'lid', 'patterns', 'satisfying simulation', 'oddly satisfying', 'math visualization'],
    hash: ['#satisfying', '#math'], vocab: ['ball', 'balls', 'bounce', 'bounces', 'rhythm', 'rhythms', 'lid', 'sync', 'synchronization', 'beat', 'satisfying', 'time', 'moment'],
  }),
  'sync-lines:slider': T({
    key: 'sync-lines:slider', keyword: 'hidden shape', keywords: ['hidden shape', 'shape', 'curve', 'straight lines'], emoji: '📐',
    lead: 'A hidden shape appears from straight lines: every dot only slides back and forth.',
    mechanic: ['Every dot only slides back and forth along a line, and a new line is drawn every {period} seconds.', 'No curve is drawn on purpose: the shape comes out of the straight lines alone.'],
    setup: 'a new line every {period} seconds',
    titles: {
      question: ['What hidden shape do straight lines draw?', 'What shape hides in these sliding dots?'],
      stakes: ['Only straight lines. So where does the curve come from?', 'Can straight lines hide a curved shape?'],
      number: ['A new line every {period} s: what hidden shape appears?', '{n} dots, straight lines, one hidden shape'],
      curious: ['A curve made only of straight lines', 'A hidden shape that no single line draws'],
      explain: ['How straight lines make a hidden shape', 'Why sliding dots draw a curve: a hidden shape'],
    },
    tags: ['hidden shape', 'straight lines', 'envelope curve', 'string art', 'sliding dots', 'patterns', 'satisfying simulation', 'oddly satisfying', 'math visualization'],
    hash: ['#satisfying', '#math'], vocab: ['dot', 'dots', 'line', 'lines', 'slide', 'slides', 'sliding', 'shape', 'curve', 'hidden', 'straight', 'circle', 'flower', 'satisfying'],
  }),
  'sync-lines:close': T({
    key: 'sync-lines:close', keyword: 'closed loop', keywords: ['closed loop', 'close', 'pen', 'loop'], emoji: '♾️',
    lead: 'A two-arm pen draws a line, and the question is whether it ever makes a closed loop.',
    mechanic: ['Two arms turn at different speeds and a pen at the end draws a line.', 'The speed ratio decides whether the pen ever returns to its start and closes the loop.'],
    setup: 'speed ratio {ratio}',
    titles: {
      question: ['Will this pen ever draw a closed loop?', 'Does the line ever close into a loop?'],
      stakes: ['Two arms, one pen: closed loop or never?', 'Will the pen ever find its start and close the loop?'],
      number: ['Speed ratio {ratio}: does the pen make a closed loop?', 'Two arms, ratio {ratio}: a closed loop?'],
      curious: ['A pen that may never draw a closed loop', 'A line that closes only for the right ratio: closed loop'],
      explain: ['Why only some ratios close the loop: two-arm pen', 'How the speed ratio decides a closed loop'],
    },
    tags: ['closed loop', 'speed ratio', 'irrational numbers', 'rational numbers', 'two arm pen', 'spirograph', 'patterns', 'satisfying simulation', 'math visualization'],
    hash: ['#math', '#satisfying'], vocab: ['pen', 'arm', 'arms', 'line', 'loop', 'close', 'closed', 'closes', 'ratio', 'speed', 'speeds', 'spin', 'draws', 'irrational', 'spirograph'],
  }),
};

/** used when a scene has no entry (a new scene must still get usable, true texts) */
export function genericTopic(sceneName: string, family: string, description: string): Topic {
  const name = sceneName.trim().toLowerCase() || 'simulation';
  return {
    key: 'generic', keyword: name, keywords: [name, family.toLowerCase()], emoji: '✨',
    lead: `${sceneName || 'A simulation'}: ${description || 'a 2D physics simulation.'}`.replace(/\s+/g, ' ').trim(),
    mechanic: [description || 'A 2D simulation computed with exact, deterministic maths.'],
    titles: {
      question: [`What happens in this ${name} simulation?`, `Can you predict this ${name}?`],
      stakes: [`Watch the ${name} until the very end`, `How does this ${name} end?`],
      number: [`${sceneName || 'Simulation'}: one setup, one result`, `One ${name}, watched in full`],
      curious: [`A ${name} that is worth a second look`, `The ${name}, in a satisfying simulation`],
      explain: [`${sceneName || 'Simulation'} explained in a few seconds`, `How the ${name} works`],
    },
    tags: [name, family.toLowerCase(), 'physics simulation', 'math visualization'].filter(Boolean),
    hash: ['#physics', '#math'], vocab: name.split(/\s+/),
  };
}

/** words that make a claim the video must actually back up; flagged by quality.ts when the topic's vocab lacks them */
export const CLAIM_TERMS: Record<string, RegExp> = {
  'black hole': /\bblack\s*holes?\b/i, '3D': /\b3[- ]?d\b/i, fireworks: /\bfireworks?\b/i, galaxy: /\bgalax(y|ies)\b/i,
  moon: /\bmoon\b/i, ASMR: /\basmr\b/i, 'world record': /\brecords?\b/i, 'real footage': /\b(real|actual) (footage|video|camera)\b/i,
  AI: /\b(ai|chatgpt|neural|machine learning)\b/i, earthquake: /\bearthquakes?\b/i, 'solar system': /\bsolar system\b/i,
  money: /\b(money|cash|prize|giveaway|bet|betting|gambl\w*)\b/i,
};
