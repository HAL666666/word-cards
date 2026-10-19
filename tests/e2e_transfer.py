#!/usr/bin/env python3
"""引っ越し用「データを書き出す／データを読み込む」のE2E（ヘッドレス Chrome 390x844）。
自分で作ったカード＋写真Blob・おぼえた記録・設定が往復で戻る／他アプリ・壊れたファイルでは何も変わらない／
置き換え（既定）・統合／iPhone では navigator.share に File。実行: python3 tests/e2e_transfer.py"""
import asyncio, json, os, re, subprocess, sys, tempfile, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(__file__).resolve().parent.parent
SHOTS = Path(os.environ.get("SHOTS", ROOT / "screens")); SHOTS.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("PORT", 18734)); BASE = os.environ.get("BASE", f"http://127.0.0.1:{PORT}/")
IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
res = []
def ok(n, c, x=""): res.append(bool(c)); print(("PASS " if c else "FAIL ") + n + (f"  ({x})" if x else ""))

SEED = r"""async () => {
  const c = document.createElement('canvas'); c.width = 80; c.height = 60; const x = c.getContext('2d'); x.fillStyle = '#0ea5e9'; x.fillRect(0,0,80,60);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .9));
  await DB.put('media', {id:'img-penguin-mine', blob, at: Date.now()});
  await DB.put('cards', {id:'my-penguin', en:'penguin', ja:'ペンギン', zh:'企鵝', pinyin:'qǐ é', kana:'ぺんぎん', image:'idb:img-penguin-mine', audio:{}, source:'user', updatedAt: Date.now()});
  await DB.put('progress', {id:'whale-shark', box:3, last: Date.now(), due: Date.now()+86400000});
  const st = await DB.getMeta('settings', {}); await DB.setMeta('settings', {...st, rate: 1.2, quizLen: 10, show:{ja:true, zh:false, pinyin:true, kana:true}});
}"""
SNAP = r"""async () => { const o = {}; for (const s of ['cards','videos','progress','media','meta']) { const rows = await DB.all(s);
  o[s] = rows.map(r => { const q = {...r}; for (const k in q) if (q[k] instanceof Blob) q[k] = 'blob:' + q[k].size + ':' + q[k].type; return q; })
    .filter(r => !(s === 'meta' && ['lastExport','lastSync'].includes(r.key)))
    .sort((a,b) => String(a.id||a.key).localeCompare(String(b.id||b.key))); } return o; }"""

