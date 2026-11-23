import asyncio, subprocess, time
from playwright.async_api import async_playwright
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8769'], cwd='/home/claude/rr-repo/web', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    errs = []
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); pg = await (await b.new_context(viewport={'width': 400, 'height': 860})).new_page()
            pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto('http://127.0.0.1:8769/index.html'); await pg.wait_for_timeout(500)
            await pg.click('[data-scan=manual]'); await pg.wait_for_timeout(200)
            for k, (n, pr) in enumerate([('Milch', ''), ('Brot', '1,09'), ('Käse', '2,49'), ('Wasser', '3,99')]):
                await pg.click('[data-additem]'); await pg.wait_for_timeout(100)
                cards = await pg.query_selector_all('.item')
                await (await cards[k].query_selector('[data-f=name]')).fill(n)
                if pr: await (await cards[k].query_selector('[data-f=price]')).fill(pr)
            cards = await pg.query_selector_all('.item')
            await (await cards[1].query_selector('[data-shift]')).click(); await pg.wait_for_timeout(150)
            await pg.click('[data-dir=up]'); await pg.wait_for_timeout(200)
            vals = []
            for c in await pg.query_selector_all('.item'):
                vals.append((await (await c.query_selector('[data-f=name]')).input_value(), await (await c.query_selector('[data-f=price]')).input_value()))
            print('after shift up from Brot:', vals)
            await pg.screenshot(path='/tmp/shift.png')
            await b.close()
    finally: srv.terminate()
    print('ERRORS', errs)
asyncio.run(main())
