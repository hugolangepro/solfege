"""Mains libres : la voix de l'app coupe le son de la page (ce que fait l'iPhone) — le contexte audio s'arrête et la piste du
micro se termine pendant l'énoncé. L'app doit relancer le son, reprendre le micro, jouer la note de départ et entendre le chant.
Une voix de synthèse factice remplace celle du navigateur : chaque énoncé dure 1 s, et les premiers cassent le son."""
import asyncio, os
from playwright.async_api import async_playwright
from serveur import serveur
from e2e_chant import wav, ICI
from e2e_mains import ETAT

FAUSSE_VOIX = """(casse) => {
  window.__dits = []; window.__casse = casse; window.__notes = 0;
  const st = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...a) { window.__notes++; return st.apply(this, a); };
  const voix = { speaking: false, pending: false, paused: false, getVoices: () => [], cancel() {}, pause() {}, resume() {},
    speak(u) {
      window.__dits.push(u.text);
      const au = window.__solfege.son;
      if (window.__casse > 0 && au && au.micro) { window.__casse--; au.ctx.suspend(); const p = au.mic.piste; if (p) p.stop(); }
      this.speaking = true;
      setTimeout(() => { this.speaking = false; if (u.onend) u.onend(); }, 1000);
    } };
  Object.defineProperty(window, 'speechSynthesis', { value: voix, configurable: true });
}"""

async def ouvrir(p, base, extra, micro, casse):
    b = await p.chromium.launch(channel='chrome', args=['--no-sandbox', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
        f'--use-file-for-fake-audio-capture={micro}%noloop', '--autoplay-policy=no-user-gesture-required'])
    ctx = await b.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2, permissions=['microphone'])
    pg = await ctx.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    await pg.goto(base + '?' + extra); await pg.wait_for_timeout(700)
    await pg.evaluate(FAUSSE_VOIX, casse)
    return b, pg, errs

JOURNAL = "() => window.__solfege.journal.map(q => q[1]).filter(m => !m.startsWith('contexte audio'))"

async def main():
    with serveur() as (base, _):
        async with async_playwright() as p:
            # les notes chantées arrivent après les reprises du micro (le faux micro de Chrome rejoue son fichier depuis le début)
            w = wav('chant_remise.wav', [(2.4, 1.4, 48), (3.9, 1.4, 52), (5.4, 1.4, 55)], 12)
            b, pg, errs = await ouvrir(p, base, 'ac=maj@0', w, 2)
            await pg.click('#mainslibres'); await pg.wait_for_timeout(300)
            await pg.click('#systems [data-ml="accords"]'); await pg.wait_for_timeout(11000)
            c = await pg.evaluate(ETAT)
            r = await pg.evaluate("() => ({ dits: window.__dits, notes: window.__notes, etat: window.__solfege.son.ctx.state, piste: window.__solfege.son.mic.piste && window.__solfege.son.mic.piste.readyState, alerte: document.getElementById('result').textContent })")
            print('voix qui casse le son (2 énoncés) :', r['dits'], '| contexte', r['etat'], '| piste', r['piste'], '| notes de piano', r['notes'], '| accord trouvé', c['n'], '| alerte', repr(r['alerte']), '| erreurs', errs)
            print('   journal :', await pg.evaluate(JOURNAL))
            await b.close()

            # panne au milieu de l'exercice : la veille la voit et reprend le micro
            w = wav('chant_veille.wav', [(5.0, 1.4, 48), (6.5, 1.4, 52), (8.0, 1.4, 55)], 14)
            b, pg, errs = await ouvrir(p, base, 'ac=maj@0', w, 0)
            await pg.click('#mainslibres'); await pg.wait_for_timeout(300)
            await pg.click('#systems [data-ml="accords"]'); await pg.wait_for_timeout(3000)
            await pg.evaluate("() => { const au = window.__solfege.son; au.mic.piste.stop(); }")
            await pg.wait_for_timeout(4000)
            f = await pg.evaluate("() => { const au = window.__solfege.son, s = window.__solfege.session; return { piste: au.mic.piste && au.mic.piste.readyState, recu_ms: Math.round(performance.now() - au.recu), vu_ms: Math.round(performance.now() - au.vu), phase: s.phase }; }")
            print('piste du micro finie en plein exercice :', f, '| journal', await pg.evaluate(JOURNAL), '| erreurs', errs)
            await b.close()

            # reconnaissance mains libres : même panne pendant l'annonce, l'exercice doit être joué et le micro repris
            silence = os.path.join(ICI, 'silence.wav')
            if not os.path.exists(silence): wav('silence.wav', [], 30)
            b, pg, errs = await ouvrir(p, base, '', silence, 1)
            await pg.click('#mainslibres'); await pg.wait_for_timeout(300)
            await pg.click('#systems [data-ml="rIntervalles"]'); await pg.wait_for_timeout(4000)
            r = await pg.evaluate("() => ({ dits: window.__dits, notes: window.__notes, etat: window.__solfege.son.ctx.state, piste: window.__solfege.son.mic.piste && window.__solfege.son.mic.piste.readyState, s: window.__solfege.session.kind + ':' + window.__solfege.session.etat })")
            print('reconnaissance, voix qui casse le son :', r, '| journal', await pg.evaluate(JOURNAL), '| erreurs', errs)
            await b.close()
asyncio.run(main())
