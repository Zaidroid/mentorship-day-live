// Shared lists for scripts/baseline.cjs and scripts/probe.cjs.
// Wall sizes: the wall (2:1), full HD, and a wide strip.
const SIZES = ['3840x1920', '1920x1080', '3840x1080'];
const THEMES = ['light', 'dark'];
// Fake clock values for the wall (the t= URL option).
const TIMES = ['09:40', '10:02', '10:45', '10:55:02', '11:20', '14:10'];
// Every scene id that can be held with scene=
const SCENES = ['rooms', 'choose', 'board', 'meet', 'photos', 'poll', 'pulse', 'way', 'spotlight', 'advisors', 'welcome', 'speaker', 'video', 'recap', 'thanks', 'survey'];
// Fake time used when a scene is held.
const SCENE_TIME = '11:20';

const timeTag = t => 't' + t.replace(/:/g, '');
// The Welcome scene has two variants for the look gate (WP4 task 5): b is the default, a is ?v=a.
const VARIANT_VIEWS = [{ t: '09:40', v: 'a' }];
const wallUrl = (opts) => {
  const p = ['t=' + opts.t, 'quiet'];
  if (opts.scene) p.push('scene=' + opts.scene);
  if (opts.theme === 'dark') p.push('theme=dark');
  if (opts.v) p.push('v=' + opts.v);
  return '/screen/?' + p.join('&');
};
const sizeOf = s => { const [w, h] = s.split('x').map(Number); return { width: w, height: h }; };

// One entry per wall view: { name, url, size }
function wallViews() {
  const out = [];
  for (const size of SIZES) for (const theme of THEMES) {
    for (const t of TIMES) out.push({ name: `wall_${size}_${theme}_${timeTag(t)}`, url: wallUrl({ t, theme }), size });
    for (const scene of SCENES) out.push({ name: `wall_${size}_${theme}_scene-${scene}`, url: wallUrl({ t: SCENE_TIME, theme, scene }), size });
    for (const x of VARIANT_VIEWS) out.push({ name: `wall_${size}_${theme}_${timeTag(x.t)}_v${x.v}`, url: wallUrl({ t: x.t, theme, v: x.v }), size });
  }
  return out;
}

// Opens a wall view and waits for it to settle (about 4.9 s in all, past the first
// state answers and the scene entrance). theme= in the URL wins over cfg.theme from the
// server, so no key press is needed. Returns null, or the mismatch when the page shows
// another theme than the URL asked for, so callers can report it.
async function openWall(page, base, v) {
  await page.goto(base + v.url);
  await page.waitForTimeout(4900);
  const want = /[?&]theme=dark\b/.test(v.url) ? 'dark' : 'light';
  const got = await page.evaluate(() => document.documentElement.dataset.theme);
  return got === want ? null : `theme is ${got}, wanted ${want}`;
}

module.exports = { SIZES, THEMES, TIMES, SCENES, SCENE_TIME, wallUrl, wallViews, sizeOf, openWall };
