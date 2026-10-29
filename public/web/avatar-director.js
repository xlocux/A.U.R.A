"use strict";

// AURI's director: every performance goes through here (a gag, the rage, a tantrum scene, being carried around).
//  1. it holds her voice (chatter waits, in order) and lets the line she is saying finish;
//  2. it prepares every line it will say, with the emotion she will use, and starts only when they are ready
//     (6 s at most; otherwise it is postponed and the preparation goes on in the background);
//  3. it runs the script: `await s.say(x)` ends when she has said x, so every move follows her real voice;
//  4. it waits for her last line, cleans up, and gives the voice back to the chatter.
// She is not clickable while she performs (a script that is a game, like catch-me, opens its own clicks).
(function initAvatarDirector(root) {
  // How each move is shouted: in Japanese, the way the anime says it, in romaji with the stretched vowels of a battle
  // cry; the voice engine turns it into Japanese sounds. Moves missing here are shouted in English (see cry()).
  const JAPANESE = {
    "KAGE BUNSHIN": "kaaage bunshin no jutsuuu!!", "KYUUBI MODE": "kyuuubi moooodo!!", "KAMEHAMEHA": "kameeehameeehaaaa!!", "NANI?!": "naaani?!",
    "SHARINGAN": "sharingaaaan!!", "MANGEKYO": "mangekyooou sharingaaaan!!", "BYAKUGAN": "byakugaaaan!!", "RINNEGAN": "rinnegaaaan!!",
    "HANA HANA NO... MIL FLEUR!": "haaana haaana no... miru furuuuuru!!",
    "GOMU GOMU NO... PISTOL!": "goooomu goooomu no... pisutooooru!!", "GOMU GOMU NO... GATLING!": "goooomu goooomu no... gatoriiinguuuu!!",
    "GOMU GOMU NO... BAZOOKA!": "goooomu goooomu no... bazuuuuka!!", "GOMU GOMU NO... ELEPHANT GUN!": "goooomu goooomu no... erefanto gaaaan!!",
    "GOMU GOMU NO... RED HAWK!": "goooomu goooomu no... reddo hooooku!!", "GOMU GOMU NO... JET PISTOL!": "goooomu goooomu no... jetto pisutooooru!!",
    "GEAR 5 - NIKA": "giaaa fifusu... nikaaaa!!", "CONQUEROR'S HAKI": "haoshoku no haaaki!!",
    "BANKAI": "bankaiiii!!", "KATEN KYOKOTSU: KARAMATSU SHINJU": "katen kyoukotsu... karamatsu shinjuuuu!!"
  };
  // "KAMEHAMEHA" -> "KAMEHAMEHAAAA!!": the last vowel is stretched like an anime battle cry
  const stretch = (text) => String(text).replace(/[.?!\s-]+$/, "").replace(/([AEIOUaeiou])([^AEIOUaeiou]*)$/, (m, v, rest) => v.repeat(4) + rest) + "!!";
  // [line, emotion, lang] as the voice engine wants it
  const cryLine = (move) => (JAPANESE[move] ? [JAPANESE[move], "shout", "ja"] : [stretch(move), "shout", ""]);

  // ── what a script will say, read from its source: literal first arguments of s.say / s.line / g.say (tantrum
  // ghosts), s.cry, s.quote, and every option of s.pick([...]). Lines built at run time are not found: they are
  // generated when said, and the script waits for them at that beat.
  const STR = String.raw`(["'])((?:\\.|(?!\1)[^\\])*)\1`;
  const STR2 = STR.replace(/\\1/g, "\\3");
  const unquote = (s) => s.replace(/\\(.)/g, "$1");
  const sayable = (t) => t.replace(/[^A-Za-z]/g, "").length >= 3;
  function extractLines(source) {
    const src = String(source);
    const say = [], cries = [], quotes = [];
    for (const m of src.matchAll(new RegExp(String.raw`\b[sg]\.(?:say|line)\(\s*` + STR, "g"))) say.push(unquote(m[2]));
    for (const m of src.matchAll(/\bs\.pick\(\s*\[([^\]]*)\]/g)) for (const n of m[1].matchAll(new RegExp(STR, "g"))) say.push(unquote(n[2]));
    for (const m of src.matchAll(new RegExp(String.raw`\bs\.cry\(\s*` + STR, "g"))) cries.push(unquote(m[2]));
    for (const m of src.matchAll(new RegExp(String.raw`\bs\.quote\(\s*` + STR + String.raw`\s*,\s*` + STR2, "g"))) quotes.push([unquote(m[2]), unquote(m[4])]);
    const seen = new Set();
    const once = (list, key) => list.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
    return { say: once(say.filter(sayable), (t) => "s:" + t), cries: once(cries, (t) => "c:" + t), quotes: once(quotes, (q) => "q:" + q.join("|")) };
  }

  // A quote line is rolled once per performance and kept while the performance is postponed, so the line prepared in
  // the background is the one she says next time.
  function quoteText(first, key, rolls) {
    const id = first + "|" + key;
    if (!rolls.has(id)) { const q = root.AuraQuotes ? root.AuraQuotes.get(key, { force: true }) : null; rolls.set(id, q || ""); }
    const q = rolls.get(id);
    return q ? first + "\n" + q : first;
  }
  function linesFor(script, rolls = new Map(), { quotes = true } = {}) {
    const S = root.AuraSpeech;
    const emotion = (text) => (S && S.emotionFor ? S.emotionFor(text, {}) : "neutral");
    const found = extractLines(script.source || script);
    const lines = found.say.map((text) => ({ text, emotion: emotion(text) }));
    for (const move of found.cries) { const [text, emo, lang] = cryLine(move); lines.push({ text, emotion: emo, lang }); }
    if (quotes) for (const [first, key] of found.quotes) { const text = quoteText(first, key, rolls); lines.push({ text, emotion: emotion(text) }); }
    return lines;
  }

  // ── the move title: manga speed lines and a big italic name, up for ms ──
  function fx(className) {
    const el = document.createElement("div");
    el.className = className;
    document.body.append(el);
    return el;
  }
  async function showTitle(text, ms) {
    const lines = fx("av-an-lines");
    const t = fx("av-an-title");
    t.textContent = text;
    t.style.left = "50%"; t.style.top = "46%";
    t.style.fontSize = `min(92px, ${Math.round(88 / Math.max(6, text.length) * 100) / 10}vw)`;
    lines.animate([{ opacity: 0 }, { opacity: 1 }, { opacity: 1 }, { opacity: 0 }], { duration: ms, fill: "forwards" });
    t.animate([{ transform: "translate(-50%, -50%) scale(2.6) skewX(-10deg)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1) skewX(-10deg)", opacity: 1, offset: 0.18 }, { transform: "translate(-50%, -50%) scale(1.06) skewX(-10deg)", opacity: 1, offset: 0.85 }, { transform: "translate(-50%, -50%) scale(1.3) skewX(-10deg)", opacity: 0 }], { duration: ms, fill: "forwards" });
    await new Promise((resolve) => setTimeout(resolve, ms));
    lines.remove(); t.remove();
  }

  // ── performances ──
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const MAX_SHOW_MS = 60000;
  const rollsBy = new Map(); // gag name -> the quotes rolled for its next performance
  let seq = 0, current = null;

  function voiceApi(base, show) {
    const S = root.AuraSpeech;
    const guard = () => { if (show.closed) throw new Error("the performance is over"); };
    const track = (h) => { show.handles.push(h); return h; };
    // await s.say(x) ends when she has said x (and not before opts.min ms); s.say(x).started when she starts it
    function say(text, opts = {}) {
      guard();
      if (typeof opts === "number") opts = { min: opts }; // the old form s.say(text, ms)
      const h = track(S.speak(String(text), { ...opts, lane: "show", show: show.id, forced: true }));
      h.then = (ok, ko) => h.ended.then(ok, ko);
      return h;
    }
    // the battle cry: the move name appears as she starts shouting it; resolves then, with the cry's length
    async function cry(move, opts = {}) {
      guard();
      const [text, emotion, lang] = cryLine(move);
      const h = track(S.speak(text, { lane: "show", show: show.id, emotion, lang, bubble: false, forced: true }));
      const ms = await h.started;
      if (!opts.silentTitle) showTitle(move, Math.max(opts.ms || 1500, ms + 200));
      return ms;
    }
    return {
      ...base, say, cry,
      line: (text, ms = 2000) => say(text, { min: ms }),
      title: (text, ms = 1500) => showTitle(text, ms),
      quote: (first, key) => quoteText(first, key, show.rolls),
      pick: (list) => list[Math.floor(Math.random() * list.length)]
    };
  }

  // false = not performed now (she is busy, the lines are not ready yet...): the caller tries again later.
  // stage: false for scenes that draw their own figure (rage, tantrums); immediate: no waiting, no preparation (being
  // carried must answer the hand at once); interactive: the script handles clicks on her.
  async function perform(name, script, { interactive = false, stage = true, immediate = false } = {}) {
    const A = root.AuraAvatar, S = root.AuraSpeech;
    if (current || !A || !S || (stage && !A.canStage())) return false;
    const show = { id: ++seq, name, handles: [], closed: false, rolls: new Map() };
    current = show;
    S.hold(show.id);
    try {
      if (!immediate) {
        if (!(await S.quiet(10000))) return false;
        const rolls = rollsBy.get(name) || new Map();
        rollsBy.set(name, rolls);
        show.rolls = rolls;
        const { missing } = await S.prepare(linesFor(script, rolls), { timeoutMs: 6000 });
        if (missing) return false;
      }
      const run = async (base) => {
        const playing = Promise.resolve().then(() => script(voiceApi(base || {}, show)));
        playing.catch(() => {}); // a script stopped by the cap ends on its next call: nothing to report
        await Promise.race([playing, wait(MAX_SHOW_MS)]);
        await Promise.race([Promise.all(show.handles.map((h) => h.ended)), wait(15000)]);
      };
      if (stage) { if (!(await A.stage(run, { interactive }))) return false; }
      else await run(null);
      rollsBy.delete(name); // performed: new quotes next time
      return true;
    } catch {
      return false;
    } finally {
      show.closed = true;
      S.release(show.id);
      if (current === show) current = null;
    }
  }

  // A battle cry outside a performance (a big find): shouted in her turn, the title as she starts it.
  function shout(move, ms = 1100) {
    const S = root.AuraSpeech;
    if (!S) return;
    const [text, emotion, lang] = cryLine(move);
    S.speak(text, { emotion, lang, bubble: false, forced: true }).started.then((d) => showTitle(move, Math.max(ms, d + 200)));
  }

  root.AuraDirector = { perform, isPerforming: () => Boolean(current), showId: () => (current ? current.id : 0), shout, extractLines, linesFor, cryLine, JAPANESE };
  if (typeof module === "object" && module.exports) module.exports = { extractLines, cryLine };
})(typeof window !== "undefined" ? window : globalThis);
