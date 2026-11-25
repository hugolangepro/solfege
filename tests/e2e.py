"""Bout en bout : Chrome sans écran, un extrait de l'enregistrement de mesure sert de micro, l'app doit valider les notes.
L'extrait (tests/s13_48k.wav) n'est pas dans le dépôt : c'est la voix d'Hugo."""
import asyncio, base64, json, os, struct, subprocess, sys, urllib.parse
import numpy as np
from playwright.async_api import async_playwright
from serveur import serveur

ICI = os.path.dirname(os.path.abspath(__file__))
SEQ = open(os.path.join(ICI, 's13_seq.txt')).read().strip().split(',')
WAV = os.environ.get('SOLFEGE_WAV', os.path.join(ICI, 's13_48k.wav'))
BRUIT = os.path.join(ICI, 'clavier_44k.wav')          # frappe au clavier (ESC-50, pour l'essai seulement ; hors dépôt)
def args_for(wav):
    return ['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
            f'--use-file-for-fake-audio-capture={wav}%noloop', '--autoplay-policy=no-user-gesture-required']
ARGS = args_for(WAV)
DIAG_JS = '''async () => { const f = window.__solfege.diagFile(); if (!f) return null;
  const u = new Uint8Array(await f.arrayBuffer()); let s = '';
  for (let i = 0; i < u.length; i += 8192) s += String.fromCharCode.apply(null, u.subarray(i, i + 8192));
  return { name: f.name, type: f.type, b64: btoa(s) }; }'''

WATCH_JS = '''() => { window.__log = [];
  const snap = () => { const s = window.__solfege.session; if (!s || !s.heard) return;
    const reds = Array.from(document.querySelectorAll('#systems path[data-n]')).filter(p => p.getAttribute('fill') === '#B3261E').map(p => +p.dataset.n);
    const cur = document.querySelector('#systems polygon');
    window.__log.push({ t: performance.now(), heard: s.heard.length, reds, texts: document.querySelectorAll('#systems text').length, ellipses: document.querySelectorAll('#systems ellipse').length }); };
  new MutationObserver(snap).observe(document.getElementById('systems'), { childList: true }); }'''

async def run(base, name, seq, viewport, wait_s, shots=True, debug=False, clef=None, wav=None, extra='', etendue=None):
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=args_for(wav) if wav else ARGS)
        ctx = await b.new_context(viewport=viewport, device_scale_factor=2, permissions=['microphone'])
        notes = {'clef': clef or 'sol', 'input': 'voix', 'sol': [-2, 10], 'fa': [-2, 10]}
        if etendue: notes.update(etendue)
        await ctx.add_init_script("if (!localStorage.getItem('solfege.prefs')) localStorage.setItem('solfege.prefs', %s)" % json.dumps(json.dumps({'notes': notes})))
        pg = await ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        await pg.goto(base + '?seq=' + urllib.parse.quote(','.join(seq)) + ('&debug' if debug else '') + extra)
        await pg.wait_for_timeout(800)
        if shots: await pg.screenshot(path=os.path.join(ICI, f'{name}_accueil.png'))
        await pg.evaluate(WATCH_JS)
        await pg.click('#liste button[data-exo="notes"]')
        await pg.wait_for_timeout(11000)
        if shots: await pg.screenshot(path=os.path.join(ICI, f'{name}_encours.png'))
        await pg.wait_for_timeout(int(wait_s * 1000) - 11000)
        state = await pg.evaluate('''() => { const s = window.__solfege.session; if (!s) return null;
            return { over: s.over, rate: s.rate, generees: s.notes.length, heard: s.heard.length, tStart: s.tStart, version: window.__solfege.VERSION,
                     raw: s.raw.length, bypass: s.bypass, gateOff: window.__solfege.gateOff, stored: localStorage.getItem('solfege.gate'),
                     lignes: Array.from(document.querySelectorAll('#systems svg')).map(g => +g.querySelector('path[data-n]').dataset.n / 8),
                     repere: document.querySelectorAll('#systems polygon').length,
                     vt: window.__solfege.verdicts().map(q => q && q.time !== undefined ? Math.round(q.time * 1000) : null),
                     v: window.__solfege.verdicts().map(q => q ? q.v + (q.v === 'faux' ? ':' + q.cls : '') : null) }; }''')
        result = await pg.inner_text('#result')
        if shots: await pg.screenshot(path=os.path.join(ICI, f'{name}_fin.png'))
        diag = await pg.evaluate(DIAG_JS) if debug else None
        log = await pg.evaluate('() => window.__log')
        heard = await pg.evaluate("() => window.__solfege.session ? window.__solfege.session.heard.map(c => [c.cls, +c.conf.toFixed(2), Math.round(c.time * 1000), Math.round(c.delay * 1000), c.early ? 1 : 0]) : []")
        await pg.click('#quit'); await pg.wait_for_timeout(200)
        accueil = await pg.is_visible('#home')
        stored = await pg.evaluate("() => JSON.parse(localStorage.getItem('solfege.sessions') || '[]')")
        await b.close()
        return state, result, errs, stored, diag, accueil, log, heard

