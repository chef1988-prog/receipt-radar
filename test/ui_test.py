import asyncio, subprocess, time, sys
from playwright.async_api import async_playwright
SH = '/home/claude/receiptradar/test/shots/'
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8766'], cwd='/home/claude/rr-repo/web', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch()
            ctx = await b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True)
            pg = await ctx.new_page()
            pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and 'special-words' not in m.text and 'pixScan' not in m.text and 'boxClip' not in m.text else None)
            pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
            await pg.goto('http://127.0.0.1:8766/index.html')
            await pg.wait_for_timeout(800)
            await pg.screenshot(path=SH + '01_home_empty.png')
            for n in ['lidl_de', 'rewe_de', 'hard_esselunga_it', 'conad_it']:
                async with pg.expect_file_chooser() as fc:
                    await pg.click('[data-scan=gallery]')
                await (await fc.value).set_files(f'/home/claude/receiptradar/test/img/{n}.jpg')
                await pg.wait_for_selector('[data-go]')
                await pg.wait_for_timeout(400)
                if n == 'lidl_de': await pg.screenshot(path=SH + '02_crop.png')
                await pg.click('[data-go]')
                await pg.wait_for_selector('[data-save]', timeout=120000)
                await pg.wait_for_timeout(300)
                await pg.screenshot(path=SH + f'03_review_{n}.png', full_page=False)
                chk = await pg.inner_text('#e-check')
                store = await pg.input_value('#e-store')
                print(n, '| store:', store, '|', chk)
                await pg.click('[data-save]')
                await pg.wait_for_timeout(500)
            await pg.screenshot(path=SH + '04_home.png')
            await pg.click('#tabs [data-tab=prices]'); await pg.wait_for_timeout(300)
            await pg.screenshot(path=SH + '05_prices.png')
            dup = await pg.eval_on_selector_all('.dup-row', 'els => els.map(e => e.innerText.replace(/\\n/g, " / "))')
            print('DUPS:', *dup, sep='\n  ')
            for _ in range(3):
                if await pg.query_selector('[data-dupm]'): await pg.click('[data-dupm]'); await pg.wait_for_timeout(250)
            await pg.screenshot(path=SH + '05b_prices_merged.png')
            await pg.click('.list-row[data-product]'); await pg.wait_for_timeout(400)
            await pg.screenshot(path=SH + '05c_product.png', full_page=True)
            await pg.click('[data-back]'); await pg.wait_for_timeout(200)
            await pg.click('#tabs [data-tab=spending]'); await pg.wait_for_timeout(300)
            await pg.screenshot(path=SH + '06_spending.png', full_page=True)
            await pg.click('#tabs [data-tab=receipts]'); await pg.wait_for_timeout(300)
            await pg.screenshot(path=SH + '07_receipts.png')
            st = await pg.evaluate('JSON.stringify({r: __rr.state.receipts.length, p: Object.values(__rr.state.products).map(p=>p.name+"|"+p.category)})')
            print(st)
            await b.close()
    finally:
        srv.terminate()
    print('ERRORS:', errs)
asyncio.run(main())
