"""Reconnaissance à l'oreille (au toucher, sans micro), chant de gammes (voix de synthèse), lecture d'intervalles au toucher."""
import asyncio, json, os
import numpy as np
from playwright.async_api import async_playwright
from serveur import serveur
from e2e_chant import wav, ICI

IT = "() => { const s = window.__solfege.session; return s && { kind: s.kind, exo: s.exo, input: s.input, it: s.it && { id: s.it.id, st: s.it.st, jeu: s.it.jeu, n: s.it.notes && s.it.notes.length }, etat: s.etat, v: s.v, n: s.n, micro: window.__solfege.son ? window.__solfege.son.micro : null, choix: Array.from(document.querySelectorAll('#choix button')).map(b => [b.dataset.r, b.textContent, b.className]) }; }"

async def ouvrir(p, base, extra='', prefs=None, micro=None):
    args = ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']
    if micro: args += ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', f'--use-file-for-fake-audio-capture={micro}%noloop']
    b = await p.chromium.launch(channel='chrome', args=args)
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, permissions=['microphone'] if micro else [])
    if prefs: await ctx.add_init_script("if (!localStorage.getItem('solfege.prefs')) localStorage.setItem('solfege.prefs', %s)" % json.dumps(json.dumps(prefs)))
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    await pg.goto(base + '?debug' + extra); await pg.wait_for_timeout(700)
    return b, pg, errs

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            b, pg, errs = await ouvrir(p, base)
            await pg.screenshot(path=os.path.join(ICI, 'accueil.png'))
            for exo, cle in (('rAccords', 'id'), ('rIntervalles', 'st'), ('rGammes', 'id')):
                await pg.click(f'#liste button[data-exo="{exo}"]'); await pg.wait_for_timeout(900)
                e0 = await pg.evaluate(IT); juste = str(e0['it'][cle]); autre = next(c[0] for c in e0['choix'] if c[0] != juste and not (exo == 'rGammes' and c[0] in ('ionien', 'eolien')))
                await pg.screenshot(path=os.path.join(ICI, f'{exo}.png'))
                await pg.click('#systems button[data-e="rejouer"]'); await pg.wait_for_timeout(300)
                await pg.click(f'#choix button[data-r="{autre}"]'); await pg.wait_for_timeout(150); e1 = await pg.evaluate(IT)
                await pg.click(f'#choix button[data-r="{juste}"]'); await pg.wait_for_timeout(150); e2 = await pg.evaluate(IT)
                await pg.wait_for_timeout(1100); e3 = await pg.evaluate(IT)
                juste2 = str(e3['it'][cle]); await pg.click(f'#choix button[data-r="{juste2}"]'); await pg.wait_for_timeout(1100); e4 = await pg.evaluate(IT)
                print(f"{exo} : {len(e0['choix'])} réponses proposées, micro ouvert : {e0['micro']} | joué : {e0['it']} | mauvaise réponse → {e1['etat']}, bouton {[c[2] for c in e1['choix'] if c[0] == autre]} | bonne → {e2['etat']}, bouton {[c[2] for c in e2['choix'] if c[0] == juste]} | question suivante seule : {e3['etat'] == 'attend'} | réponses comptées {[q['v'] for q in e4['v']]}, réécoutes {[q['ecoutes'] for q in e4['v']]}")
                await pg.click('#regler'); await pg.wait_for_timeout(150)
                rangs = await pg.evaluate("() => Array.from(document.querySelectorAll('#reglages .rang')).map(r => (r.querySelector('span') ? r.querySelector('span').textContent : '') + ' : ' + Array.from(r.querySelectorAll('button')).map(b => b.textContent + (b.getAttribute('aria-checked') === 'true' ? '✓' : '')).join(' '))")
                print('   réglages :', ' | '.join(rangs)[:520])
                if exo == 'rGammes':
                    for v in ('ionien', 'dorien'): await pg.click(f'#reglages button[data-k="rGammes.types"][data-v="{v}"]')
                    await pg.screenshot(path=os.path.join(ICI, 'reglages_rGammes.png'))
                if exo == 'rIntervalles':
                    await pg.click('#reglages button[data-k="rIntervalles"][data-v="harmonique"]'); await pg.click('#reglages button[data-k="rIntervalles"][data-v="melodique"]')
                await pg.click('#fermer'); await pg.wait_for_timeout(900); e5 = await pg.evaluate(IT)
                if exo == 'rIntervalles': print('   après « Ensemble » seul :', e5['it']['jeu'])
                if exo == 'rGammes':
                    # majeure et ionien sont les mêmes notes : l'une ou l'autre réponse est juste
                    for _ in range(12):
                        e = await pg.evaluate(IT)
                        if e['it']['id'] in ('majeure', 'ionien'):
                            rep = 'ionien' if e['it']['id'] == 'majeure' else 'majeure'
                            await pg.click(f'#choix button[data-r="{rep}"]'); await pg.wait_for_timeout(150)
                            print('   joué', e['it']['id'], '→ répondu', rep, ':', (await pg.evaluate(IT))['etat']); break
                        await pg.click(f"#choix button[data-r=\"{e['it']['id']}\"]"); await pg.wait_for_timeout(1000)
                bas = await pg.inner_text('#result')
                await pg.click('#quit'); await pg.wait_for_timeout(200)
                st = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions') || '[]').pop()")
                print('   ligne du bas', repr(bas), '| séance gardée :', {k: st[k] for k in ('mode', 'input', 'n', 'ok')}, st['items'][:1], '| erreurs :', errs)
            await b.close()

            # lecture d'intervalles au toucher
            b, pg, errs = await ouvrir(p, base, '&nm=3,7', prefs={'noms': {'reponse': 'toucher', 'iv': [3, 4, 7]}})
            await pg.click('#liste button[data-exo="noms"]'); await pg.wait_for_timeout(500); e0 = await pg.evaluate(IT)
            await pg.screenshot(path=os.path.join(ICI, 'noms_toucher.png'))
            await pg.click('#choix button[data-r="4"]'); await pg.wait_for_timeout(100); e1 = await pg.evaluate(IT)
            await pg.click('#choix button[data-r="3"]'); await pg.wait_for_timeout(600); e2 = await pg.evaluate(IT)
            await pg.click('#choix button[data-r="7"]'); await pg.wait_for_timeout(600); e3 = await pg.evaluate(IT)
            print('Lecture d\'intervalles au toucher :', e0['kind'], e0['input'], 'micro', e0['micro'], '| boutons', [c[1] for c in e0['choix']], '| tierce majeure touchée pour une tierce mineure →', e1['etat'], '| puis la bonne, puis la quinte : comptées', [q['v'] for q in e3['v']], '| micro masqué :', await pg.is_hidden('#mic'), '| erreurs :', errs)
            await b.close()

            # chant d'une gamme : pentatonique majeure de do, six notes
            w = wav('chant_gm.wav', [(2.0 + 1.5 * i, 1.4, m) for i, m in enumerate((48, 50, 52, 55, 57, 60))], 13)
            b, pg, errs = await ouvrir(p, base, '&gm=pentaMaj@0', micro=w)
            await pg.click('#liste button[data-exo="gammes"]'); await pg.wait_for_timeout(5300)
            e1 = await pg.evaluate("() => { const s = window.__solfege.session; return [s.it.titre, s.it.sous, s.it.cibles, s.j, Array.from(document.querySelectorAll('#aides button')).filter(b => !b.hidden).map(b => b.textContent)]; }")
            await pg.screenshot(path=os.path.join(ICI, 'gammes_chant.png'))
            await pg.wait_for_timeout(6300)
            e2 = await pg.evaluate("() => { const s = window.__solfege.session; return [s.n, s.results.map(r => [r.quoi, r.cents, r.reprises])]; }")
            print('Chant de gamme :', e1[:3], '| à 5,3 s : note', e1[3], '| aides', e1[4], '| à 11,6 s : trouvées', e2[0], e2[1], '| ligne du bas', repr(await pg.inner_text('#result')), '| erreurs :', errs)
            await b.close()
asyncio.run(main())
