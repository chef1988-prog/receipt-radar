# Runs the packaged app (served by the app's own Java LocalServer) with a fake AndroidBridge.
import asyncio, json
from playwright.async_api import async_playwright
BRIDGE = """
(() => {
  const mem = JSON.parse(sessionStorage.getItem('fakefs') || '{}');
  let pending = sessionStorage.getItem('pendingUsed') ? false : true;
  window.__exports = [];
  window.AndroidBridge = {
    readFile: (n) => (n in mem ? mem[n] : null),
    writeFile: (n, c) => { mem[n] = c; sessionStorage.setItem('fakefs', JSON.stringify(mem)); return true; },
    deleteFile: (n) => { delete mem[n]; sessionStorage.setItem('fakefs', JSON.stringify(mem)); return true; },
    exportFile: (f, m, c) => { window.__exports.push({f, m, c}); },
    hasPendingPhoto: () => { const p = pending; pending = false; sessionStorage.setItem('pendingUsed', '1'); return p; },
    version: () => '1.0.0',
  };
})();
"""
async def main():
    errs = []
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 400, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True)
        await ctx.add_init_script(BRIDGE)
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errs.append('PAGEERROR ' + str(e)))
        pg.on('console', lambda m: errs.append(m.text) if m.type == 'error' and not any(x in m.text for x in ['special-words','pixScan','boxClip']) else None)
        await pg.goto('http://127.0.0.1:38457/index.html')
        # pending photo (simulated app restart while camera was open) should open the crop screen by itself
        await pg.wait_for_selector('[data-go]', timeout=15000)
        print('pending photo -> crop screen opened')
        await pg.click('[data-go]')
        await pg.wait_for_selector('[data-save]', timeout=120000)
        print('pending REWE ->', await pg.input_value('#e-store'), '|', await pg.inner_text('#e-check'))
        await pg.click('[data-save]'); await pg.wait_for_timeout(400)
        # camera path (input with capture attribute)
        await pg.click('#tab-scan'); await pg.wait_for_timeout(200)
        async with pg.expect_file_chooser() as fc:
            await pg.click('[data-k=camera]')
        chooser = await fc.value
        print('camera input has capture attr:', await chooser.element.get_attribute('capture'))
        await chooser.set_files('/home/claude/receiptradar/test/img/hard_lidl_de.jpg')
        await pg.wait_for_selector('[data-go]'); await pg.click('[data-go]')
        await pg.wait_for_selector('[data-save]', timeout=120000)
        print('hard Lidl ->', await pg.input_value('#e-store'), '|', await pg.inner_text('#e-check'))
        flags = await pg.eval_on_selector_all('.flag-note', 'els => els.map(e => e.innerText)')
        print('flags:', flags)
        await pg.screenshot(path='/home/claude/receiptradar/test/shots/08_review_hard.png')
        await pg.click('[data-save]'); await pg.wait_for_timeout(400)
        # reload: data must persist through the bridge
        await pg.reload(); await pg.wait_for_timeout(1200)
        n = await pg.evaluate('__rr.state.receipts.length')
        print('receipts after reload:', n)
        # Android back button behaviour
        await pg.click('[data-receipt]'); await pg.wait_for_timeout(300)
        r1 = await pg.evaluate('window.appBack()'); r2 = await pg.evaluate('window.appBack()')
        print('appBack: closes page ->', r1, '| at home exits ->', r2)
        # export CSV + backup
        await pg.click('#btn-settings'); await pg.wait_for_timeout(200)
        await pg.click('[data-x=csv]'); await pg.wait_for_timeout(200)
        await pg.click('[data-x=backup]'); await pg.wait_for_timeout(500)
        ex = await pg.evaluate('window.__exports.map(e => ({f: e.f, m: e.m, len: e.c.length, head: e.c.slice(0, 300)}))')
        for e in ex: print('export:', e['f'], e['m'], e['len']); 
        print(ex[0]['head'])
        await pg.screenshot(path='/home/claude/receiptradar/test/shots/09_settings.png')
        await b.close()
    print('ERRORS:', errs)
asyncio.run(main())
