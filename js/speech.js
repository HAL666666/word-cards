/* 発音：カードに mp3 があればそれを再生、なければ Web Speech API（端末の声）。効果音は WebAudio。 */
(function (global) {
  'use strict';
  const BCP = { en: 'en-US', ja: 'ja-JP', zh: 'zh-TW' };
  const PREFER = { en: ['en-US', 'en-GB', 'en'], ja: ['ja-JP', 'ja'], zh: ['zh-TW', 'zh-HK', 'cmn-Hant', 'zh'] };
  let current = null;
  let voices = [];
  const synth = global.speechSynthesis;
  function loadVoices() { try { voices = synth ? synth.getVoices() : []; } catch (e) { voices = []; } }
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

  function pickVoice(lang) {
    if (!voices.length) loadVoices();
    for (const p of PREFER[lang] || [lang]) {
      const v = voices.find((x) => x.lang && x.lang.replace('_', '-').toLowerCase().startsWith(p.toLowerCase()));
      if (v) return v;
    }
    return null;
  }

  function stop() {
    if (current) { try { current.pause(); } catch (e) {} current = null; }
    if (synth) try { synth.cancel(); } catch (e) {}
  }

  function tts(text, lang, rate) {
    return new Promise((resolve) => {
      if (!synth || !global.SpeechSynthesisUtterance || !text) return resolve(false);
      const u = new SpeechSynthesisUtterance(text);
      u.lang = BCP[lang] || lang;
      const v = pickVoice(lang); if (v) u.voice = v;
      u.rate = Math.max(0.5, Math.min(1.5, rate || 1));
      u.onend = () => resolve(true); u.onerror = () => resolve(false);
      synth.speak(u);
      setTimeout(() => resolve(true), 8000);
    });
  }

  async function mediaUrl(ref) {
    if (!ref) return '';
    if (ref.startsWith('idb:')) {
      const m = await DB.get('media', ref.slice(4));
      return m && m.blob ? URL.createObjectURL(m.blob) : '';
    }
    return ref;
  }

  /* lang の発音を再生。text は TTS 用 */
  async function say(card, lang, rate = 1) {
    stop();
    const text = lang === 'en' ? card.en : lang === 'ja' ? (card.ja || '') : (card.zh || '');
    const ref = card.audio && card.audio[lang];
    if (ref) {
      try {
        const url = await mediaUrl(ref);
        const a = new Audio(url);
        a.preservesPitch = true; a.playbackRate = Math.max(0.5, Math.min(1.5, rate));
        current = a;
        await a.play();
        await new Promise((r) => { a.onended = r; a.onerror = r; setTimeout(r, 8000); });
        if (url.startsWith('blob:')) URL.revokeObjectURL(url);
        return 'mp3';
      } catch (e) { /* 再生できなければ端末の声へ */ }
    }
    return (await tts(text, lang, rate)) ? 'tts' : 'none';
  }

  /* 効果音 */
  let ac = null;
  function tone(seq) {
    try {
      ac = ac || new (global.AudioContext || global.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume();
      let t = ac.currentTime + 0.01;
      for (const [f, d, type = 'sine', g = 0.18] of seq) {
        const o = ac.createOscillator(), gn = ac.createGain();
        o.type = type; o.frequency.value = f;
        gn.gain.setValueAtTime(0.0001, t); gn.gain.exponentialRampToValueAtTime(g, t + 0.02);
        gn.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(gn).connect(ac.destination); o.start(t); o.stop(t + d + 0.05);
        t += d * 0.8;
      }
    } catch (e) {}
  }
  const sfx = {
    yay: () => tone([[784, 0.12, 'triangle'], [988, 0.12, 'triangle'], [1319, 0.28, 'triangle']]),
    oops: () => tone([[330, 0.16, 'sine', 0.12], [262, 0.24, 'sine', 0.12]]),
    flip: () => tone([[660, 0.07, 'sine', 0.08]]),
    fanfare: () => tone([[523, 0.14, 'triangle'], [659, 0.14, 'triangle'], [784, 0.14, 'triangle'], [1047, 0.4, 'triangle']]),
  };

  global.Speech = { say, stop, tts, sfx, mediaUrl, hasTTS: () => !!synth };
})(window);
