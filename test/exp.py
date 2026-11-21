import asyncio, subprocess, time, sys
from playwright.async_api import async_playwright
async def main():
    srv = subprocess.Popen(['python3','-m','http.server','8767'], cwd='/home/claude/receiptradar/web', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(); pg = await b.new_page()
            await pg.goto('http://127.0.0.1:8767/exp.html'); await pg.wait_for_function('window.ready')
            for w in [500, 700, 1000]:
                for mode in ['auto', 'none']:
                    for sh in [0, 1.5]:
                        r = await pg.evaluate(f"exp('testimg/{sys.argv[1]}.jpg', {w}, '{mode}', {sh})")
                        lines = [l for l in r['text'].split('\n') if any(ch.isdigit() for ch in l)]
                        print(f"w={w} {mode:4} sharp={sh} conf={r['conf']:.0f} :: " + ' | '.join(lines)[:200])
            await b.close()
    finally: srv.terminate()
asyncio.run(main())
