"""Mains libres : écran, reconnaissance et chant à la voix (mots reconnus simulés par le crochet de test), menu vocal,
enregistrement d'un nouveau vocabulaire. ?muet coupe la voix de l'app (pas de voix de synthèse dans Chrome sans écran)."""
import asyncio, base64, json, os, struct, urllib.request
from playwright.async_api import async_playwright
from serveur import serveur
from e2e_chant import wav, ICI

ETAT = "() => { const s = window.__solfege.session; return s && { kind: s.kind, exo: s.exo, input: s.input, mains: !!s.mains, it: s.it && (s.it.st || s.it.id), etat: s.etat, n: s.n, v: (s.v || []).map(q => q.v + ':' + q.rep), ecoutes: s.ecoutes, niveau: s.niveau, famille: s.famille, micro: window.__solfege.son && window.__solfege.son.micro, phase: s.phase, j: s.j, res: s.results && s.results.length }; }"

async def ouvrir(p, base, extra, micro):
    b = await p.chromium.launch(channel='chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        f'--use-file-for-fake-audio-capture={micro}%noloop', '--autoplay-policy=no-user-gesture-required'])
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, permissions=['microphone'])
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    await pg.goto(base + '?muet' + extra); await pg.wait_for_timeout(700)
    await pg.evaluate("() => { window.__osc = 0; const o = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { window.__osc++; return o.apply(this, a); }; }")
    return b, pg, errs

