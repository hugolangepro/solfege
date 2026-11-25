"""Réponse au clavier sur le système de piano, lecture sans fin : notes MIDI simulées, une un demi-ton trop haut, une à l'octave."""
import asyncio, json, os
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            b = await p.chromium.launch(channel='chrome', args=['--no-sandbox'])
            ctx = await b.new_context(viewport={'width': 1512, 'height': 900}, device_scale_factor=1)
            # préférences d'avant les réglages par exercice : la clé choisie doit être reprise
            await ctx.add_init_script("if (!localStorage.getItem('solfege.prefs')) localStorage.setItem('solfege.prefs', %s)" % json.dumps(json.dumps({'clef': 'deux', 'input': 'voix', 'exo': 'lecture', 'niveau': '1'})))
            pg = await ctx.new_page()
            errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(base + '?input=midi'); await pg.wait_for_timeout(500)
            await pg.click('#liste button[data-exo="notes"]'); await pg.wait_for_timeout(300)
            lignes = []
            for i in range(60):
                n = await pg.evaluate('(i) => window.__solfege.session.notes[i]', i)
                await pg.evaluate('(m) => window.__solfege.onMidiNote(m)', n['midi'] + (1 if i == 3 else -12 if i == 17 else 0))
                if i in (8, 9, 10, 26, 49): lignes.append((i + 1, await pg.evaluate("() => Array.from(document.querySelectorAll('#systems svg')).map(g => +g.querySelector('path[data-n]').dataset.n / 8)")))
                if i == 12: await pg.screenshot(path=os.path.join(ICI, 'midi_encours.png'))
                await pg.wait_for_timeout(120)
            v = await pg.evaluate("() => window.__solfege.verdicts().map(q => q ? q.v : null)")
            s = await pg.evaluate("() => { const s = window.__solfege.session; return { over: s.over, clefs: s.clefs, generees: s.notes.length, son: window.__solfege.son }; }")
            print('60 notes jouées :', sum(x == 'ok' for x in v), 'justes | fausses :', [i for i, x in enumerate(v) if x != 'ok'], '| séance en cours :', not s['over'], '| clés reprises des anciennes préférences :', s['clefs'], '| micro ouvert :', s['son'] is not None)
            print('portées affichées après n notes jouées (rang dans la lecture, de haut en bas) :', lignes)
            print('ligne du bas :', repr(await pg.inner_text('#result')), '| erreurs :', errs)
            await pg.screenshot(path=os.path.join(ICI, 'midi_fin.png'))
            await pg.click('#quit'); await pg.wait_for_timeout(200)
            rec = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions')).slice(-1)[0]")
            print('séance gardée :', {k: rec[k] for k in ('fmt', 'mode', 'input', 'n', 'ok', 'faux', 'manque', 'rate', 'acc')}, '| notes 3 et 4 :', rec['notes'][3:5], '| séances :', await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions')).length"))
            await b.close()
asyncio.run(main())
