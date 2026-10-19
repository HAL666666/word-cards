#!/usr/bin/env python3
"""ヘッドレス Chrome（390x844）で動作確認＋スクリーンショット。
実行: python3 tests/e2e.py   （ローカルサーバーは自動で立てる。BASE=... で公開URLにも使える）"""
import asyncio, json, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screens"; SHOTS.mkdir(exist_ok=True)
PORT = int(os.environ.get("PORT", 18733))
BASE = os.environ.get("BASE", f"http://127.0.0.1:{PORT}/")
CHROME = "/usr/bin/google-chrome"
results, errors = [], []

def ok(name, cond, extra=""):
    results.append((name, bool(cond), extra)); print(("PASS " if cond else "FAIL ") + name + (f"  ({extra})" if extra else ""))

async def main():
    srv = None
    if "127.0.0.1" in BASE:
        srv = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        time.sleep(1.5)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(executable_path=CHROME, headless=True, args=["--autoplay-policy=no-user-gesture-required"])
            ctx = await b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                      locale="ja-JP", accept_downloads=True,
                                      user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
            pg = await ctx.new_page()
            pg.on("pageerror", lambda e: errors.append(str(e)))
            pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
            shot = lambda n: pg.screenshot(path=str(SHOTS / f"{n}.png"))

            await pg.goto(BASE)
            await pg.wait_for_selector(".tiles")
            await pg.wait_for_function("window.__app && window.__app.S.cards.length >= 3")
            n = await pg.evaluate("__app.S.cards.length")
            ok("初回起動で cards.json の3まいが入る", n == 3, f"{n}まい")
            await pg.wait_for_timeout(300); await shot("01-home")

            # 長おしで おとなメニュー
            box = await pg.locator(".grown").bounding_box()
            await pg.mouse.move(box["x"] + 20, box["y"] + 10); await pg.mouse.down(); await pg.wait_for_timeout(1000); await pg.mouse.up()
            await pg.wait_for_timeout(200)
            ok("おとなボタン長おしで設定へ", "settings" in pg.url)
            await pg.goto(BASE + "#home"); await pg.wait_for_timeout(200)
            await pg.locator(".grown").click(); await pg.wait_for_timeout(200)
            ok("おとなボタンは タップだけでは開かない", "settings" not in pg.url)

            await pg.goto(BASE + "#list"); await pg.wait_for_selector(".ctile")
            ok("一覧：ビデオごとにまとまる", await pg.locator(".vgroup").count() == 1 and await pg.locator(".ctile").count() == 3)
            await pg.wait_for_timeout(400); await shot("02-list")

            await pg.locator(".ctile").first.click(); await pg.wait_for_selector(".say.big")
            t = await pg.inner_text("#v-card")
            ok("カード：英・日・中・ピンイン・よみ・ビデオ", all(s in t for s in ["whale shark", "じんべえざめ", "鯨鯊", "jīng shā", "ほえーる しゃーく", "セブ島"]))
            how = await pg.evaluate("Speech.say(__app.S.cards.find(c=>c.id==='whale-shark'),'zh',1)")
            ok("付属カードは mp3 で再生", how == "mp3", how)
            await pg.wait_for_timeout(300); await shot("03-card")

            # めくる
            await pg.goto(BASE + "#flash"); await pg.wait_for_selector("#flip")
            await pg.wait_for_timeout(400); await shot("04-flash-front")
            await pg.click("#flip"); await pg.wait_for_timeout(700); await shot("05-flash-back")
            ok("めくる：タップで裏返る", await pg.locator("#flip.on").count() == 1)
            await pg.click("#g-known"); await pg.wait_for_timeout(500)
            await pg.click("#g-again"); await pg.wait_for_timeout(500)
            tot = await pg.inner_text(".fprog span")
            ok("もういちど のカードは列のうしろに戻る", tot.endswith("/4"), tot)
            for _ in range(6):
                if await pg.locator("#g-known").count() == 0: break
                await pg.click("#g-known"); await pg.wait_for_timeout(450)
            ok("めくる：おわり画面", await pg.locator(".empty.done").count() == 1)
            await pg.wait_for_timeout(600); await shot("06-flash-done")
            prog = await pg.evaluate("Promise.resolve(DB.all('progress'))")
            ok("おぼえた記録が IndexedDB に入る", len(prog) == 3 and all(p["box"] >= 1 for p in prog), str([p["box"] for p in prog]))

            # クイズ
            await pg.goto(BASE + "#quiz"); await pg.wait_for_selector(".choice")
            await pg.wait_for_timeout(400); await shot("07-quiz")
            for i in range(5):
                await pg.wait_for_selector(".choice")
                ans = await pg.evaluate("(()=>{const q=document.querySelector('.qpic img');return q?q.alt:''})()")
                wrong = pg.locator(".choice").filter(has_not_text=ans).first
                if i == 0:
                    await wrong.click(); await pg.wait_for_timeout(450)
                    ok("クイズ：まちがいはグレーになって やりなおせる", await pg.locator(".choice.wrong").count() == 1)
                    await shot("08-quiz-wrong")
                await pg.locator(".choice", has_text=ans).first.click()
                if i == 0:
                    await pg.wait_for_timeout(250); await shot("09-quiz-correct")
                await pg.wait_for_function("!document.querySelector('#v-quiz').classList.contains('lock')", timeout=15000)
            await pg.wait_for_selector(".bigstars"); await pg.wait_for_timeout(900)
            ok("クイズ：結果のほし", "4もん いっぱつ" in await pg.inner_text("#v-quiz"), await pg.inner_text("#v-quiz .empty p:nth-of-type(2)"))
            await shot("10-quiz-result")

            # つくる
            await pg.goto(BASE + "#edit/new"); await pg.wait_for_selector("#ef")
            await pg.set_input_files("[data-pic] >> nth=1", str(ROOT / "media/img/its-yummy.svg").replace(".svg", ".svg"))
            await pg.fill("[name=en]", "honey"); await pg.fill("[name=kana]", "はにー"); await pg.fill("[name=ja]", "はちみつ")
            await pg.fill("[name=zh]", "蜂蜜"); await pg.fill("[name=pinyin]", "fēng mì"); await pg.fill("[name=note]", "I like honey!")
            await pg.select_option("#ef-video", "__new")
            await pg.fill("[name=vtitle]", "おうちで ホットケーキ"); await pg.fill("[name=vdate]", "2026-10-18")
            await pg.fill("[name=vurl]", "https://youtube.com/shorts/EXAMPLE")
            await pg.evaluate("window.scrollTo(0,0)"); await pg.wait_for_timeout(600); await shot("11-edit")
            await pg.click("button[type=submit]"); await pg.wait_for_selector(".say.big")
            ok("つくる：保存してカード画面へ", "#card/honey" in pg.url)
            img = await pg.get_attribute(".hero-pic img", "src")
            ok("つくる：写真は端末内(Blob)に保存", (img or "").startswith("blob:"), img or "")
            await pg.wait_for_timeout(300); await shot("12-user-card")
            how = await pg.evaluate("Speech.say(__app.S.cards.find(c=>c.id==='honey'),'en',1)")
            ok("自分のカードは 端末の声(Web Speech)に回る", how in ("tts", "none"), how)

            # 取り込み
            await pg.goto(BASE + "#settings"); await pg.wait_for_selector("#s-import", state="attached")
            await pg.set_input_files("#s-import", str(ROOT / "tests/fixtures/import-sample.json"))
            await pg.wait_for_function("__app.S.cards.some(c=>c.id==='giraffe')")
            g = await pg.evaluate("__app.S.cards.find(c=>c.id==='giraffe').image")
            ok("JSON取り込み：data:画像は端末内へ", g.startswith("idb:"), g)
            await pg.wait_for_timeout(500); await shot("13-settings")
            await pg.evaluate("window.scrollTo(0, document.body.scrollHeight)"); await pg.wait_for_timeout(200)
            await pg.screenshot(path=str(SHOTS / "14-settings-bottom.png"))

            # 書き出し
            async with pg.expect_download() as dl:
                await pg.click("#s-export")
            d = await dl.value; pth = await d.path()
            bk = json.loads(Path(pth).read_text())
            hc = [c for c in bk["cards"] if c["id"] == "honey"][0]
            ok("バックアップ：形式・写真入り・記録入り", bk["format"] == "word-cards-backup" and hc["image"].startswith("data:image/") and len(bk["progress"]) >= 3 and len(bk["cards"]) == 5)
            (SHOTS.parent / "tests/fixtures").mkdir(exist_ok=True)

            # 設定：ことばを隠す
            await pg.goto(BASE + "#settings"); await pg.wait_for_selector("[data-show=zh]", state="attached")
            await pg.locator("label.tog", has=pg.locator("[data-show=zh]")).click(); await pg.wait_for_timeout(200)
            await pg.goto(BASE + "#card/penguin"); await pg.wait_for_selector(".say.big")
            ok("設定：中国語オフで カードから消える", "企鵝" not in await pg.inner_text("#v-card"))
            await pg.goto(BASE + "#settings"); await pg.wait_for_selector("[data-show=zh]", state="attached")
            await pg.locator("label.tog", has=pg.locator("[data-show=zh]")).click(); await pg.wait_for_timeout(200)

            # 同期：もう一度読んでも 直した/増えたカードは そのまま
            st = await pg.evaluate("__app.syncRepo({quiet:true})")
            ok("同期：2回目は追加0", st and st["added"] == 0, json.dumps(st))

            # オフライン
            await pg.evaluate("navigator.serviceWorker.ready.then(()=>true)")
            await pg.reload(); await pg.wait_for_timeout(1500)
            await pg.evaluate("caches.open('wordcards-media-v1').then(c=>c.keys()).then(k=>k.length)")
            await ctx.set_offline(True)
            await pg.goto(BASE + "#list"); await pg.wait_for_selector(".ctile", timeout=8000)
            imgs_ok = await pg.evaluate("Promise.all([...document.querySelectorAll('.ctile img')].map(i=>i.decode().then(()=>i.naturalWidth>0).catch(()=>false)))")
            ok("オフラインで一覧と写真が出る", await pg.locator(".ctile").count() == 5 and all(imgs_ok), str(imgs_ok))
            how = await pg.evaluate("Speech.say(__app.S.cards.find(c=>c.id==='penguin'),'en',1)")
            ok("オフラインでも mp3 再生", how == "mp3", how)
            await shot("15-offline-list")
            await ctx.set_offline(False)

            mf = await pg.evaluate("fetch('manifest.json').then(r=>r.json())")
            ok("manifest 読める", mf["short_name"] == "ことばアルバム")
            await b.close()
    finally:
        if srv: srv.terminate()
    bad = [r for r in results if not r[1]]
    errs = [e for e in errors if "favicon" not in e]
    print(f"\n{len(results) - len(bad)}/{len(results)} PASS; page errors: {errs}")
    sys.exit(1 if bad or errs else 0)

asyncio.run(main())