async def main():
    srv = None
    if "127.0.0.1" in BASE:
        srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1.2)
    tmp = tempfile.mkdtemp()
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path="/usr/bin/google-chrome", headless=True)
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale="ja-JP", accept_downloads=True)
            pg = await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            dialogs = []
            pg.on("dialog", lambda d: (dialogs.append(d.message), asyncio.ensure_future(d.accept())))
            await pg.goto(BASE); await pg.wait_for_function("window.__app && __app.S.cards.length >= 3")
            await pg.evaluate(SEED); await pg.reload(); await pg.wait_for_function("window.__app && __app.S.cards.length >= 4")
            before = await pg.evaluate(SNAP)
            await pg.goto(BASE + "#settings"); await pg.wait_for_selector("#s-export-all")
            t = await pg.inner_text("#s-transfer")
            ok("ボタン：データを書き出す／データを読み込む", "データを書き出す" in t and "データを読み込む" in t)
            await pg.evaluate("document.getElementById('s-transfer').scrollIntoView({block:'center'})"); await pg.wait_for_timeout(400)
            await pg.screenshot(path=str(SHOTS / "16-transfer.png"))
            async with pg.expect_download() as dl:
                await pg.click("#s-export-all")
            d = await dl.value; name = d.suggested_filename
            ok("ファイル名", re.fullmatch(r"kotoba-album-all-v2-\d{4}-\d{2}-\d{2}\.json", name), name)
            path = os.path.join(tmp, name); await d.save_as(path); data = json.load(open(path))
            ok("ヘッダ", data["app"] == "kotoba-album" and data["version"] == 2)
            ok("自分のカードと写真が入る", any(c["id"] == "my-penguin" for c in data["data"]["cards"]) and data["data"]["media"][0]["blob"]["__blob"].startswith("data:image/jpeg;base64,"))
            ok("記録・設定が入る", any(p["id"] == "whale-shark" and p["box"] == 3 for p in data["data"]["progress"]) and any(m["key"] == "settings" and m["value"]["rate"] == 1.2 for m in data["data"]["meta"]))
            bad = {"other.json": json.dumps({"app": "lifelog", "version": 3, "data": {}}), "future.json": json.dumps({**data, "version": 7}),
                   "broken.json": json.dumps(data)[:3000], "badmedia.json": json.dumps({**data, "data": {**data["data"], "media": [{"id": "x", "blob": {"__blob": "zzz"}}]}})}
            for fn, txt in bad.items():
                fp = os.path.join(tmp, fn); open(fp, "w").write(txt); n0 = len(dialogs)
                await pg.set_input_files("#s-import-all", fp); await pg.wait_for_timeout(500)
                st = await pg.inner_text("#s-transfer-status")
                ok(f"壊れた/他のファイルで何も変わらない: {fn}", (await pg.evaluate(SNAP)) == before and "中止" in st and len(dialogs) == n0, st[:50])
            # 新しい端末を想定：全部消して 付属カードだけ
            await pg.evaluate("Promise.all(['cards','progress','media','meta','videos'].map(s => DB.clear(s)))")
            await pg.reload(); await pg.wait_for_function("window.__app && __app.S.cards.length >= 3")
            await pg.goto(BASE + "#settings"); await pg.wait_for_selector("#s-import-all", state="attached")
            await pg.set_input_files("#s-import-all", path); await pg.wait_for_timeout(2600)
            ok("確認ダイアログ（置き換え）", dialogs and "置き換え" in dialogs[-1])
            await pg.wait_for_function("window.__app && __app.S.cards.length >= 4")
            after = await pg.evaluate(SNAP)
            ok("置き換えで全部もどる", after == before, [k for k in before if before[k] != after.get(k)])
            ok("設定が反映", await pg.evaluate("__app.S.settings.rate") == 1.2)
            # 統合：端末だけのカードは残る
            await pg.evaluate("DB.put('cards', {id:'local-only', en:'cat', audio:{}, source:'user', updatedAt: Date.now()})")
            await pg.goto(BASE + "#settings"); await pg.wait_for_selector("#s-import-all", state="attached")
            await pg.click("text=読み込み方：統合"); ok("統合を選べる", await pg.is_checked("input[name=s-import-mode][value=merge]"))
            await pg.set_input_files("#s-import-all", path); await pg.wait_for_timeout(2600)
            ids = await pg.evaluate("DB.all('cards').then(r => r.map(c => c.id))")
            ok("統合で端末のカードも残る", "local-only" in ids and "my-penguin" in ids)
            ok("ページエラーなし", not errs, errs)
            await ctx.close()
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, user_agent=IOS_UA)
            pg = await ctx.new_page()
            await pg.add_init_script("navigator.canShare = d => !!(d && d.files); navigator.share = async d => { window.__shared = {name: d.files[0].name, size: d.files[0].size}; };")
            await pg.goto(BASE + "#settings"); await pg.wait_for_selector("#s-export-all"); await pg.wait_for_timeout(300)
            await pg.click("#s-export-all"); await pg.wait_for_timeout(1200)
            sh = await pg.evaluate("window.__shared")
            ok("iPhone：共有シートに File", sh and sh["name"].startswith("kotoba-album-all-v2-"), sh)
            await b.close()
    finally:
        if srv: srv.terminate()
    print(f"{sum(res)}/{len(res)} passed"); return 0 if all(res) else 1
if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
