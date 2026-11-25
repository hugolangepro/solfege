import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=['--no-sandbox'])
        pg = await (await b.new_context(viewport={'width': 1512, 'height': 900}, device_scale_factor=1)).new_page()
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto('http://localhost:8765/index.html?input=midi')
        await pg.wait_for_timeout(500)
        await pg.click('#clef button[data-v="deux"]')
        await pg.click('#go'); await pg.wait_for_timeout(300)
        notes = await pg.evaluate('() => window.__solfege.session.notes')
        print('exemples de correspondance :', [(n['clef'], n['p'], n['cls'], n['midi']) for n in notes[:3] + notes[8:11]])
        for i, n in enumerate(notes):
            await pg.evaluate('(m) => window.__solfege.onMidiNote(m)', n['midi'] + (1 if i in (3, 17) else 0))
            if i == 12: await pg.screenshot(path='/home/claude/work/solfege/tests/midi_encours.png')
            await pg.wait_for_timeout(60)
        v = await pg.evaluate("() => window.__solfege.verdicts().map(q => q ? q.v : null)")
        print('verdicts :', [(i, x) for i, x in enumerate(v) if x != 'ok'], '| résultat :', (await pg.inner_text('#result')).replace('\n', ' / '), '| erreurs :', errs)
        await pg.screenshot(path='/home/claude/work/solfege/tests/midi_fin.png')
        await b.close()
asyncio.run(main())
