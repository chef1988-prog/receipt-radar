import asyncio, json, sys, base64, subprocess, time
from playwright.async_api import async_playwright
mode = sys.argv[1] if len(sys.argv) > 1 else 'auto'
names = sys.argv[2].split(',') if len(sys.argv) > 2 else ['lidl_de','rewe_de','esselunga_it','conad_it']
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8765'], cwd='/home/claude/receiptradar/web', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            pg = await b.new_page()
            pg.on('console', lambda m: print('console:', m.text) if m.type in ('error','warning') else None)
            await pg.goto('http://127.0.0.1:8765/harness.html')
            await pg.wait_for_function('window.ready === true')
            for n in names:
                r = await pg.evaluate(f"runTest('testimg/{n}.jpg', '{mode}')")
                open(f'/home/claude/receiptradar/test/out_{n}_{mode}.jpg','wb').write(base64.b64decode(r['png'].split(',')[1]))
                pr = r['parsed']
                print(f"\n===== {n} [{mode}] quad={r['quad']} size={r['size']} prep={r['prepMs']:.0f}ms ocr={r['ocrMs']:.0f}ms conf={r['conf']:.0f}")
                print(r['text'])
                print(f"--> store={pr['store']} date={pr['date']} total={pr['total']} sum={pr['sum']} {pr['warnings']}")
                for it in pr['items']: print(f"     {it['name'][:34]:34} {it['qty']:>6} {it['unit']} {it['price']:6.2f} {it['discount'] or ''}")
            await b.close()
    finally:
        srv.terminate()
asyncio.run(main())
