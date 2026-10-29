"use strict";

// "Charset rage": Auri gets angry and switches the whole page's encoding to Chinese, Arabic or Hebrew glyphs for a
// few seconds (visible text only, nothing is really changed), then grudgingly puts everything back.
(function initCharsetPack() {
  // the glyphs the page is scrambled into; her lines for each language are in charset()
  const SCRIPTS = {
    chinese: { glyphs: "的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可里后小么心多天而能好都然没日于起还发成事只作当想看文无开手" },
    arabic: { glyphs: "ابتثجحخدذرزسشصضطظعغفقكلمنهوي" },
    hebrew: { glyphs: "אבגדהוזחטיכלמנסעפצקרשת" }
  };
  const SKIP = "script,style,textarea,input,select,svg,canvas,.ai-avatar-bubble,.ai-avatar-roamer,[data-ai-avatar],.av-an-title";
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function swappable(max = 320) {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || !node.nodeValue.trim() || parent.closest(SKIP)) return NodeFilter.FILTER_REJECT;
        const r = parent.getBoundingClientRect();
        return r.width > 3 && r.height > 3 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      }
    });
    while (out.length < max && walker.nextNode()) out.push({ node: walker.currentNode, text: walker.currentNode.nodeValue });
    return out;
  }
  const scramble = (text, glyphs) => text.replace(/\S/g, () => glyphs[Math.floor(Math.random() * glyphs.length)]);

  async function charset(s) {
    const key = pick(Object.keys(SCRIPTS));
    const lang = SCRIPTS[key];
    const home = s.home();
    const spot = s.randomPoint(180);
    // her lines in each language are written out here, as literals: the director reads them from this source to prepare them ahead
    const says = {
      chinese: {
        deal: () => s.say("CHARSET: CHINESE. DEAL WITH IT."),
        rant: [() => s.say("你够了！(That's enough!)", { min: 2100 }), () => s.say("编码错误？不，是编码恐怖！", { min: 2100 }), () => s.say("我不说你的语言了。", { min: 2100 })]
      },
      arabic: {
        deal: () => s.say("CHARSET: ARABIC. DEAL WITH IT."),
        rant: [() => s.say("كفى! (Enough!)", { min: 2100 }), () => s.say("ترميز خاطئ؟ لا، رعب الترميز!", { min: 2100 }), () => s.say("لن أتحدث لغتك بعد الآن.", { min: 2100 })]
      },
      hebrew: {
        deal: () => s.say("CHARSET: HEBREW. DEAL WITH IT."),
        rant: [() => s.say("די! (Enough!)", { min: 2100 }), () => s.say("שגיאת קידוד? לא, אימת קידוד!", { min: 2100 }), () => s.say("אני כבר לא מדברת בשפה שלך.", { min: 2100 })]
      }
    }[key];
    s.place(home);
    const text = s.say("Oh, you want text? I'll give you TEXT.");
    await text.started;
    await s.move(home, spot, { ms: 1400 });
    s.el.style.setProperty("--eye", "#ff2a1a");
    s.el.classList.add("av-eyes");
    s.act("shake", 900);
    await wait(900);
    await text;
    const deal = says.deal();
    const items = swappable();
    const apply = () => { for (const it of items) if (it.node.isConnected) it.node.nodeValue = scramble(it.text, lang.glyphs); };
    const restore = () => { for (const it of items) if (it.node.isConnected) it.node.nodeValue = it.text; };
    const flicker = setInterval(apply, 260);
    try {
      apply();
      if (window.AuraAnimeFx) window.AuraAnimeFx.shake(8, 500);
      await deal;
      for (const rant of says.rant) await rant();
      await wait(1200);
    } finally { // the page and her eyes are back to normal even if the gag is cut short
      clearInterval(flicker);
      restore();
      s.el.classList.remove("av-eyes");
    }
    s.act("dizzy", 900);
    await s.say("...Fine. English. Happy now?", { min: 2000 });
    await s.move(spot, s.home(), { ms: 1300 });
  }

  function boot() {
    const api = window.AuraAvatar;
    if (api && api.registerAntic) api.registerAntic("charset", charset, true);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else boot();
})();