def lire_diag(raw):
    assert raw[:4] == b'RIFF' and raw[8:12] == b'WAVE', 'en-tête'
    assert struct.unpack('<I', raw[4:8])[0] == len(raw) - 8, 'taille RIFF'
    pos, blocs = 12, {}
    while pos + 8 <= len(raw):
        n = struct.unpack('<I', raw[pos + 4:pos + 8])[0]
        blocs[raw[pos:pos + 4]] = raw[pos + 8:pos + 8 + n]; pos += 8 + n + (n & 1)
    assert pos == len(raw), 'blocs mal alignés'
    return struct.unpack('<HHIIHH', blocs[b'fmt '][:16]), np.frombuffer(blocs[b'data'], '<i2'), json.loads(blocs[b'sLFG'].decode('utf-8'))

async def service_worker(base, proc):
    """Le service worker prend la page en charge, puis la page s'ouvre encore quand le serveur est éteint."""
    async with async_playwright() as p:
        b = await p.chromium.launch(channel='chrome', args=ARGS)
        pg = await (await b.new_context(viewport={'width': 393, 'height': 852})).new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        await pg.goto(base); await pg.wait_for_timeout(2500)
        await pg.reload(); await pg.wait_for_timeout(1500)
        pris = await pg.evaluate("() => !!navigator.serviceWorker.controller")
        portee = await pg.evaluate("async () => (await navigator.serviceWorker.getRegistration()).scope")
        proc.terminate(); proc.wait()
        await pg.reload(); await pg.wait_for_timeout(1500)
        titre = await pg.inner_text('h1')
        modele = await pg.evaluate("() => fetch('model.json').then(r => r.ok && r.json()).then(j => j && j.version).catch(e => 'échec : ' + e.message)")
        msg = await pg.inner_text('#msg')
        piano = await pg.evaluate("() => fetch('piano/60.mp3').then(r => r.ok && r.arrayBuffer()).then(a => a && a.byteLength).catch(e => 'échec : ' + e.message)")
        await pg.goto(base + '?input=midi'); await pg.wait_for_timeout(800)
        await pg.click('#liste button[data-exo="notes"]'); await pg.wait_for_timeout(300)
        n = await pg.evaluate("() => window.__solfege.session && document.querySelectorAll('#systems path[data-n]').length")
        await b.close()
        return pris, portee, titre, modele, msg, n, piano, errs

