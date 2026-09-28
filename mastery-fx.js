/* ===========================================================
   MASTERY · FX LAYER · v3
   ------------------------------------------------------------
   Due soli effetti, dichiarati sulla <section> (o sul <footer>):

     data-fx="tipografia"              parola fantasma in parallasse
     data-fx="lettere"                 le lettere di MASTERY CLC.
     data-fx="tipografia lettere"      entrambi
     data-fx-i="0.55"                  intensita' 0..1
     data-fx-words="MASTERY|SQUADRA"   parole (tipografia; se piu'
                                       d'una segue le slide)
     data-fx-floor  su un figlio       linea oltre la quale la
                                       tipografia non deve andare
                                       (default: .hero-foot / .foot)

   Le lettere fluttuano sparse per tutta la pagina e, sul finale
   di scroll, si ricompongono esattamente sul marchio del footer.
   =========================================================== */
(function () {
    'use strict';

    var KLEIN = '0,47,167';
    var WHITE = '255,255,255';

    var DEFAULT = { fx: 'off', i: 0.5 };
    var ORDER = ['tipografia', 'lettere', 'off'];
    var BASE_ALPHA = { tipografia: 0.26, lettere: 0.42 };

    var canvas, ctx, W = 0, H = 0, dpr = 1;
    var hosts = [], docH = 0, scrollY = 0, running = true, activeHost = null;
    var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function rnd(a, b) { return a + Math.random() * (b - a); }
    function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
    /* Curva del velluto: parte con slancio e frena a lungo, senza mai
       fermarsi di colpo. E' la stessa che usano le librerie buone. */
    /* Chi esce e chi entra non hanno la stessa curva: il vecchio si toglie
       di mezzo nella prima parte del passaggio, il nuovo sale piu' a lungo.
       Cosi' dopo un quarto di strada il nuovo testo e' sempre il piu'
       presente, come dev'essere. */
    function esce(o) { return clamp(1 - o / 0.45, 0, 1); }
    function entra(o) { return clamp(o / 0.65, 0, 1); }

    function velvet(t) {
        return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
    }

    function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
    function lerp(a, b, t) { return a + (b - a) * t; }

    /* Il canvas disegna i caratteri letterali: se il CSS li trasforma
       (text-transform), va applicato anche qui, altrimenti si disegna
       "C-One" dove la pagina mostra "C-ONE". */
    function applyCase(ch, tt) {
        if (tt === 'uppercase') return ch.toUpperCase();
        if (tt === 'lowercase') return ch.toLowerCase();
        return ch;
    }

    function luminance(rgb) {
        var m = rgb.match(/\d+/g);
        if (!m) return 1;
        return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    }

    /* ---------------- installazione ---------------- */

    function install() {
        canvas = document.createElement('canvas');
        canvas.id = 'fx-stage';
        ctx = canvas.getContext('2d');
        document.body.insertBefore(canvas, document.body.firstChild);

        var nodes = document.querySelectorAll('section, footer');
        for (var i = 0; i < nodes.length; i++) {
            var el = nodes[i];
            var bg = getComputedStyle(el).backgroundColor;
            var opaque = bg && !/rgba\(0, 0, 0, 0\)/.test(bg) && bg !== 'transparent';
            var words = (el.dataset.fxWords || '').split('|').filter(Boolean);

            var stage = el.querySelector('.hero-stage, .stage, .sticky');
            if (stage && !/sticky|fixed/.test(getComputedStyle(stage).position)) stage = null;

            hosts.push({
                el: el,
                key: el.id || el.tagName.toLowerCase() + (el.id ? '' : '-' + (i + 1)),
                label: (el.id || el.tagName).toUpperCase().replace(/-/g, ' '),
                bg: opaque ? bg : null,
                ink: (opaque && luminance(bg) < 0.5) ? WHITE : KLEIN,
                fx: (el.dataset.fx || DEFAULT.fx).trim().split(/\s+/),
                intensity: el.dataset.fxI ? parseFloat(el.dataset.fxI) : DEFAULT.i,
                words: words.length ? words : null,
                // le parole possono venire dal DOM: data-fx-words-from=".fig"
                wordSel: el.dataset.fxWordsFrom || null,
                wordList: null,
                floorSel: el.dataset.fxFloor || null,          // filetto da non superare
                yFactor: el.dataset.fxY ? parseFloat(el.dataset.fxY) : 0.58,
                mixMs: 99999,
                stage: stage,
                floor: el.querySelector('[data-fx-floor], .hero-foot, .foot'),
                wi: 0, wiPrev: 0, mix: 1
            });
        }

        document.body.classList.add('fx-on');
    }

    /* -------------------------------------------------------
       I claim della testata non devono uscire dal palco.

       Il corpo del titolo cresce con la LARGHEZZA della finestra
       (clamp su vw), l'altezza del palco dipende dall'ALTEZZA.
       Su una finestra larga e bassa - 1900x900, un portatile
       qualunque - le due misure divergono e il titolo viene
       tagliato sopra e sotto, perche' il palco ha overflow
       nascosto. Qui il titolo si misura e, se non ci sta, si
       rimpicciolisce quel tanto che basta.
       ------------------------------------------------------- */
    function adattaClaim() {
        var palchi = document.querySelectorAll('.hero .stage');

        for (var i = 0; i < palchi.length; i++) {
            var palco = palchi[i];
            var claims = palco.querySelectorAll('.claim');

            // prima si torna alla misura naturale, altrimenti a ogni
            // ridimensionamento si rimpicciolirebbe sul gia' rimpicciolito
            for (var j = 0; j < claims.length; j++) claims[j].style.fontSize = '';

            var spazio = palco.clientHeight;
            if (!spazio) continue;

            for (var k = 0; k < claims.length; k++) {
                var c = claims[k];
                var alto = c.scrollHeight;
                if (alto <= spazio) continue;
                var corpo = parseFloat(getComputedStyle(c).fontSize);
                // 6px di respiro: senza, le lettere rasentano il bordo
                c.style.fontSize = (corpo * (spazio - 6) / alto).toFixed(1) + 'px';
            }
        }
    }

    /* =======================================================
       RIVELA · quando un titolo entra in scena
       ------------------------------------------------------
       Il sito rivela sezione per sezione con un osservatore a
       -12% dal bordo basso: la comparsa parte mentre il titolo
       sta ancora salendo da sotto. Con lo scroll di velluto,
       che continua per quasi due secondi dopo il gesto, quando
       ci si ferma a guardare e' finita da un pezzo: il titolo
       sembra sempre gia' li', fermo.

       Qui la rivelazione passa sotto il nostro comando, con un
       margine che aspetta che il titolo sia entrato per davvero.
       Le sezioni gia' rivelate dal sito restano tali: niente
       salti all'avvio.
       ======================================================= */
    var rivela = {
        MARGINE: '0px 0px -38% 0px',
        io: null,

        /* Rete di sicurezza: una sezione che sta tutta nell'ultimo 38%
           della pagina non arriverebbe mai alla soglia, perche' lo scroll
           finisce prima. Arrivati in fondo, si rivela quel che resta. */
        infondo: function () {
            if (!this.io) return;
            if (window.pageYOffset + H < docH - 4) return;
            var resto = document.querySelectorAll('.anim:not(.fx-in)');
            for (var i = 0; i < resto.length; i++) {
                resto[i].classList.add('fx-in');
                this.io.unobserve(resto[i]);
            }
        },

        build: function () {
            if (!('IntersectionObserver' in window)) return;
            if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

            // quello che il sito ha gia' mostrato resta mostrato
            var fatte = document.querySelectorAll('.anim.in');
            for (var i = 0; i < fatte.length; i++) fatte[i].classList.add('fx-in');
            document.body.classList.add('fx-rivela');

            if (this.io) this.io.disconnect();
            var self = this;
            this.io = new IntersectionObserver(function (voci) {
                for (var k = 0; k < voci.length; k++) {
                    if (!voci[k].isIntersecting) continue;
                    voci[k].target.classList.add('fx-in');
                    self.io.unobserve(voci[k].target);
                }
            }, { threshold: 0, rootMargin: this.MARGINE });

            var da = document.querySelectorAll('.anim:not(.fx-in)');
            for (var j = 0; j < da.length; j++) this.io.observe(da[j]);
        }
    };

    function measure() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        W = window.innerWidth;
        H = window.innerHeight;
        canvas.width = Math.floor(W * dpr);
        canvas.height = Math.floor(H * dpr);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        docH = Math.max(document.body.scrollHeight, H);
        rivela.build();
        marchio.build();
        lettere.build();
        scrub.build();
        scrub.pareggiaLeads();
        // dopo pareggiaLeads, non prima: e' quella a decidere quanta altezza
        // resta al palco, e il titolo va misurato sullo spazio definitivo
        adattaClaim();
        lenti.build();
        accordion.build();
    }

    /* =======================================================
       TIPOGRAFIA · parola fantasma
       Mai oltre il filetto che chiude il blocco di testo.
       ======================================================= */
    var tipografia = {
        slideIndex: function (host) {
            var on = host.el.querySelector('.slide.on, .slide[aria-hidden="false"]');
            if (!on) return 0;
            var i = parseInt(on.dataset.i, 10);
            return isNaN(i) ? 0 : i;
        },

        /* Elenco delle parole quando arrivano dal DOM (i numeri della
           databand): il testo non cambia, quindi si legge una volta sola. */
        list: function (host) {
            if (!host.wordList) {
                var els = host.el.querySelectorAll(host.wordSel);
                host.wordList = [];
                host.wordEls = [];
                for (var i = 0; i < els.length; i++) {
                    host.wordList.push(els[i].textContent.trim().toUpperCase());
                    host.wordEls.push(els[i]);
                }
            }
            return host.wordList;
        },

        /* Quale dei bersagli e' in scena adesso */
        activeIndex: function (host) {
            this.list(host);
            for (var i = 0; i < host.wordEls.length; i++) {
                var el = host.wordEls[i];
                var r = el.getBoundingClientRect();
                if (r.width > 0 && r.bottom > 0 && r.top < H &&
                    getComputedStyle(el).visibility !== 'hidden') return i;
            }
            return -1;
        },

        word: function (host, idx) {
            if (host.wordSel) return this.list(host)[idx] || '';
            if (!host.words) return host.label;
            return host.words[idx % host.words.length];
        },

        paint: function (word, size, alpha, x, y, ink) {
            if (alpha <= 0.002) return;
            ctx.font = '400 ' + size + 'px Anton, "Arial Narrow", sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.lineWidth = 1.25;
            ctx.strokeStyle = 'rgba(' + ink + ',' + alpha.toFixed(3) + ')';
            ctx.strokeText(word, x, y);
        },

        draw: function (host, alpha, t, rect, dt) {
            var idx, box, wAlpha = 1;
            var unit = scrub.unitFor(host);

            if (unit) {
                // La parola vive nelle battute pari: entra da destra quando il
                // claim precedente esce, sta ferma da sola, e se ne va a
                // sinistra proprio mentre il claim nuovo arriva.
                if (unit.ga <= 0.004) return;

                var slide = unit.slides[unit.gw];
                wAlpha = unit.ga;

                if (host.wordSel) {
                    var fig = slide.querySelector(host.wordSel);
                    this.list(host);
                    idx = host.wordEls.indexOf(fig);
                    if (idx < 0) return;
                    // la scena della fascia sta ferma: il quadro trasla, lei no
                    box = (unit.box.querySelector('.dstage') || unit.box).getBoundingClientRect();
                } else {
                    idx = unit.gw;
                    box = host.stage ? host.stage.getBoundingClientRect() : rect;
                }
                host.anchorEl = slide;

            } else if (host.wordSel) {
                idx = this.activeIndex(host);
                if (idx < 0) return;
                host.anchorEl = host.wordEls[idx].closest('.datum, .dstage, .databand') || host.el;
                box = host.anchorEl.getBoundingClientRect();
            } else {
                idx = host.words && host.words.length > 1 ? this.slideIndex(host) : 0;
                box = host.stage ? host.stage.getBoundingClientRect() : rect;
                host.anchorEl = host.el;
            }

            if (idx !== host.wi) { host.wiPrev = host.wi; host.wi = idx; host.mixMs = 0; }
            host.mixMs += dt;

            var OUT = 200, GAP = 140, IN = 420;
            var aOut = unit ? 0 : (1 - clamp(host.mixMs / OUT, 0, 1));
            var aIn = unit ? 1 : clamp((host.mixMs - OUT - GAP) / IN, 0, 1);

            var floorEl = host.floorSel
                ? (host.anchorEl.querySelector(host.floorSel) || host.el.querySelector(host.floorSel))
                : (host.wordSel ? host.anchorEl.querySelector('.under') : host.floor);

            var areaTop = box.top;
            var areaBottom = floorEl
                ? floorEl.getBoundingClientRect().top - 10
                : box.top + box.height;
            var areaH = areaBottom - areaTop;
            if (areaH < 60) return;

            var size = clamp(areaH * 0.62, 120, 330);

            // se la parola non ci sta in larghezza, si rimpicciolisce
            var probe = this.word(host, host.wi) || '';
            ctx.font = '400 100px Anton, "Arial Narrow", sans-serif';
            var w100 = ctx.measureText(probe).width || 100;
            size = Math.min(size, (W * 0.90) / (w100 / 100));
            ctx.font = '400 ' + size + 'px Anton, "Arial Narrow", sans-serif';

            var progress = clamp((H - box.top) / (H + box.height), 0, 1);
            var y = areaTop + areaH * host.yFactor;

            ctx.save();
            ctx.beginPath();
            ctx.rect(0, areaTop, W, areaH);
            ctx.clip();

            aOut *= wAlpha; aIn *= wAlpha;

            if (aOut > 0.002) {
                var prev = this.word(host, host.wiPrev);
                var wPrev = ctx.measureText(prev).width;
                var xPrev = W * 0.5 - wPrev / 2 + (unit ? unit.gdx : (0.5 - progress) * (W + wPrev) * 0.32);
                this.paint(prev, size, alpha * aOut, xPrev, y, host.ink);
            }

            if (aIn > 0.002) {
                var cur = this.word(host, host.wi);
                var wCur = ctx.measureText(cur).width;
                var xCur = W * 0.5 - wCur / 2 + (unit ? unit.gdx : (0.5 - progress) * (W + wCur) * 0.32);
                this.paint(cur, size, alpha * aIn, xCur + (unit ? 0 : (1 - aIn) * 22), y, host.ink);
            }

            ctx.restore();
        }
    };

    /* =======================================================
       MARCHIO · il logotipo della barra si compone
       ------------------------------------------------------
       Stesso gesto delle lettere sulla tela - i caratteri
       nascono sparsi e si posano al loro posto - ma qui
       disegnato nel documento, non sul canvas: la barra sta a
       z-index 100, sopra la tela, quindi lettere dipinte
       finirebbero dietro al suo fondo. In piu' cosi' i
       caratteri ereditano il colore della barra e seguono da
       soli il cambio di tema fra una sezione e l'altra.

       Si compone una volta per caricamento. Senza motore, o
       con "riduci movimento", il marchio resta quello che e'.
       ======================================================= */
    var marchio = {
        fatto: false,
        SCARTO_X: 46,        // px di dispersione orizzontale
        SCARTO_Y: 22,

        build: function () {
            if (this.fatto) return;
            if (reduceMotion) return;

            var el = document.querySelector('.nav .brand');
            if (!el || !el.firstChild || el.firstChild.nodeType !== 3) return;

            var testo = el.firstChild.nodeValue;
            this.fatto = true;

            // il nome resta leggibile per chi non vede lo schermo: i pezzi
            // sono decorazione, il nome intero sta sull'etichetta
            if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', testo.trim());

            var pezzi = document.createElement('span');
            pezzi.className = 'fx-marchio';
            pezzi.setAttribute('aria-hidden', 'true');

            var indici = [], n = 0;
            for (var i = 0; i < testo.length; i++) {
                var c = testo[i];
                if (!c.trim()) { pezzi.appendChild(document.createTextNode('\u00a0')); continue; }
                var q = document.createElement('i');
                q.textContent = c;
                pezzi.appendChild(q);
                indici.push(n++);
            }
            if (!n) return;

            // ordine d'arrivo casuale: non si scrive da sinistra a destra
            for (var q2 = indici.length - 1; q2 > 0; q2--) {
                var m = Math.floor(Math.random() * (q2 + 1));
                var t = indici[q2]; indici[q2] = indici[m]; indici[m] = t;
            }

            // i pezzi entrano nel documento PRIMA di essere misurati:
            // staccati dalla pagina hanno tutti riquadro zero, e la
            // dispersione finirebbe calcolata sul nulla
            el.textContent = '';
            el.appendChild(pezzi);

            var lettereEl = pezzi.querySelectorAll('i');
            // i caratteri nascono sparsi, ma dentro alla barra: fuori a
            // sinistra uscirebbero dallo schermo, a destra finirebbero sopra
            // alle voci del menu
            var barra = (el.closest('.wrap') || el).getBoundingClientRect();
            var casa = el.getBoundingClientRect();
            for (var k = 0; k < lettereEl.length; k++) {
                var st = lettereEl[k].style;
                var r = lettereEl[k].getBoundingClientRect();
                var dx = clamp(rnd(-this.SCARTO_X, this.SCARTO_X),
                               barra.left - r.left, casa.right + 60 - r.right);
                st.setProperty('--dx', dx.toFixed(1) + 'px');
                st.setProperty('--dy', rnd(-this.SCARTO_Y, this.SCARTO_Y).toFixed(1) + 'px');
                st.setProperty('--s', rnd(0.55, 1.75).toFixed(2));
                st.setProperty('--d', (indici.indexOf(k) * 70 + 120) + 'ms');
            }

            requestAnimationFrame(function () {
                requestAnimationFrame(function () { pezzi.classList.add('posa'); });
            });
        }
    };

    /* =======================================================
       LETTERE · ricomposizione tipografica
       ------------------------------------------------------
       Funziona su QUALUNQUE bersaglio, non solo sul marchio:
         data-fx-target=".fig"   sceglie cosa ricomporre
       (default: .mark nel footer, .fig altrove)

       Il bersaglio non esiste finche' l'effetto non lo scrive:
       viene nascosto, i suoi caratteri nascono sparsi nell'area
       che lo contiene e si ricompongono sulla sua posizione
       reale, calcolata dalle metriche del font.
       ======================================================= */
    var lettere = {
        units: [],
        DUR: 1300,       // viaggio di un carattere
        STAGGER: 110,    // ritardo tra un carattere e il successivo
        HOLD: 320,       // consegna al testo vero

        build: function () {
            this.release();
            this.units = [];

            for (var i = 0; i < hosts.length; i++) {
                var host = hosts[i];
                if (host.fx.indexOf('lettere') < 0) continue;

                var sel = host.el.dataset.fxTarget ||
                          (host.el.tagName === 'FOOTER' ? '.mark' : '.fig');
                var targets = host.el.querySelectorAll(sel);

                for (var j = 0; j < targets.length; j++) {
                    this.units.push({
                        el: targets[j],
                        host: host,
                        chars: null,
                        t: 0,
                        playing: false,
                        shown: null
                    });
                }
            }
        },

        total: function (u) {
            var n = u.chars ? u.chars.length : 1;
            return this.STAGGER * Math.max(n - 1, 0) + this.DUR + this.HOLD;
        },

        /* Legge posizione d'arrivo, colore e metriche nel momento in cui
           l'effetto parte: cosi' vale anche per i blocchi che entrano in
           scena traslati, come le slide dei dati. */
        prepare: function (u) {
            var el = u.el;
            if (!el.firstChild || el.firstChild.nodeType !== 3) return false;

            var cs = getComputedStyle(el);
            var size = parseFloat(cs.fontSize);
            var ls = parseFloat(cs.letterSpacing);
            if (isNaN(ls)) ls = 0;

            var rgb = (cs.color.match(/\d+/g) || [0, 47, 167]).slice(0, 3).join(',');
            var tt = cs.textTransform;

            ctx.font = (cs.fontWeight || '400') + ' ' + size + 'px ' + cs.fontFamily;
            var fm = ctx.measureText('MH');
            var asc = fm.fontBoundingBoxAscent || size * 0.8;
            var desc = fm.fontBoundingBoxDescent || size * 0.2;

            // area in cui i caratteri nascono e galleggiano
            var boxEl = el.closest('.datum, .dstage, .databand') || u.host.el;
            var box = boxEl.getBoundingClientRect();

            var node = el.firstChild, text = node.nodeValue, chars = [];
            for (var i = 0; i < text.length; i++) {
                if (!text[i].trim()) continue;
                var range = document.createRange();
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                var r = range.getBoundingClientRect();
                if (!r.width) continue;

                var baseDoc = r.top + window.pageYOffset
                            + (r.height - (asc + desc)) / 2 + asc;

                // nasce sparso attorno al bersaglio, mai oltre la sua area
                var spreadY = box.height * 0.35;
                chars.push({
                    ch: applyCase(text[i], tt),
                    tx: r.left + (r.width - ls) / 2,
                    tyDoc: baseDoc,
                    tsize: size,
                    // scarto di partenza RELATIVO all'arrivo: se il blocco si
                    // sposta (slide che traslano, sezioni che entrano animate)
                    // tutta la traiettoria lo segue invece di restare indietro
                    sdx: box.left + rnd(0.04, 0.96) * box.width - (r.left + (r.width - ls) / 2),
                    sdy: clamp(baseDoc + rnd(-spreadY, spreadY * 0.55),
                               box.top + window.pageYOffset + size * 0.4,
                               box.top + window.pageYOffset + box.height - size * 0.2) - baseDoc,
                    ssize: clamp(rnd(size * 0.6, size * 2.0), 10,
                                 Math.min(box.height * 0.5, box.width * 0.25)),
                    salpha: rnd(0.12, 0.42),
                    ampX: rnd(3, 11),
                    ampY: rnd(2, 8),
                    spX: rnd(0.0004, 0.0011),
                    spY: rnd(0.0005, 0.0013),
                    phase: Math.random() * Math.PI * 2,
                    delay: 0
                });
            }
            if (!chars.length) return false;

            // ordine di arrivo casuale: non si scrive da sinistra a destra
            var order = [];
            for (var k = 0; k < chars.length; k++) order.push(k);
            for (var q = order.length - 1; q > 0; q--) {
                var m = Math.floor(Math.random() * (q + 1));
                var tmp = order[q]; order[q] = order[m]; order[m] = tmp;
            }
            for (var d = 0; d < order.length; d++) chars[order[d]].delay = d * this.STAGGER;

            u.chars = chars;
            u.metrics = { asc: asc, desc: desc, ls: ls, size: size };
            u.font = (cs.fontWeight || '400') + ' ';
            u.family = cs.fontFamily;
            u.rgb = rgb;
            return true;
        },

        /* L'arrivo e' ricalcolato a ogni frame sulla posizione VERA
           dell'elemento: cosi' l'atterraggio resta esatto anche se il
           blocco si muove mentre le lettere sono in volo. */
        refresh: function (u) {
            var node = u.el.firstChild;
            if (!node || node.nodeType !== 3 || !u.metrics) return false;

            /* Il colore si rilegge a ogni fotogramma, non solo alla partenza.
               Dentro all'accordion l'effetto parte mentre il pannello sta
               ancora passando da testo blu a testo carta: leggendolo una
               volta sola, le lettere nascevano scure e restavano scure fino
               alla consegna. */
            var ora = getComputedStyle(u.el).color.match(/\d+/g);
            if (ora) u.rgb = ora.slice(0, 3).join(',');
            var m = u.metrics, text = node.nodeValue, i, k = 0;

            for (i = 0; i < text.length; i++) {
                if (!text[i].trim()) continue;
                var g = u.chars[k++];
                if (!g) break;
                var range = document.createRange();
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                var r = range.getBoundingClientRect();
                if (!r.width) return false;
                g.tx = r.left + (r.width - m.ls) / 2;
                g.tyDoc = r.top + window.pageYOffset + (r.height - (m.asc + m.desc)) / 2 + m.asc;
            }
            return true;
        },

        setShown: function (u, v) {
            if (u.shown === v) return;
            u.shown = v;
            u.el.style.opacity = v;
        },

        /* Parte quando il bersaglio e' a schermo ED e' davvero visibile
           (le slide dei dati non attive sono in visibility:hidden).
           Se esce di scena si riavvolge: rientrando, si riscrive. */
        update: function (dt) {
            for (var i = 0; i < this.units.length; i++) {
                var u = this.units[i];
                var r = u.el.getBoundingClientRect();

                var onStage = r.width > 0 && r.bottom > 0 && r.top < H &&
                              getComputedStyle(u.el).visibility !== 'hidden';

                if (!onStage) {
                    if (u.playing || u.t) { u.playing = false; u.t = 0; u.chars = null; }
                    this.setShown(u, '0');
                    continue;
                }

                if (!u.playing) {
                    if (!this.prepare(u)) { this.setShown(u, ''); continue; }
                    u.playing = true;
                    u.t = 0;
                }
                u.t += dt;

                var done = u.t >= this.total(u);
                if (!done) this.refresh(u);
                this.setShown(u, done ? '1' : '0');
            }
        },

        draw: function (host, alpha, t) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'alphabetic';

            for (var i = 0; i < this.units.length; i++) {
                var u = this.units[i];
                if (u.host !== host || !u.chars || !u.playing) continue;
                if (u.t >= this.total(u)) continue;      // ora c'e' il testo vero

                /* Le lettere nascono sparse intorno al punto d'arrivo. Dentro
                   a un pannello colorato le piu' esterne finirebbero fuori,
                   sulla carta, dove sono bianche su bianco: qui si ritagliano
                   dentro al riquadro che fa loro da fondo. */
                var riquadro = u.el.closest('[data-fx-fondo]');
                if (riquadro) {
                    var rq = riquadro.getBoundingClientRect();
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(rq.left, rq.top, rq.width, rq.height);
                    ctx.clip();
                }

                for (var c = 0; c < u.chars.length; c++) {
                    var g = u.chars[c];
                    var local = clamp((u.t - g.delay) / this.DUR, 0, 1);
                    var e = velvet(local);

                    var driftX = Math.sin(t * g.spX + g.phase) * g.ampX * (1 - e);
                    var driftY = Math.cos(t * g.spY + g.phase * 1.4) * g.ampY * (1 - e);

                    var x = lerp(g.tx + g.sdx + driftX, g.tx, e);
                    var y = lerp(g.tyDoc + g.sdy + driftY, g.tyDoc, e) - scrollY;
                    var size = lerp(g.ssize, g.tsize, e);

                    var appear = clamp((u.t - g.delay + 260) / 320, 0, 1);
                    var a = lerp(alpha * g.salpha, 1, Math.pow(e, 1.8)) * appear;

                    if (local === 1) {
                        var over = u.t - (g.delay + this.DUR);
                        if (over > 0) a *= clamp(1 - over / this.HOLD, 0, 1);
                    }
                    if (a <= 0.004) continue;

                    ctx.font = u.font + size.toFixed(1) + 'px ' + u.family;
                    ctx.fillStyle = 'rgba(' + u.rgb + ',' + a.toFixed(3) + ')';
                    ctx.fillText(g.ch, x, y);
                }

                if (riquadro) ctx.restore();
            }
        },

        release: function () {
            for (var i = 0; i < this.units.length; i++) {
                this.units[i].el.style.opacity = '';
                this.units[i].shown = null;
            }
        }
    };





    /* =======================================================
       ACCORDION ORIZZONTALE
       Un pannello alla volta. Il pannello chiuso non deve
       essere raggiungibile da tastiera: il contenuto c'e'
       ancora ma e' inerte, altrimenti si tabularebbe dentro
       a qualcosa che non si vede.
       ======================================================= */
    var accordion = {
        gruppi: [],

        build: function () {
            this.gruppi = [];
            var box = document.querySelectorAll('.ha');

            for (var g = 0; g < box.length; g++) {
                var pannelli = box[g].querySelectorAll('.ha-p');
                if (pannelli.length < 2) continue;

                for (var i = 0; i < pannelli.length; i++) {
                    this.collega(pannelli[i], pannelli);
                }
                this.sincronizza(pannelli);
                this.gruppi.push(pannelli);
            }
        },

        collega: function (pannello, pannelli) {
            var self = this;
            var tab = pannello.querySelector('.ha-tab');
            if (!tab) return;

            tab.addEventListener('click', function () {
                if (pannello.classList.contains('aperto')) return;   // gia' aperto: non si richiude
                for (var k = 0; k < pannelli.length; k++) {
                    pannelli[k].classList.toggle('aperto', pannelli[k] === pannello);
                }
                self.sincronizza(pannelli);
            });
        },

        sincronizza: function (pannelli) {
            for (var i = 0; i < pannelli.length; i++) {
                var aperto = pannelli[i].classList.contains('aperto');
                var tab = pannelli[i].querySelector('.ha-tab');
                var cont = pannelli[i].querySelector('.ha-c');

                if (tab) tab.setAttribute('aria-expanded', aperto ? 'true' : 'false');
                if (cont) {
                    cont.setAttribute('aria-hidden', aperto ? 'false' : 'true');
                    if (aperto) cont.removeAttribute('inert');
                    else cont.setAttribute('inert', '');
                }
            }
        }
    };

    /* =======================================================
       LENTI · il selettore che non scompare
       ------------------------------------------------------
       I due tab governano circa 6.000 px di contenuto ma
       restano a schermo per 800: appena scorrono via, chi
       legge non sa piu' di essere dentro una delle due
       versioni, ne' che ne esista un'altra.

       Quando i tab grandi escono dal campo, una barra
       compatta prende il loro posto e resta. Mostra sempre
       quale lente e' attiva, e cambiarla riporta all'inizio
       della fascia: altrimenti si finirebbe a meta' di un
       racconto che non si e' cominciato.
       ======================================================= */
    var lenti = {
        barre: [],
        navH: 80,

        build: function () {
            for (var i = 0; i < this.barre.length; i++) this.barre[i].barra.remove();
            this.barre = [];

            var nav = document.querySelector('.nav');
            if (nav) this.navH = Math.round(nav.getBoundingClientRect().height);

            var gruppi = document.querySelectorAll('.lenses');
            for (var g = 0; g < gruppi.length; g++) {
                var lenses = gruppi[g];
                var sezione = lenses.closest('section');
                var tabs = lenses.querySelectorAll('.lens-tab');
                if (tabs.length < 2 || !sezione) continue;

                var barra = document.createElement('div');
                barra.className = 'fx-lenti';
                barra.style.top = this.navH + 'px';
                barra.style.gridTemplateColumns = 'repeat(' + tabs.length + ', 1fr)';

                var bottoni = [];
                for (var k = 0; k < tabs.length; k++) {
                    bottoni.push(this.creaBottone(tabs[k], sezione, barra));
                }

                document.body.appendChild(barra);
                this.barre.push({ barra: barra, bottoni: bottoni, tabs: tabs,
                                  lenses: lenses, sezione: sezione });
            }
        },

        creaBottone: function (tab, sezione, barra) {
            var self = this;
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = tab.textContent;
            b.setAttribute('aria-label', 'Passa alla lente: ' + tab.textContent);
            b.addEventListener('click', function () {
                tab.click();                       // il comando vero resta l'originale

                // La lente che si nasconde accorcia la pagina: la posizione
                // d'arrivo va letta a impaginazione rifatta, non prima.
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        self.vaiAllInizio(tab, sezione);
                    });
                });
            });
            barra.appendChild(b);
            return b;
        },

        /* Cambiare lente a meta' sezione lascerebbe lo sguardo a meta' di un
           racconto mai cominciato: si torna all'inizio della fascia. */
        vaiAllInizio: function (tab, sezione) {
            var id = tab.getAttribute('aria-controls');
            var lente = id ? document.getElementById(id) : null;
            var meta = (lente && lente.querySelector('.databand')) || lente || sezione;
            var y = meta.getBoundingClientRect().top + window.pageYOffset - this.navH - 8;
            y = clamp(y, 0, velluto.attivo ? velluto.max()
                                           : document.documentElement.scrollHeight - H);
            if (velluto.attivo) velluto.target = y;
            else window.scrollTo(0, y);
        },

        update: function () {
            for (var i = 0; i < this.barre.length; i++) {
                var b = this.barre[i];
                var rs = b.sezione.getBoundingClientRect();
                var rl = b.lenses.getBoundingClientRect();

                // compare quando i tab grandi sono usciti di sopra e la
                // sezione e' ancora in scena
                // soglia larga: atterrando al confine dopo un cambio lente, la
                // barra non deve sparire proprio nell'istante in cui l'hai usata
                var mostra = rl.bottom <= this.navH + 60 && rs.bottom > H * 0.2;
                b.barra.classList.toggle('on', mostra);

                for (var k = 0; k < b.tabs.length; k++) {
                    var attiva = b.tabs[k].getAttribute('aria-selected') === 'true';
                    b.bottoni[k].setAttribute('aria-pressed', attiva ? 'true' : 'false');
                }
            }
        }
    };

    /* =======================================================
       VELLUTO · lo scroll stesso
       ------------------------------------------------------
       La rotella manda salti. Qui la pagina non ci va mai
       direttamente: teniamo una posizione che insegue quella
       richiesta, fotogramma per fotogramma. Il risultato e' che
       la pagina continua a scorrere per un attimo dopo che hai
       smesso, come se avesse peso. E' lo stesso principio di
       Lenis / ScrollSmoother.
       Su schermi tattili resta lo scroll nativo: il dito ha gia'
       la sua inerzia, sovrapporne un'altra fa solo danni.
       ======================================================= */
    var velluto = {
        attivo: false,
        target: 0,
        corrente: 0,
        TAU: 0.34,           // secondi di trascinamento

        init: function () {
            if (reduceMotion) return;
            if (window.matchMedia('(pointer: coarse)').matches) return;

            this.target = this.corrente = window.pageYOffset;
            this.ultimoScritto = null;
            this.attivo = true;

            var self = this;
            // Il colpo d'ancora del browser (arrivo con #sezione, cambio di
            // hash) e la rifinitura del velluto corrono nello stesso giro:
            // senza tregua, l'ultimo scrollTo nostro sovrascrive il salto.
            // Al cambio d'ancora il velluto tace due fotogrammi e poi adotta.
            window.addEventListener('hashchange', function () {
                self.sospeso = true;
                requestAnimationFrame(function () { requestAnimationFrame(function () {
                    self.corrente = self.target = window.pageYOffset;
                    self.ultimoScritto = null;
                    self.sospeso = false;
                }); });
            });

            // Il sito ha scroll-behavior:smooth, quindi il browser animerebbe
            // a sua volta ogni nostro spostamento: due animazioni sovrapposte
            // che si annullano. Qui comandiamo noi.
            document.documentElement.style.scrollBehavior = 'auto';

            var self = this;

            window.addEventListener('wheel', function (e) {
                if (e.ctrlKey) return;                    // zoom del browser
                e.preventDefault();
                var d = e.deltaY * (e.deltaMode === 1 ? 16 : (e.deltaMode === 2 ? H : 1));
                self.mira(d);
            }, { passive: false });

            window.addEventListener('keydown', function (e) {
                if (e.metaKey || e.ctrlKey || e.altKey) return;
                var t = e.target, tag = t && t.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;

                var d = null;
                if (e.key === 'ArrowDown') d = 120;
                else if (e.key === 'ArrowUp') d = -120;
                else if (e.key === 'PageDown' || e.key === ' ') d = H * 0.85;
                else if (e.key === 'PageUp') d = -H * 0.85;
                else if (e.key === 'Home') { e.preventDefault(); self.target = 0; return; }
                else if (e.key === 'End') { e.preventDefault(); self.target = self.max(); return; }
                if (d === null) return;
                e.preventDefault();
                self.mira(d);
            });

            // i link interni non devono saltare: arrivano scivolando
            document.addEventListener('click', function (e) {
                var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
                if (!a) return;
                var id = a.getAttribute('href').slice(1);
                if (!id) return;
                var dest = document.getElementById(id);
                if (!dest) return;
                e.preventDefault();
                self.gestoT = 0;      // salto voluto: niente tetto ne' assestamento
                self.target = clamp(dest.getBoundingClientRect().top + window.pageYOffset, 0, self.max());
            });
        },

        max: function () {
            return Math.max(document.documentElement.scrollHeight - H, 0);
        },

        /* Un gesto di scroll - la raffica di eventi senza pause - dentro
           una testata a battute avanza al massimo fino alla PROSSIMA SOSTA:
           la rivelazione e il cambio non possono accadere nello stesso
           gesto, per quanto ampio. E' il comportamento degli slider di
           mestiere: il primo scroll rivela, il secondo cambia. */
        gestoBase: 0,
        gestoT: 0,

        mira: function (d) {
            var ora = performance.now();
            if (ora - this.gestoT > 280) this.gestoBase = this.target;
            this.gestoT = ora;
            var proposto = clamp(this.target + d, 0, this.max());
            this.target = scrub.tettoGesto(this.gestoBase, proposto);
        },

        tick: function (dt) {
            if (!this.attivo || this.sospeso) return;

            // Riallineamento solo se la pagina si e' mossa per mano d'altri
            // (barra laterale, ancora del browser). Il confronto e' con
            // l'ultimo valore che abbiamo scritto noi, non con quello che
            // stiamo inseguendo: altrimenti il nostro stesso movimento
            // sembrerebbe un intervento esterno.
            var vero = window.pageYOffset;
            // Con il registro ancora vergine (nessuna scrittura nostra) il
            // confronto si fa con la posizione interna: altrimenti il primo
            // gesto esterno - barra laterale, colpo d'ancora del browser -
            // verrebbe combattuto e la pagina riavvolta.
            var riferimento = this.ultimoScritto !== null ? this.ultimoScritto : this.corrente;
            if (Math.abs(vero - riferimento) > 3) {
                this.corrente = this.target = vero;
                this.ultimoScritto = null;
                return;
            }

            // A gesto finito, se si e' rimasti a meta' di un passaggio, il
            // bersaglio si assesta alla sosta piu' vicina: mai titoli appesi.
            if (this.gestoT && performance.now() - this.gestoT > 300) {
                var sosta = scrub.sostaVicina(this.target, this.target < this.gestoBase);
                if (sosta !== null) this.target = sosta;
                this.gestoT = 0;
            }

            var k = 1 - Math.exp(-dt / (this.TAU * 1000));
            this.corrente += (this.target - this.corrente) * k;
            if (Math.abs(this.target - this.corrente) < 0.4) this.corrente = this.target;
            if (Math.abs(this.corrente - vero) >= 0.5) {
                window.scrollTo(0, this.corrente);
                this.ultimoScritto = window.pageYOffset;
            }
        }
    };

    /* =======================================================
       QUADRI · la testata a fotografie
       ------------------------------------------------------
       Un gesto porta un quadro intero. Dentro al gesto, tre
       momenti in fila:

         1. la fotografia nuova entra in dissolvenza
         2. il titolo sale, una parola per volta
         3. il testo arriva, e il pennarello bianco gli passa
            sopra quando l'ultima parola del titolo e' a posto

       Quello che si e' imparato sbagliando, e che sta qui
       dentro perche' non si ripeta:

       - LA CURVA. La curva del velluto fa il 49% del lavoro
         nel primo 10% del tempo: giusta per un movimento che
         deve arrivare svelto e posarsi piano, un disastro per
         una dissolvenza - meta' opacita' in novanta millesimi
         si legge come un lampo. Qui la trasparenza va quasi
         lineare.
       - UNO SOLO SI MUOVE. Se la vecchia sfuma mentre la nuova
         si accende, a meta' strada sono tutte e due trasparenti
         e si vede il fondo attraverso. La vecchia resta piena
         SOTTO finche' la nuova non e' arrivata.
       - SI ASPETTA LA DECODIFICA. Cambiare la sorgente e basta
         lascia un fotogramma vuoto mentre il browser decodifica.
         La fotografia si fa vedere solo dopo decode().
       - IL TESTO SE NE VA, non sparisce. Azzerarlo nell'istante
         del gesto lo faceva sparire in un fotogramma solo, nella
         stessa zona dove poi entra la fotografia: sembrava uno
         scatto dell'immagine.
       ======================================================= */
    var quadri = {
        ATTESA: 120,        // quanto il quadro deve stare fermo prima di entrare
        USCITA: 280,        // quanto ci mette il testo vecchio ad andarsene
        FOTO: 1000,         // la dissolvenza fra le due fotografie
        PASSO: 46,          // ritardo fra una parola e l'altra del titolo
        SALITA: 950,        // quanto ci mette una parola a salire

        vai: function (u, quadro) {
            var fascia = u.box.querySelector('.fx-fascia');
            if (!fascia) return;
            // le classi di scena stanno sulla SEZIONE, non sulla fascia: il
            // testo e il suo pennarello vivono nel piede, fuori dalla fascia
            var scena = u.host.el;
            var strati = fascia.querySelectorAll('.fx-strato');
            var slide = u.slides[quadro];
            if (!slide || strati.length < 2) return;

            var giro = (u.giro || 0) + 1;
            u.giro = giro;

            /* UNA SOLA MOSSA PER PASSAGGIO. I due piani sono fissi: sotto
               (primo) e sopra (secondo, z piu' alto). Il sotto, dal primo
               quadro in poi, resta SEMPRE acceso: sotto una dissolvenza c'e'
               sempre una fotografia piena. L'unica cosa che si muove e' la
               trasparenza del piano superiore: sfuma DENTRO quando la nuova
               fotografia sta sopra, sfuma VIA quando la nuova sta sotto.
               Niente cambi di livello, niente pulizie a tempo, niente stati
               intermedi: per costruzione non possono esserci salti. */
            var sotto = strati[0], sopra = strati[1];
            var sale = !sopra.classList.contains('su');
            var dest = sale ? sopra : sotto;   // sempre un piano INVISIBILE o COPERTO
            var img = dest.querySelector('img');
            var fonte = dest.querySelector('source');
            if (fonte) fonte.srcset = slide.dataset.fotoTel || '';
            img.src = slide.dataset.foto || '';

            var self = this;
            var parti = function () {
                if (u.giro !== giro) return;      // un gesto piu' nuovo ha gia' comandato

                sotto.classList.add('su');        // l'invariante: il fondo e' pieno
                if (sale) sopra.classList.add('su');
                else sopra.classList.remove('su');

                setTimeout(function () {
                    if (u.giro !== giro) return;
                    // il primo passaggio e' compiuto: la riserva del foglio
                    // critico puo' spegnersi (vedi body:not(.fx-foto-viva))
                    document.body.classList.add('fx-foto-viva');
                }, self.FOTO + 100);

                if (u.mostrato !== -1) scena.classList.add('esce');

                setTimeout(function () {
                    if (u.giro !== giro) return;
                    self.scrivi(u, scena, quadro, giro);
                }, u.primo ? 0 : self.USCITA + 20);
                u.primo = false;
            };

            if (u.primo === undefined) u.primo = true;
            if (img.decode) img.decode().then(parti, parti); else parti();
        },

        /* A testo sparito - e solo allora - si cambia quello che c'e' scritto,
           senza transizioni, cosi' nessuno vede il riavvolgimento. */
        scrivi: function (u, scena, quadro, giro) {
            var self = this;
            scena.classList.add('ferma');
            scena.classList.remove('scritto', 'segnato', 'esce');

            // Il quadro in scena si segna con una classe NOSTRA, non con
            // la ".on" del sito: lo script originale della testata continua a
            // girare e quella classe la scrive lui a ogni fotogramma. Due
            // padroni sulla stessa classe fanno lampeggiare i quadri.
            for (var i = 0; i < u.slides.length; i++) {
                var dentro = i === quadro;
                u.slides[i].classList.toggle('fx-ora', dentro);
                u.slides[i].setAttribute('aria-hidden', dentro ? 'false' : 'true');
            }
            for (var t = 0; t < u.testi.length; t++)
                u.testi[t].classList.toggle('fx-ora', t === quadro);

            var tacche = u.host.el.querySelectorAll('.ticks button');
            for (var k = 0; k < tacche.length; k++)
                tacche[k].setAttribute('aria-current', k === quadro ? 'true' : 'false');

            void scena.offsetWidth;
            scena.classList.remove('ferma');

            var parole = u.slides[quadro].querySelectorAll('.claim .w').length;
            var finito = Math.max(parole - 1, 0) * this.PASSO + this.SALITA;

            // il titolo sale quando la fotografia e' sostanzialmente
            // arrivata: una cosa alla volta, si legge il passaggio
            setTimeout(function () {
                if (u.giro !== giro) return;
                scena.classList.add('scritto');
                setTimeout(function () {
                    if (u.giro === giro) scena.classList.add('segnato');
                    // il pennarello parte mentre l'ultima parola sta
                    // finendo di posarsi: un filo d'anticipo, niente attesa
                }, Math.max(finito - 120, 250));
            }, 350);
        }
    };

    /* =======================================================
       SCRUB · lo slider agganciato allo scroll
       ------------------------------------------------------
       Il sito cambia quadro a soglia (floor(prog*n)) e lascia
       animare il CSS per .85s: l'animazione va per conto suo e
       si sente lo scatto. Qui la posizione del nastro diventa
       una FUNZIONE dello scroll: si muove con il dito, si ferma
       se ti fermi. In piu' ogni quadro ha una sosta prima di
       scorrere, cosi' si fa in tempo a leggerlo.

       Attivazione: data-fx-scrub sulla sezione.
       ======================================================= */
    var scrub = {
        units: [],
        HOLD: 0.22,          // quota della battuta in cui si sta fermi a leggere
        BATTUTA: 1.1,        // schermate di scroll per ogni battuta: a 0.8 una rotellata abituale girava due o tre quadri, a 1.4 il gesto era troppo lungo
        CORSA: 100,          // corsa piena: chi esce e chi entra non si
                             // sovrappongono mai nello stesso punto
        MORBIDEZZA: 0.32,    // secondi: rifinitura sopra il velluto dello scroll


        /* Due battute per quadro:
             battuta pari   -> in scena c'e' SOLO la parola in trasparenza
             battuta dispari-> entra il claim (e il suo testo), la parola esce
           Niente si muove se non scrolli. */

        build: function () {
            this.units = [];
            // Con "riduci movimento" lo slider a battute non si costruisce:
            // niente piste allungate, niente controllo inline dei quadri.
            // Restano al motore base del sito, che con questa preferenza
            // cambia scena all'istante: tutto il contenuto e' raggiungibile.
            if (reduceMotion) return;
            for (var i = 0; i < hosts.length; i++) {
                var host = hosts[i];
                if (host.el.dataset.fxScrub === undefined) continue;

                var sel = host.el.dataset.fxScrub;
                var boxes = sel ? host.el.querySelectorAll(sel) : [host.el];

                for (var b = 0; b < boxes.length; b++) {
                    var box = boxes[b];
                    var slides = box.querySelectorAll('.slide, .datum');
                    if (slides.length < 2) continue;

                    // Con le fotografie un quadro vale UNA battuta: la
                    // parola in trasparenza non c'e' piu', quindi la prima
                    // meta' della battuta - che serviva a lei - e' libera, e
                    // il claim ci sta dentro. La testata si accorcia di un
                    // terzo. Senza foto resta il ritmo di prima.
                    var aFoto = box.closest('[data-fx-foto]') !== null;
                    // il foglio nasconde i testi della testata a fotografie solo
                    // sotto questa classe: se lo scrub non si costruisce (riduci
                    // movimento, o niente motore) la classe non arriva e la
                    // testata resta quella del sito, tutta leggibile
                    if (aFoto) document.body.classList.add('fx-quadri');
                    var battute = slides.length * (aFoto ? 1 : 2);
                    box.style.height = Math.round((battute * this.BATTUTA + 1) * 100) + 'svh';
                    // Il motore di prima toglieva le transizioni ai quadri
                    // perche' li muoveva lui a ogni fotogramma. La testata a
                    // fotografie fa il contrario: le transizioni SERVONO, e
                    // uno stile scritto sull'elemento le spegne tutte. Senza
                    // questa guardia il testo non se ne va: sparisce di colpo.
                    if (!aFoto)
                        for (var k = 0; k < slides.length; k++) slides[k].style.transition = 'none';

                    // I testi lunghi li muove il sito con una traslazione di
                    // uno schermo intero, a tempo: sembrano sparati via. Li
                    // impiliamo e li guidiamo noi, come i quadri.
                    var testi = box.querySelectorAll('.leadtext');
                    for (var t = 0; t < testi.length; t++) {
                        if (!aFoto) testi[t].style.transition = 'none';
                        testi[t].style.animation = 'none';
                        testi[t].style.position = 'absolute';
                        testi[t].style.left = '0';
                        testi[t].style.right = '0';
                        testi[t].style.top = '0';
                    }

                    this.units.push({
                        host: host, box: box, slides: slides,
                        n: slides.length, S: battute, aFoto: aFoto, mostrato: -1,
                        s: 0, f: 0, g: 0, o: 0,
                        gw: 0, ga: 1, gdx: 0,        // parola: indice, opacita', scarto
                        leads: box.querySelectorAll('.leads'),
                        testi: box.querySelectorAll('.leadtext')
                    });
                }
            }
        },

        /* I tre testi hanno lunghezze diverse: il loro contenitore si
           alza e si abbassa a ogni cambio, e con lui il filetto che li
           separa dal claim. Lo fisso all'altezza del piu' lungo. */
        pareggiaLeads: function () {
            for (var i = 0; i < this.units.length; i++) {
                var leads = this.units[i].leads;
                for (var L = 0; L < leads.length; L++) {
                    var box = leads[L];
                    var figli = box.children, massima = 0;

                    box.style.minHeight = '0px';
                    for (var k = 0; k < figli.length; k++) {
                        var el = figli[k];
                        var pos = el.style.position, vis = el.style.visibility, tr = el.style.transform;
                        el.style.position = 'relative';
                        el.style.visibility = 'hidden';
                        el.style.transform = 'none';
                        massima = Math.max(massima, el.offsetHeight);
                        el.style.position = pos;
                        el.style.visibility = vis;
                        el.style.transform = tr;
                    }
                    if (massima) box.style.minHeight = Math.ceil(massima) + 'px';
                }
            }
        },

        /* La pista (se c'e') toccata dal tragitto [base, proposto]. */
        pista: function (a, b) {
            for (var i = 0; i < this.units.length; i++) {
                var u = this.units[i];
                if (!u.box.offsetParent) continue;
                var top = u.box.getBoundingClientRect().top + window.pageYOffset;
                var span = u.box.offsetHeight - H;
                if (span <= 0) continue;
                if (Math.max(a, b) < top || Math.min(a, b) > top + span) continue;
                return { top: top, span: span, S: u.S, aFoto: u.aFoto };
            }
            return null;
        },

        /* Il tetto del gesto: dal punto di partenza si avanza al massimo
           fino al riposo (meta' sosta) della battuta successiva. */
        tettoGesto: function (base, proposto) {
            // IN SALITA IL GESTO E' LIBERO. Scendendo, ogni battuta mostra
            // qualcosa di nuovo e il passo misurato e' il ritmo della lettura;
            // risalendo si sta solo uscendo, e farsi fermare a ogni battuta
            // sembra un rifiuto. Un colpo solo riporta dove arriva l'inerzia.
            if (proposto <= base) return proposto;
            var p = this.pista(base, proposto);
            if (!p) return proposto;
            var bPx = this.BATTUTA * H;
            var riposo = this.HOLD / 2;
            // Il gesto puo' cominciare sopra la pista: da piu' di una battuta
            // piu' in su il conto darebbe una battuta che la pista non ha.
            var x = Math.max((base - p.top) / bPx, -1);
            var k = Math.floor(x + 1e-6);
            return Math.min(proposto, p.top + ((k + 1) + riposo) * bPx);
        },

        /* A gesto finito: la sosta su cui assestarsi, o null se si e' gia'
           a riposo o fuori pista. Oltre meta' passaggio si completa,
           prima si torna. */
        sostaVicina: function (pos, su) {
            var p = this.pista(pos, pos);
            if (!p) return null;
            var bPx = this.BATTUTA * H;
            var x = (pos - p.top) / bPx;
            var k = Math.floor(x + 1e-6);
            var f = x - k;
            // Nella testata a fotografie la sosta e' quasi tutta zona viva:
            // non c'e' un viaggio da guardare dentro la battuta, e un colpo
            // di rotella (mouse) deve bastare a girare il quadro.
            if (f <= (p.aFoto ? .06 : this.HOLD)) return null;   // gia' in sosta
            var riposo = this.HOLD / 2;
            // per le foto la soglia e' in pixel veri: un colpo di rotella
            // (~120px) completa il quadro su qualunque altezza di finestra
            var meta = p.aFoto ? riposo + 60 / bPx : this.HOLD + (1 - this.HOLD) / 2;
            // Chi risale non va mai riportato in giu': il passaggio si
            // completa nel senso in cui il gesto stava andando. Scendendo vale
            // la regola di sempre - oltre meta' si completa, prima si torna.
            var xr = (su || f < meta) ? k + riposo : (k + 1) + riposo;
            // L'ultima battuta non ha una sosta dopo di se': il suo passaggio
            // finisce dove finisce la pista. Senza questo tetto, chi si ferma
            // nella coda della testata viene spinto GIU' oltre il confine.
            var y = Math.min(p.top + xr * bPx, p.top + p.span);
            return Math.abs(y - pos) < 2 ? null : y;
        },

        unitFor: function (host) {
            for (var i = 0; i < this.units.length; i++) {
                var u = this.units[i];
                if (u.host !== host || !u.box.offsetParent) continue;
                var r = u.box.getBoundingClientRect();
                if (r.height > 0 && r.bottom > 0 && r.top < H) return u;
            }
            return null;
        },

        update: function (dt) {
            for (var i = 0; i < this.units.length; i++) {
                var u = this.units[i];
                var span = u.box.offsetHeight - H;
                if (span <= 0) continue;

                // --- IL PUNTO CHE CONTA ---------------------------------
                // La rotella non manda un flusso continuo: manda salti di un
                // centinaio di pixel. Disegnare il valore grezzo significa
                // teletrasportare tutto a ogni tacca: e' quello che si vede
                // come "scatto", e nessuna rampa piu' lunga lo risolve.
                // Qui il valore vero non viene mai usato direttamente: un
                // valore interno lo insegue a ogni fotogramma, cosi' fra una
                // tacca e l'altra l'animazione continua a muoversi da sola.
                var grezzo = clamp(-u.box.getBoundingClientRect().top / span, 0, 1);

                // La testata a fotografie non si interpola: la posizione dice
                // soltanto QUALE quadro e' in scena, e il passaggio lo fa il
                // foglio di stile a tempo, come per i titoli delle sezioni.
                // Cosi' un gesto porta un quadro intero invece di lasciarne
                // meta' per strada.
                if (u.aFoto) {
                    // Il quadro si prende dalla posizione GREZZA, ma non si
                    // mette in scena subito. Una strisciata attraversa due o
                    // tre confini di battuta prima di assestarsi: facendo
                    // partire la sequenza a ogni attraversamento, un gesto
                    // solo ne faceva partire tre, una sopra l'altra. Si
                    // aspetta che il quadro stia fermo un momento, e vale
                    // sempre l'ULTIMO: cosi' un gesto e' una sequenza sola.
                    var quadro = clamp(Math.floor(grezzo * u.S), 0, u.n - 1);
                    if (quadro !== u.mostrato && quadro !== u.atteso) {
                        u.atteso = quadro;
                        clearTimeout(u.attesa);
                        u.attesa = setTimeout(function (unita, q) {
                            return function () {
                                if (unita.mostrato === q) return;
                                unita.mostrato = q;
                                quadri.vai(unita, q);
                            };
                        }(u, quadro), quadri.ATTESA);
                    }
                    continue;
                }

                if (u.prog === undefined) u.prog = grezzo;
                if (Math.abs(grezzo - u.prog) > 0.35) u.prog = grezzo;   // salto d'ancora: aggancia
                else u.prog += (grezzo - u.prog) * (1 - Math.exp(-(dt || 16) / (this.MORBIDEZZA * 1000)));

                var prog = u.prog;
                var x = prog * u.S;
                u.s = Math.min(Math.floor(x), u.S - 1);
                u.f = clamp(x - u.s, 0, 1);
                // Avanzamento grezzo del passaggio, da 0 a 1 lungo TUTTA la
                // parte mobile della battuta.
                var avanz = (u.s >= u.S - 1) ? 0
                          : clamp((u.f - this.HOLD) / (1 - this.HOLD), 0, 1);

                // Il movimento usa una curva a S: parte piano, accelera, frena.
                u.g = easeInOut(avanz);

                // La trasparenza NO: una curva a S concentra il cambiamento nel
                // mezzo e lo fa sembrare un lampo. Qui il passaggio da 0 a 100
                // e' distribuito in parti uguali su tutta la corsa, cosi' l'occhio
                // ha il tempo di vederlo.
                u.o = avanz;

                // --- i quadri: entrano alla battuta pari, escono alla dispari.
                // Corsa piena: chi esce e' gia' fuori quando chi entra arriva,
                // quindi due titoli non si sovrappongono mai. La rivelazione
                // la fa la finestra che ritaglia, non la trasparenza.
                var C = this.CORSA;
                for (var j = 0; j < u.n; j++) {
                    var off, op;
                    if (u.s < 2 * j)            off = C;
                    else if (u.s === 2 * j)     off = C * (1 - u.g);
                    else if (u.s === 2 * j + 1) off = -C * u.g;
                    else                        off = -C;

                    // l'opacita' segue la posizione: quasi niente al bordo,
                    // piena solo al centro della scena (richiesta del cliente:
                    // niente titoli gia' pieni appena sbucano)
                    op = Math.pow(clamp(1 - Math.abs(off) / C, 0, 1), .9);

                    var sl = u.slides[j];
                    // a riposo niente transform inline: WebKit perde i fondi
                    // delle evidenze multilinea dentro elementi trasformati
                    sl.style.transform = Math.abs(off) < .005 ? '' : 'translate3d(' + off.toFixed(2) + '%,0,0)';
                    sl.style.opacity = op.toFixed(3);
                    sl.style.visibility = op > 0.004 ? 'visible' : 'hidden';
                }

                // --- la parola in trasparenza
                var pari = (u.s % 2 === 0);
                u.gw = Math.min(Math.ceil(u.s / 2), u.n - 1);

                if (pari) {
                    // in scena da sola; quando il quadro entra, lei se ne va a
                    // sinistra dissolvendosi, senza sparire di colpo
                    u.ga = esce(u.o);        // la parola sgombra presto il campo
                    u.gdx = -u.g * W * 0.55;
                } else if (u.g > 0) {
                    // il claim se ne sta andando: entra da destra la parola dopo
                    u.ga = entra(u.o);       // ed entra prendendo il sopravvento
                    u.gdx = (1 - u.g) * W * 0.55;
                } else {
                    u.ga = 0;                        // battuta del claim: niente parola
                    u.gdx = 0;
                }

                // --- i testi lunghi: stesso ritmo dei quadri, ma con una
                // corsa piu' corta. Un testo da leggere non deve attraversare
                // lo schermo: gli basta uno scarto appena percettibile.
                var Ct = C;
                for (var t2 = 0; t2 < u.testi.length; t2++) {
                    var offT, opT;
                    if (u.s < 2 * t2)            offT = Ct;
                    else if (u.s === 2 * t2)     offT = Ct * (1 - u.g);
                    else if (u.s === 2 * t2 + 1) offT = -Ct * u.g;
                    else                         offT = -Ct;

                    opT = Math.pow(clamp(1 - Math.abs(offT) / Ct, 0, 1), .9);

                    var el = u.testi[t2];
                    el.style.transform = Math.abs(offT) < .005 ? '' : 'translate3d(' + offT.toFixed(2) + '%,0,0)';
                    el.style.opacity = opT.toFixed(3);
                    el.style.visibility = opT > 0.004 ? 'visible' : 'hidden';
                }

                for (var L = 0; L < u.leads.length; L++) u.leads[L].style.opacity = '1';
            }
        }
    };

    var effects = { tipografia: tipografia, lettere: lettere };

    /* ---------------- loop ---------------- */

    var last = 0, telaViva = false;
    function frame(ts) {
        var dt = last ? Math.min(ts - last, 64) : 16;
        last = ts;
        scrollY = window.pageYOffset;

        ctx.clearRect(0, 0, W, H);

        // Con "riduci movimento" il telo serve solo a ridipingere i fondi
        // delle sezioni (rese trasparenti dal foglio): nessun effetto.
        if (reduceMotion) {
            for (var b = 0; b < hosts.length; b++) {
                var hb = hosts[b];
                if (!hb.bg) continue;
                var rb = hb.el.getBoundingClientRect();
                if (rb.bottom < -60 || rb.top > H + 60) continue;
                ctx.fillStyle = hb.bg;
                ctx.fillRect(0, rb.top - 1, W, rb.height + 2);
            }
            if (!telaViva) { telaViva = true; document.body.classList.add('fx-tela'); }
            if (running) requestAnimationFrame(frame);
            return;
        }

        velluto.tick(dt);
        scrub.update(dt);
        lenti.update();

        var lettereAttive = false;
        var bestCover = 0, best = null;

        for (var i = 0; i < hosts.length; i++) {
            var host = hosts[i];
            var rect = host.el.getBoundingClientRect();
            if (rect.bottom < -60 || rect.top > H + 60) continue;

            if (host.el.tagName !== 'FOOTER') {
                var cover = Math.min(rect.bottom, H) - Math.max(rect.top, 0);
                if (cover > bestCover) { bestCover = cover; best = host; }
            }

            ctx.save();
            ctx.beginPath();
            ctx.rect(0, rect.top, W, rect.height);
            ctx.clip();

            if (host.bg) {
                ctx.fillStyle = host.bg;
                ctx.fillRect(0, rect.top - 1, W, rect.height + 2);
            }

            /* Fondi interni alla sezione, dipinti sulla tela.
               Serve al pannello aperto dell'accordion: se il suo fondo
               restasse nel foglio, le lettere che si compongono sulla tela
               gli finirebbero dietro e non si vedrebbero. Cosi' invece il
               fondo sta sotto e le lettere sopra. */
            var fondi = host.el.querySelectorAll('[data-fx-fondo]');
            for (var q = 0; q < fondi.length; q++) {
                var el = fondi[q];
                if (el.classList.contains('ha-p') && !el.classList.contains('aperto')) continue;
                var rf = el.getBoundingClientRect();
                if (rf.width < 1 || rf.height < 1) continue;
                ctx.fillStyle = el.dataset.fxFondo;
                ctx.fillRect(rf.left, rf.top, rf.width, rf.height);
            }

            for (var f = 0; f < host.fx.length; f++) {
                var name = host.fx[f];
                var fx = effects[name];
                if (!fx) continue;
                if (name === 'lettere') lettereAttive = true;
                fx.draw(host, BASE_ALPHA[name] * (0.25 + host.intensity * 1.5), ts, rect, dt);
            }
            ctx.restore();
        }

        rivela.infondo();
        if (lettereAttive) lettere.update(dt);
        if (best && best !== activeHost) { activeHost = best; syncUI(); }
        // il primo fotogramma e' stato disegnato: da qui i fondi passano al telo
        if (!telaViva) { telaViva = true; document.body.classList.add('fx-tela'); }
        if (running) requestAnimationFrame(frame);
    }

    /* ---------------- pannello (solo preview) ---------------- */

    var ui, uiTitle, uiButtons = [], uiRange;

    /* Il pannello e' uno strumento di lavoro, non fa parte del sito.
       Compare solo se lo si chiede: ?fx-panel nell'indirizzo, oppure
       data-fx-panel sul <body>. In produzione non esiste. */
    function pannelloRichiesto() {
        return /[?&]fx-panel/.test(location.search) ||
               document.body.dataset.fxPanel !== undefined;
    }

    function buildUI() {
        if (!pannelloRichiesto()) return;
        ui = document.createElement('div');
        ui.id = 'fx-ui';
        uiTitle = document.createElement('h6');
        ui.appendChild(uiTitle);

        ORDER.forEach(function (name, n) {
            var b = document.createElement('button');
            b.textContent = (n + 1) + ' · ' + (name === 'off' ? 'NESSUNO' : name.toUpperCase());
            b.dataset.fx = name;
            b.addEventListener('click', function () { setFx(name); });
            uiButtons.push(b);
            ui.appendChild(b);
        });

        var row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = '<span>INTENS.</span>';
        uiRange = document.createElement('input');
        uiRange.type = 'range'; uiRange.min = '0'; uiRange.max = '100';
        uiRange.addEventListener('input', function () {
            if (activeHost) activeHost.intensity = this.value / 100;
        });
        row.appendChild(uiRange);
        ui.appendChild(row);

        var exp = document.createElement('button');
        exp.textContent = 'ESPORTA CONFIG';
        exp.style.marginTop = '10px';
        exp.addEventListener('click', exportConfig);
        ui.appendChild(exp);

        var hint = document.createElement('div');
        hint.className = 'hint';
        hint.textContent = 'Tasti 1-3: cambiano SOLO la sezione che stai guardando. Pannello di preview.';
        ui.appendChild(hint);

        document.body.appendChild(ui);
        syncUI();
    }

    function syncUI() {
        if (!ui || !activeHost) return;
        uiTitle.textContent = activeHost.label;
        for (var i = 0; i < uiButtons.length; i++) {
            var n = uiButtons[i].dataset.fx;
            var on = n === 'off' ? activeHost.fx.indexOf('off') >= 0 : activeHost.fx.indexOf(n) >= 0;
            uiButtons[i].setAttribute('aria-pressed', String(on));
        }
        uiRange.value = String(Math.round(activeHost.intensity * 100));
    }

    function setFx(name) {
        if (!activeHost) return;
        var i = activeHost.fx.indexOf(name);
        if (name === 'off') activeHost.fx = ['off'];
        else if (i >= 0) activeHost.fx.splice(i, 1);           // secondo clic: lo toglie
        else activeHost.fx = activeHost.fx.filter(function (f) { return f !== 'off'; }).concat(name);
        if (!activeHost.fx.length) activeHost.fx = ['off'];
        syncUI();
    }

    function exportConfig() {
        var out = hosts.map(function (h) {
            var w = h.words ? ' data-fx-words="' + h.words.join('|') + '"' : '';
            return '<' + h.el.tagName.toLowerCase() + (h.el.id ? ' id="' + h.el.id + '"' : '') +
                   ' data-fx="' + h.fx.join(' ') + '" data-fx-i="' + h.intensity.toFixed(2) + '"' + w + '>';
        }).join('\n');
        console.log('%c— MASTERY FX · config —', 'font-weight:700', '\n' + out);
        if (navigator.clipboard) navigator.clipboard.writeText(out).catch(function () {});
        var hint = ui.querySelector('.hint');
        hint.textContent = 'Config copiata negli appunti e stampata in console.';
        setTimeout(function () {
            hint.textContent = 'Tasti 1-3: cambiano SOLO la sezione che stai guardando. Pannello di preview.';
        }, 2600);
    }

    window.addEventListener('keydown', function (e) {
        // Scorciatoie del pannello di lavoro: senza pannello non esistono
        // (prima erano vive anche in produzione), e mai dentro un campo.
        if (!ui) return;
        var t = e.target, tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        var i = ['1', '2', '3'].indexOf(e.key);
        if (i >= 0) setFx(ORDER[i]);
    });

    var rt;
    window.addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(measure, 180); });

    document.addEventListener('visibilitychange', function () {
        if (document.hidden) running = false;
        else if (!running) { running = true; last = 0; requestAnimationFrame(frame); }
    });

    window.__fx = { rivela: rivela, marchio: marchio, quadri: quadri, hosts: hosts, lettere: lettere, effects: effects, scrub: scrub, velluto: velluto, lenti: lenti, accordion: accordion };

    /* Il sito fa avanzare i quadri da solo dopo 9,5s (8s per la fascia
       dati) chiamando window.scrollTo: e' uno scroll che l'utente non ha
       chiesto. Il sito stesso pero' smette per sempre appena registra un
       gesto, quindi gliene facciamo arrivare uno finto: nessuna patch al
       suo codice, e il timer non riparte piu'. */
    function stopAvanzamentoAutomatico() {
        try {
            var ev = function () { return new WheelEvent('wheel', { bubbles: true }); };
            window.dispatchEvent(ev());
            document.querySelectorAll('.databand').forEach(function (b) {
                b.dispatchEvent(ev());
            });
        } catch (e) { /* browser senza WheelEvent: pazienza */ }
    }

    /* Chi arriva con un'ancora (#sezione) viene ancorato dal browser sul
       layout NUDO; poi le misure allungano le piste e il bersaglio scivola
       piu' in basso. Dopo ogni misura d'avvio si ri-ancora, finche' l'utente
       non tocca: dal primo gesto la posizione e' sua. */
    var gestoUtente = false;
    ['wheel', 'touchstart', 'keydown', 'pointerdown'].forEach(function (ev) {
        // isTrusted: il gesto finto che spegne l'avanzamento automatico
        // non deve contare come mano dell'utente
        window.addEventListener(ev, function (e) {
            if (e.isTrusted) gestoUtente = true;
        }, { passive: true });
    });

    function riancora() {
        if (!location.hash || gestoUtente) return;
        var dest = document.getElementById(location.hash.slice(1));
        if (!dest) return;
        var nav = document.querySelector('.nav');
        var y = dest.getBoundingClientRect().top + window.pageYOffset
              - ((nav ? nav.getBoundingClientRect().height : 72) + 8);
        y = Math.max(0, y);
        window.scrollTo(0, y);
        if (velluto.attivo) {
            velluto.corrente = velluto.target = y;
            velluto.ultimoScritto = null;
        }
    }

    function boot() {
        install();
        stopAvanzamentoAutomatico();
        velluto.init();
        measure();
        riancora();
        buildUI();
        requestAnimationFrame(frame);
        if (document.fonts && document.fonts.ready)
            document.fonts.ready.then(function () { measure(); riancora(); });
        setTimeout(function () { measure(); riancora(); }, 1200);
    }

    // Il gesto finto parte SUBITO, alla valutazione dello script: il boot
    // aspetta il load, ma su un primo caricamento freddo (immagini, font
    // dalla rete) il load puo' arrivare DOPO i 9,5s del timer del sito,
    // e l'avanzamento automatico scatterebbe prima di essere spento.
    stopAvanzamentoAutomatico();

    if (document.readyState === 'complete') boot();
    else window.addEventListener('load', boot);
})();
