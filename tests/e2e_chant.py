"""Chant de bout en bout : Chrome sans écran, une voix de synthèse sert de micro et chante les notes demandées.
Puis les réglages ouverts depuis l'exercice, et l'écran d'enregistrement des noms d'intervalles."""
import asyncio, base64, json, os, struct
import numpy as np
from scipy.io import wavfile
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))
SR = 48000
hz = lambda m: 440 * 2 ** ((m - 69) / 12)

def voice(dur, f, scoop=-150, vib=15):
    t = np.arange(int(dur * SR)) / SR
    fi = f * 2 ** ((scoop * np.exp(-t / 0.06) + vib * np.sin(2 * np.pi * 5.5 * t)) / 1200)
    ph = 2 * np.pi * np.cumsum(fi) / SR
    env = np.minimum(1, t / 0.03) * np.minimum(1, (dur - t) / 0.03)
    return env * 0.2 * (np.sin(ph) + 0.6 * np.sin(2 * ph) + 0.4 * np.sin(3 * ph) + 0.2 * np.sin(5 * ph)) / 2.2

def wav(nom, notes, dur):
    """notes : (instant, durée, numéro MIDI chanté)"""
    x = np.random.default_rng(0).standard_normal(int(dur * SR)) * 0.0005
    for t, d, m in notes:
        seg = voice(d, hz(m)); i = int(t * SR); x[i:i + len(seg)] += seg
    chemin = os.path.join(ICI, nom); wavfile.write(chemin, SR, np.clip(x * 32767, -32768, 32767).astype(np.int16))
    return chemin

async def page(p, base, chemin, extra='', prefs=None):
    b = await p.chromium.launch(channel='chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        f'--use-file-for-fake-audio-capture={chemin}%noloop', '--autoplay-policy=no-user-gesture-required'])
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, permissions=['microphone'])
    if prefs: await ctx.add_init_script("if (!localStorage.getItem('solfege.prefs')) localStorage.setItem('solfege.prefs', %s)" % json.dumps(json.dumps(prefs)))
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    await pg.goto(base + '?debug' + extra); await pg.wait_for_timeout(700)
    return b, pg, errs