async def main():
    phone = {'width': 393, 'height': 852}
    ok32 = lambda v: sum(x == 'ok' for x in v[:32])
    with serveur() as (base, proc):
        st, res, errs, stored, diag, accueil, log, heard = await run(base, 'tel', SEQ, phone, 24)
        v = st['v'] if st else []
        print('A. 32 notes imposées, puis la lecture continue :', ok32(v), 'justes sur 32 | lues en tout', len(v), '| séance toujours en cours :', st and not st['over'], '| version', st and st['version'])
        print('   portées affichées (rang de la portée dans la lecture, de haut en bas) :', st['lignes'], '| repères :', st['repere'], '| ligne du bas :', repr(res), '| retour à l\'accueil par × :', accueil, '| erreurs :', errs)
        r = stored[-1]
        print('   séance gardée :', {k: r[k] for k in ('id', 'fmt', 'app', 'mode', 'input', 'n', 'ok', 'faux', 'manque', 'dur', 'rate', 'acc', 'etendue')}, '| notes[:3] =', r['notes'][:3], '| séances :', len(stored))

        alt = SEQ[:]; alt[5] = 'la' if alt[5] != 'la' else 'mi'; alt[20] = 'do' if alt[20] != 'do' else 'ré'
        st, res, errs, stored, diag, accueil, log, heard = await run(base, 'tel_faux', alt, phone, 24)
        v = st['v'] if st else []
        print('B. deux notes changées (cases 5 et 20) :', [(i, x) for i, x in enumerate(v[:32]) if x != 'ok'], '|', repr(res), '| erreurs :', errs)
        for j in (5, 20):
            first = next((e for e in log if j in e['reds']), None)
            idx = next((i for i, h in enumerate(heard) if h[2] == st['vt'][j]), None)
            print('   note %d : passée au rouge quand %s syllabes étaient entendues ; sa propre syllabe est la n° %s' % (j, first and first['heard'], idx is not None and idx + 1))

        st, res, errs, stored, diag, accueil, log, heard = await run(base, 'mac', SEQ, {'width': 1512, 'height': 900}, 24)
        v = st['v'] if st else []
        print('C. grand écran :', ok32(v), 'justes sur 32 |', repr(res), '| erreurs :', errs)

        st, res, errs, stored, diag, accueil, log, heard = await run(base, 'diag', SEQ, phone, 24, shots=False, debug=True)
        raw = base64.b64decode(diag['b64'])
        chemin = os.path.join(ICI, 'diag_test.wav'); open(chemin, 'wb').write(raw)
        fmt, pcm, meta = lire_diag(raw)
        print('D. fichier de diagnostic :', diag['name'], len(raw), 'octets | fmt', fmt, '| durée', round(len(pcm) / 16000, 1), 's')
        print('   compte rendu :', {k: meta[k] for k in ('app', 'exercice', 'modele', 'rate', 'tronque', 'mode')}, '| attendu conforme :', meta['attendu'][:32] == SEQ[:32], '| entendues :', len(meta['entendu']), '| verdicts justes :', sum(x == 'ok' for x in meta['verdicts']))
        rejeu = subprocess.run(['node', os.path.join(ICI, 'diag.mjs'), chemin], capture_output=True, text=True)
        print('   rejeu hors navigateur :', (rejeu.stdout.strip().splitlines() or [rejeu.stderr.strip()])[-1])

        st, res, errs, stored, diag, accueil, log, heard = await run(base, 'piano', SEQ, phone, 24, clef='deux')
        v = st['v'] if st else []
        r = stored[-1]
        print('F. système de piano à la voix :', ok32(v), 'justes sur 32 |', repr(res), '| mode gardé :', r['mode'], '| portées affichées :', st['lignes'], '| clés des 8 premières notes :', [q[0] for q in r['notes'][:8]], '| erreurs :', errs)

        st, res, errs, stored, diag, accueil, log, heard = await run(base, 'large', SEQ, phone, 12, clef='deux', etendue={'sol': [-6, 14], 'fa': [-6, 14]})
        print('G. étendue la plus large, deux clés (voir large_encours.png) : portées', st['lignes'], '| erreurs :', errs)

        if os.path.exists(BRUIT):
            st, res, errs, stored, diag, accueil, log, heard = await run(base, 'bruit', SEQ, phone, 26, shots=False, wav=BRUIT)
            v = st['v'] if st else []
            print('H. 30 s de frappe au clavier, sans un mot : %d notes validées, %d fausses, %d syllabes entendues (%d par le modèle seul) | erreurs : %s' % (
                sum(x == 'ok' for x in v), sum(bool(x) and x.startswith('faux') for x in v), st['heard'], st['raw'], errs))
        st, res, errs, stored, diag, accueil, log, heard = await run(base, 'secours', SEQ, phone, 24, shots=False, extra='&tau=1.1')
        v = st['v'] if st else []
        print('I. filtre qui écarterait toute la voix (seuil forcé à 1,1) :', ok32(v), 'justes sur 32 | filtre coupé :', st['bypass'], '| mémorisé :', st['stored'], '| erreurs :', errs)

        pris, portee, titre, modele, msg, n, piano, errs = await service_worker(base, proc)
        print('E. service worker : page prise en charge', pris, '| serveur éteint → titre', repr(titre), '| modèle version', modele, '| piano en cache :', piano, 'octets | message', repr(msg), '| notes affichées au clavier :', n, '| erreurs :', errs)
asyncio.run(main())
