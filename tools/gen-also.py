#!/usr/bin/env python3
"""cards.json の also（同じことばが出てくる ほかの Short）を Shorts の catalog から作る。

  python3 tools/gen-also.py [catalog.json] [--dry]

- catalog の各 Short の word / word2 の英語を、カードの en と照合（大文字小文字・記号は無視）
- 秒数(at)は Shorts の work/<nn>_<slug>/timeline.json（card / card2 の t0）→なければ catalog の card_t0 / word2_t0
- メインの video は変えない（方針：いちばん分かりやすい Short をメインにする。人が決める）
- cards.json の videos にある Short だけ。also が変わったカードは rev を +1
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
args = [a for a in sys.argv[1:] if not a.startswith('--')]
CAT = args[0] if args else '/workspace/vwork/shorts_pipe/catalog.json'
WORK = os.path.join(os.path.dirname(CAT), 'work')

def norm(s):
    return re.sub(r'[^a-z0-9]+', '', (s or '').lower().replace('\u2019', "'"))

def times(s):
    t = {}
    p = os.path.join(WORK, f"{s['nn']}_{s['slug']}", 'timeline.json')
    if os.path.exists(p):
        for o in json.load(open(p)).get('overlays', []):
            if o.get('a') in ('card', 'card2') and o['a'] not in t: t[o['a']] = round(float(o['t0']), 1)
    t.setdefault('card', s.get('card_t0'))
    t.setdefault('card2', s.get('word2_t0'))
    return t

def main():
    cat = json.load(open(CAT))
    data = json.load(open(os.path.join(ROOT, 'cards.json')))
    vids = {v['id'] for v in data['videos']}
    hits = {}  # norm(en) -> [(video, at)]
    for s in cat:
        vid = f"s{s['nn']}-{s['slug'].replace('_', '-')}"
        if vid not in vids: continue
        t = times(s)
        for key, ov in (('word', 'card'), ('word2', 'card2')):
            w = s.get(key)
            if w and w.get('en'):
                hits.setdefault(norm(w['en']), []).append((vid, t.get(ov)))
    changed = []
    for c in data['cards']:
        also = [{'video': v, **({'at': a} if a is not None else {})} for v, a in sorted(hits.get(norm(c['en']), [])) if v != c.get('video')]
        if also != c.get('also', []):
            if also: c['also'] = also
            else: c.pop('also', None)
            c['rev'] = c.get('rev', 1) + 1
            changed.append((c['id'], also))
    for cid, a in changed: print('also', cid, a)
    print(f'{len(changed)} cards changed')
    if '--dry' not in sys.argv and changed:
        json.dump(data, open(os.path.join(ROOT, 'cards.json'), 'w'), ensure_ascii=False, indent=2)
        open(os.path.join(ROOT, 'cards.json'), 'a').write('\n')

if __name__ == '__main__':
    main()