ETAT = "() => { const s = window.__solfege.session; return s && { exo: s.exo, phase: s.phase, j: s.j, n: s.n, pause: s.pause, titre: s.it && s.it.titre, sous: s.it && s.it.sous, cibles: s.it && s.it.cibles, res: s.results, reprises: s.reprises, aides: s.aides, tenue: s.hold && s.hold.holdMs, etat: window.__solfege.son && window.__solfege.son.ctx.state }; }"
shot = lambda pg, nom: pg.screenshot(path=os.path.join(ICI, nom))

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            # 1. Intervalles, note de départ chantée. Au deuxième, la voix tient d'abord un ton trop bas : reprise.
            w = wav('chant_iv.wav', [(2.0, 1.4, 48), (3.6, 1.4, 55), (6.9, 0.8, 58), (9.4, 1.4, 60), (10.9, 1.4, 56)], 15)
            b, pg, errs = await page(p, base, w, '&iv=48:55,60:56')
            await shot(pg, 'accueil.png')
            await pg.click('#liste button[data-exo="intervalles"]'); await pg.wait_for_timeout(900)
            e0 = await pg.evaluate(ETAT)
            await pg.wait_for_timeout(2300); e1 = await pg.evaluate(ETAT)       # ≈ 3,3 s : la note de départ est tenue
            await pg.wait_for_timeout(4800); e2 = await pg.evaluate(ETAT)       # ≈ 8,1 s : un ton trop bas a été tenu
            rouge = await pg.evaluate("() => Array.from(document.querySelectorAll('#systems circle[data-c]')).map(c => c.getAttribute('fill'))")
            await shot(pg, 'iv_reprise.png')
            await pg.wait_for_timeout(4700); e3 = await pg.evaluate(ETAT); bas = await pg.inner_text('#result')      # ≈ 12,8 s
            print('1. Intervalles :', e0['titre'], e0['sous'], e0['cibles'], '| à 3,3 s : note', e1['j'], e1['phase'], '| à 8,1 s, après un ton trop bas tenu 0,8 s :', e2['titre'], e2['sous'], 'phase', e2['phase'], 'reprises', e2['reprises'], 'pastilles', rouge)
            print('   à 12,8 s : trouvés', e3['n'], '| écarts', [r['cents'] for r in e3['res']], '| reprises', [r['reprises'] for r in e3['res']], '| ligne du bas', repr(bas), '| erreurs :', errs)
            await pg.click('#quit'); await pg.wait_for_timeout(200)
            st = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions') || '[]').pop()")
            print('   séance gardée :', {k: st[k] for k in ('mode', 'n', 'tenue')}, st['items'][:2], '| son fermé :', await pg.evaluate("() => window.__solfege.son === null"))
            await b.close()

            # 2. Accords : D–7. La voix tient sol au lieu de fa (reprise), puis chante tout, en restant une seconde de trop sur le ré.
            w = wav('chant_ac.wav', [(2.0, 1.4, 50), (3.6, 1.0, 55), (6.3, 1.9, 50), (8.3, 1.4, 53), (9.8, 1.4, 57), (11.3, 1.4, 60)], 14)
            b, pg, errs = await page(p, base, w, '&ac=m7@2')
            await pg.click('#liste button[data-exo="accords"]'); await pg.wait_for_timeout(3300)
            e1 = await pg.evaluate(ETAT)
            await pg.wait_for_timeout(1500); e2 = await pg.evaluate(ETAT); await shot(pg, 'ac_reprise.png')           # ≈ 4,8 s
            pastilles = await pg.evaluate("() => Array.from(document.querySelectorAll('#systems circle[data-c]')).map(c => c.getAttribute('fill'))")
            await pg.wait_for_timeout(3200); e3 = await pg.evaluate(ETAT)                                             # ≈ 8,0 s : ré tenu depuis 1,7 s
            await pg.wait_for_timeout(5000); e4 = await pg.evaluate(ETAT)                                             # ≈ 13 s
            print('2. Accords :', e1['titre'], e1['cibles'], '| à 3,3 s : note', e1['j'], '| à 4,8 s, sol tenu au lieu de fa : phase', e2['phase'], 'note', e2['j'], 'reprises', e2['reprises'], 'pastilles', pastilles)
            print('   à 8,0 s, ré encore tenu après sa validation : note', e3['j'], 'reprises', e3['reprises'], '| à 13 s : trouvés', e4['n'], '| écarts', [r['cents'] for r in e4['res']], '| reprises', [r['reprises'] for r in e4['res']], '| erreurs :', errs)
            await b.close()

            # 3. Portée : fa puis la bémol, une octave plus bas. Après le fa, la voix se tait trop longtemps : reprise.
            w = wav('chant_pt.wav', [(2.0, 1.4, 53), (7.6, 1.4, 53), (9.1, 1.4, 56)], 12)
            b, pg, errs = await page(p, base, w, '&pt=1:3:-1')
            await pg.click('#liste button[data-exo="portee"]'); await pg.wait_for_timeout(3300)
            e1 = await pg.evaluate(ETAT); await shot(pg, 'pt_vise.png')
            await pg.wait_for_timeout(2900); e2 = await pg.evaluate(ETAT); await shot(pg, 'pt_reprise.png')           # ≈ 6,2 s
            tetes = await pg.evaluate("() => Array.from(document.querySelectorAll('#systems path[data-c]')).map(c => c.getAttribute('fill'))")
            await pg.wait_for_timeout(4800); e3 = await pg.evaluate(ETAT)                                             # ≈ 11 s
            print('3. Portée : cibles', e1['cibles'], '| à 3,3 s : note', e1['j'], '| à 6,2 s, après 2,7 s sans la seconde note : phase', e2['phase'], 'note', e2['j'], 'reprises', e2['reprises'], 'têtes', tetes, '| à 11 s : trouvés', e3['n'], '| reprises', [r['reprises'] for r in e3['res']], '| erreurs :', errs)
            await b.close()

            # 4. Réglages de l'exercice en cours seulement ; courbe masquée ; aides plaqué et arpégé.
            w = wav('silence.wav', [], 30)
            b, pg, errs = await page(p, base, w)
            await pg.click('#liste button[data-exo="accords"]'); await pg.wait_for_timeout(1800)
            aides = await pg.evaluate("() => Array.from(document.querySelectorAll('#aides button')).map(b => b.textContent)")
            await pg.click('#aides button[data-h="arpege"]'); await pg.wait_for_timeout(150); a1 = await pg.evaluate(ETAT)
            await pg.wait_for_timeout(3600); a2 = await pg.evaluate(ETAT)
            await pg.click('#aides button[data-h="plaque"]'); await pg.wait_for_timeout(150); a3 = await pg.evaluate(ETAT)
            print('4. Aides', aides, ': arpégé →', a1['phase'], 'aides', a1['aides'], '| 3,7 s plus tard', a2['phase'], 'note', a2['j'], '| plaqué →', a3['phase'], 'aides', a3['aides'])
            await pg.click('#regler'); await pg.wait_for_timeout(200)
            e1 = await pg.evaluate(ETAT); await shot(pg, 'reglages_accords.png')
            sheet = await pg.evaluate("() => ({ exos: document.querySelectorAll('#reglages [data-k=\"exo\"]').length, ecriture: document.querySelectorAll('#reglages [data-k=\"accords.notation\"]').length, accords: Array.from(document.querySelectorAll('#reglages [data-k=\"accords.types\"]')).map(b => b.textContent).join(' '), rangs: Array.from(document.querySelectorAll('#reglages .rang > span')).map(s => s.textContent) })")
            for v in ('aug', 'dim', 'mMaj7'): await pg.click(f'#reglages button[data-k="accords.types"][data-v="{v}"]')
            await pg.click('#reglages button[data-k="tenue"][data-v="1"]')
            await pg.click('#reglages button[data-k="courbe"]')
            await pg.click('#fermer'); await pg.wait_for_timeout(1200)
            e2 = await pg.evaluate(ETAT); pr = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.prefs'))")
            sans = await pg.evaluate("() => [document.getElementById('trace') === null, document.querySelector('#systems svg').getAttribute('height')]")
            await shot(pg, 'ac_sans_courbe.png')
            print('   réglages : pause', e1['pause'], '|', sheet, '| après fermeture :', e2['exo'], e2['titre'], 'tenue', e2['tenue'], '| gardé : accords', pr['accords'], 'tenue', pr['tenue'], 'courbe', pr['courbe'], '| courbe absente, hauteur du dessin :', sans)
            await pg.click('#quit'); await pg.wait_for_timeout(200)
            await pg.click('#liste button[data-exo="notes"]'); await pg.wait_for_timeout(900)
            await pg.click('#regler')
            await pg.click('#reglages button[data-k="notes.clef"][data-v="deux"]')
            for k, v, n in (('sol.0', '-1', 3), ('sol.1', '1', 4), ('fa.0', '-1', 4), ('fa.1', '-1', 2)):
                for _ in range(n): await pg.click(f'#reglages button[data-k="{k}"][data-v="{v}"]')
            rangs = await pg.evaluate("() => Array.from(document.querySelectorAll('#reglages .rang > span')).map(s => s.textContent)")
            await shot(pg, 'reglages_notes.png')
            await pg.click('#fermer'); await pg.wait_for_timeout(900)
            e4 = await pg.evaluate("() => { const s = window.__solfege.session; return { kind: s.kind, clefs: s.clefs, et: s.et, aides: !document.getElementById('aides').hidden }; }")
            print('   Lecture · Notes : rangs', rangs, '|', e4, '| erreurs :', errs)
            await b.close()

            # 6. Micro coupé : le micro est rendu (le faux micro de Chrome repart alors du début de son fichier quand on le reprend).
            w = wav('chant_muet.wav', [(2.0, 1.4, 48), (3.5, 1.4, 52), (5.0, 1.4, 55)], 9)
            b, pg, errs = await page(p, base, w, '&ac=maj@0')
            await pg.click('#liste button[data-exo="accords"]'); await pg.wait_for_timeout(900)
            await pg.click('#mic'); await pg.wait_for_timeout(1500)
            m1 = await pg.evaluate("() => { const s = window.__solfege.session; return [s.muet, s.phase, s.reprises, s.track.length, document.getElementById('mic').getAttribute('aria-pressed'), window.__solfege.son.mic.ouvert]; }")
            await shot(pg, 'micro_coupe.png')
            await pg.click('#aides button[data-h="plaque"]'); await pg.wait_for_timeout(300)
            m2 = await pg.evaluate("() => [window.__solfege.son.ctx.state, window.__solfege.session.aides]")
            await pg.click('#mic'); await pg.wait_for_timeout(300)
            m3 = await pg.evaluate("() => window.__solfege.son.mic.ouvert")
            await pg.wait_for_timeout(7000)
            m4 = await pg.evaluate(ETAT)
            print('6. Micro coupé : [coupé, phase, reprises, points de courbe, bouton, micro ouvert] =', m1, '| piano pendant la coupure (contexte, aides) :', m2, '| micro repris :', m3, '| accord chanté ensuite : trouvés', m4['n'], 'reprises', [r['reprises'] for r in m4['res']], '| erreurs :', errs)
            await b.close()

            # 5. Lecture d'intervalles : une série enregistrée (cadence accélérée pour le test).
            b, pg, errs = await page(p, base, w, '&periode=60')
            await pg.click('#liste button[data-exo="noms"]'); await pg.wait_for_timeout(700)
            await pg.click('#regler'); await pg.click('#reglages button[data-a="serie"]'); await pg.wait_for_timeout(700); await shot(pg, 'noms_intro.png')
            print('5. bouton Réglages masqué sur l\'écran d\'enregistrement :', await pg.is_hidden('#regler'))
            await pg.click('#systems button[data-e="go"]'); await pg.wait_for_timeout(1500); await shot(pg, 'noms_dire.png')
            await pg.wait_for_timeout(2600)
            fin = await pg.inner_text('#systems')
            f = await pg.evaluate('''async () => { const f = window.__solfege.session.fichier; const u = new Uint8Array(await f.arrayBuffer()); let s = '';
                for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192)); return { name: f.name, b64: btoa(s) }; }''')
            raw = base64.b64decode(f['b64']); pos, blocs = 12, {}
            while pos + 8 <= len(raw):
                n = struct.unpack('<I', raw[pos + 4:pos + 8])[0]; blocs[raw[pos:pos + 4]] = raw[pos + 8:pos + 8 + n]; pos += 8 + n + (n & 1)
            meta = json.loads(blocs[b'sLFG'].decode('utf-8')); noms = [q[1] for q in meta['phrases']]
            print('5. Enregistrement :', repr(fin.replace('\n', ' / ')), '|', f['name'], len(raw), 'octets, son', round(len(blocs[b'data']) / 32000, 1), 's |', len(noms), 'noms,', len(set(noms)), 'différents, chacun', sorted({noms.count(q) for q in noms}), 'fois | instants croissants :', all(a[0] <= c[0] for a, c in zip(meta['phrases'], meta['phrases'][1:])), '| exemples', meta['phrases'][:2], '| erreurs :', errs)
            await b.close()
if __name__ == "__main__": asyncio.run(main())
