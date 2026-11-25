"""Réponse au clavier sur le système de piano : notes MIDI simulées, une un demi-ton trop haut, deux à l'octave (dont la dernière)."""
import asyncio, os
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            b = await p.chromium.launch(channel='chrome', args=['--no-sandbox'])
            pg = await (await b.new_context(viewport={'width': 1512, 'height': 900}, device_scale_factor=1)).new_page()
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(base + '?input=midi')
            await pg.wait_for_timeout(500)
            await pg.click('#clef button[data-v="deux"]')
            await pg.click('#go'); await pg.wait_for_timeout(300)
            notes = await pg.evaluate('() => window.__solfege.session.notes')
            print('exemples de correspondance :', [(n['clef'], n['p'], n['cls'], n['midi']) for n in notes[:3] + notes[8:11]])
            for i, n in enumerate(notes):
                await pg.evaluate('(m) => window.__solfege.onMidiNote(m)', n['midi'] + (1 if i == 3 else -12 if i == 17 else 12 if i == 23 else 0))
                if i == 12: await pg.screenshot(path=os.path.join(ICI, 'midi_encours.png'))
                await pg.wait_for_timeout(250)
            v = await pg.evaluate("() => window.__solfege.verdicts().map(q => q ? q.v : null)")
            print('notes rouges :', await pg.evaluate("() => Array.from(document.querySelectorAll('#systems path[data-n]')).filter(p => p.getAttribute('fill') === '#B3261E').map(p => +p.dataset.n)"),
                  '| textes :', await pg.evaluate("() => document.querySelectorAll('#systems text').length"), '| cercles :', await pg.evaluate("() => document.querySelectorAll('#systems ellipse').length"),
                  '| portées dessinées :', await pg.evaluate("() => document.querySelectorAll('#systems svg').length"), '| notes :', len(notes))
            rec = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions')).slice(-1)[0]")
            print('verdicts :', [(i, x) for i, x in enumerate(v) if x != 'ok'], '| résultat :', (await pg.inner_text('#result')).replace('\n', ' / '), '| erreurs :', errs)
            print('séance gardée :', {k: rec[k] for k in ('fmt', 'mode', 'input', 'n', 'ok', 'faux', 'manque', 'dur', 'rate', 'acc')}, '| notes 3 et 4 :', rec['notes'][3:5], '| une note en clé de fa :', rec['notes'][8])
            await pg.screenshot(path=os.path.join(ICI, 'midi_fin.png'))
            await b.close()
asyncio.run(main())