async def main():
    with serveur() as (base, _):
        print('deuxième icône :', urllib.request.urlopen(base + 'mains-libres/').status, json.loads(urllib.request.urlopen(base + 'mains-libres/manifest.webmanifest').read())['start_url'])
        async with async_playwright() as p:
            silence = os.path.join(ICI, 'silence.wav')
            if not os.path.exists(silence): wav('silence.wav', [], 30)
            b, pg, errs = await ouvrir(p, base, '', silence)
            await pg.screenshot(path=os.path.join(ICI, 'ml_accueil.png'))
            await pg.click('#mainslibres'); await pg.wait_for_timeout(500)
            ecran = await pg.evaluate("() => ({ exos: Array.from(document.querySelectorAll('#systems [data-ml]')).map(b => b.textContent + (b.classList.contains('manque') ? '(voix à enregistrer)' : '')), voix: Array.from(document.querySelectorAll('#systems [data-voc]')).map(b => b.textContent + ':' + b.className), micro: window.__solfege.son, reglages: document.getElementById('regler').hidden })")
            await pg.screenshot(path=os.path.join(ICI, 'ml_ecran.png'))
            print('écran Mains libres :', ecran)
            # écoute d'intervalles à la voix
            await pg.click('#systems [data-ml="rIntervalles"]'); await pg.wait_for_timeout(900)
            e0 = await pg.evaluate(ETAT)
            await pg.evaluate("(st) => window.__solfege.entendu('noms', st - 1)", e0['it']); await pg.wait_for_timeout(120)
            e1 = await pg.evaluate(ETAT); o1 = await pg.evaluate('() => window.__osc')
            await pg.wait_for_timeout(800); e2 = await pg.evaluate(ETAT)
            faux = 1 if e2['it'] != 1 else 2
            await pg.evaluate("(c) => window.__solfege.entendu('noms', c - 1)", faux); await pg.wait_for_timeout(700)
            e3 = await pg.evaluate(ETAT)
            await pg.evaluate("(c) => window.__solfege.entendu('noms', c - 1)", faux); await pg.wait_for_timeout(200)
            e4 = await pg.evaluate(ETAT)
            await pg.wait_for_timeout(4200); e5 = await pg.evaluate(ETAT)
            print('écoute à la voix :', e0['kind'], e0['input'], 'micro', e0['micro'], '| juste →', e1['etat'], 'sons', o1, '| question suivante', e2['it'] != e0['it'] or e2['etat'] == 'attend', '| faux →', e3['etat'], '| deuxième faux → réponse donnée', e4['etat'], '| puis question suivante seule', e5['etat'], '| comptées', e5['v'])
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'encore')"); await pg.wait_for_timeout(100)
            e6 = await pg.evaluate(ETAT)
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'suivant')"); await pg.wait_for_timeout(200)
            e7 = await pg.evaluate(ETAT)
            print('commandes : « encore » → réécoutes', e6['ecoutes'], '| « suivant » →', e7['v'][-1], '| erreurs', errs)
            # « stop » avec une voix de commandes : menu vocal, puis chant d'accords
            await pg.evaluate("() => { window.__solfege.session.vocs.commandes = {}; window.__solfege.entendu('commandes', 'stop'); }"); await pg.wait_for_timeout(900)
            m1 = await pg.evaluate(ETAT); await pg.screenshot(path=os.path.join(ICI, 'ml_menu.png'))
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'chant')"); await pg.wait_for_timeout(100); m2 = await pg.evaluate(ETAT)
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'accords')"); await pg.wait_for_timeout(1500); m3 = await pg.evaluate(ETAT)
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'réponse')"); await pg.wait_for_timeout(100); m4 = await pg.evaluate(ETAT)
            print('menu vocal :', m1['kind'], 'niveau', m1['niveau'], '| « chant » → niveau', m2['niveau'], m2['famille'], '| « accords » →', m3['kind'], m3['exo'], 'mains', m3['mains'], 'accord', m3['it'], 'phase', m3['phase'], '| « réponse » → phase', m4['phase'], '| erreurs', errs)
            # « stop », puis « reconnaissance » « intervalles » (voix livrée) : reconnaissance d'intervalles à la voix
            await pg.evaluate("() => { window.__solfege.session.vocs.commandes = {}; window.__solfege.entendu('commandes', 'stop'); }"); await pg.wait_for_timeout(900)
            question = await pg.inner_text('#systems .mot')
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'reconnaissance')"); await pg.wait_for_timeout(100); m6 = await pg.evaluate(ETAT)
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'intervalles')"); await pg.wait_for_timeout(1500); m7 = await pg.evaluate(ETAT)
            print('menu vocal :', repr(question), '| « reconnaissance » → niveau', m6['niveau'], m6['famille'], '| « intervalles » →', m7['kind'], m7['exo'], 'mains', m7['mains'], '| erreurs', errs)
            await pg.evaluate("() => { window.__solfege.session.vocs.commandes = {}; window.__solfege.entendu('commandes', 'stop'); }"); await pg.wait_for_timeout(900)
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'chant')"); await pg.wait_for_timeout(100)
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'accords')"); await pg.wait_for_timeout(1500)
            await pg.evaluate("() => window.__solfege.entendu('commandes', 'stop')"); await pg.wait_for_timeout(700)
            m5 = await pg.evaluate(ETAT)
            print('« stop » dans le chant sans voix de commandes →', m5['kind'], '| micro rendu :', await pg.evaluate("() => window.__solfege.son === null"))
            # enregistrement d'un vocabulaire
            await pg.click('#systems [data-voc="accords"]'); await pg.wait_for_timeout(600)
            intro = (await pg.inner_text('#systems')).replace('\n', ' / ')
            await b.close()

            b, pg, errs = await ouvrir(p, base, '&periode=60', silence)
            await pg.click('#mainslibres'); await pg.wait_for_timeout(400)
            await pg.click('#systems [data-voc="accords"]'); await pg.wait_for_timeout(600)
            await pg.click('#systems button[data-e="go"]'); await pg.wait_for_timeout(4800)
            j = await pg.evaluate("() => { const s = window.__solfege.session; return { vocab: s.vocab, n: s.journal.length, mots: [...new Set(s.journal.map(q => q[1]))], fichier: s.fichier && s.fichier.name }; }")
            print('enregistrement Accords :', intro[:120], '… |', j['vocab'], j['n'], 'mots affichés,', len(j['mots']), 'différents :', j['mots'], '| fichier', j['fichier'], '| erreurs', errs)
            await b.close()

            # chant d'accords en mains libres, voix de synthèse : sons à chaque note tenue et à la fin
            w = wav('chant_ml.wav', [(2.0, 1.4, 48), (3.5, 1.4, 52), (5.0, 1.4, 55)], 9)
            b, pg, errs = await ouvrir(p, base, '&ac=maj@0', w)
            await pg.click('#mainslibres'); await pg.wait_for_timeout(300)
            await pg.click('#systems [data-ml="accords"]'); await pg.wait_for_timeout(7200)
            c = await pg.evaluate(ETAT); o = await pg.evaluate('() => window.__osc')
            print("chant d'accords mains libres :", c['kind'], 'mains', c['mains'], '| trouvés', c['n'], '| sons émis (déclics et juste)', o, '| erreurs', errs)
            await b.close()
if __name__ == "__main__":
    asyncio.run(main())
