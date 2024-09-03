var abc = null;
var srcend = null;
var play = null;
var config = null;
var abc_fname = ["noname.abc", ""];
var selx = [0, 0];
var selx_sav = [];
var jsdir = document.currentScript ?
    document.currentScript.src.match(/.*\//) :
    (function() {
        var scrs = document.getElementsByTagName('script');
        return scrs[scrs.length - 1].src.match(/.*\//) || ''
    })();

/**
 * Called with each new generated SVG line/music system as argument
 */
function onLineReady(svgString) {
    var target = document.getElementById('target');
    var child = document.createElement('div');
    child.innerHTML = svgString;
    target.appendChild(child);
}

/**
 * Generates SVG code from provided music sbc notation and inserts it in
 * the DOM.
 */
function render() {

    // Grab user input
    if (!abc_src) {
        return;
    }

    // Cleanup previous rendered material
    document.getElementById('target').innerHTML = '';

    // Initialize renderer if needed
    if (!abc) {
        config = {
            img_out: onLineReady,
            get_abcmodel: null,
            errmsg: function () {
            	console.error.apply (null, arguments);
            },

            // Draw annotations to highlight notes as they are played
            anno_stop: function(type, start, stop, x, y, w, h) {
                if (["beam", "slur", "tuplet"].indexOf(type) >= 0) {
                    return;
                }
                srcend[start] = stop;
                abc.out_svg('<rect class="abcr _' + start + '_" x="');
                abc.out_sxsy(x, '" y="', y);
                abc.out_svg('" width="' + w.toFixed(2) +
                    '" height="' + abc.sh(h).toFixed(2) + '"/>\n');
            },
        }
        abc = new abc2svg.Abc(config);
    }

    // Execute the parser and print errors to both console and page. Content will arrive in page via the callback function `onLineReady()`
    try {
        srcend = [];
        abc.tosvg('test', abc_src);
    } catch (e) {
        var errMessage = 'Error while running `abc.tosvg()`:\n' + e.message + '\n' + e.stack;
        console.error(errMessage);
        onLineReady('<p class="text error">' + errMessage + '</p>');
    }
}

/**
 * Called when the end-user selects an SVG element using the mouse.
 */
function svgsel(evt) {
    console.log('Selecting SVG element...');

    evt.stopImmediatePropagation();
    evt.preventDefault();

    var elt = evt.target;
    var cl = elt.getAttribute('class');

    // Stop playing
    stopPlayback();

    // Highlight the clicked element or clear the selection start
    if (cl && cl.substr(0, 4) == 'abcr') {
        setsel(0, Number(cl.slice(6, -1)));
    } else {
        setsel(0, 0);
    }

    // Clear the selection emd
    setsel(1, 0);
}

/**
 * Programmatically selects a note in the rendered score
 */
function setsel(idx, v, seltxt) {
    var i, elts, s,
        old_v = selx[idx];

    if (v == old_v) {
        return;
    };
    if (old_v) {
        elts = document.getElementsByClassName('_' + old_v + '_');
        i = elts.length;
        while (--i >= 0) {
            elts[i].style.fillOpacity = 0;
        }
    }
    if (v) {
        elts = document.getElementsByClassName('_' + v + '_');
        i = elts.length;
        while (--i >= 0) {
            elts[i].style.fillOpacity = 0.4;
        }
    }

    selx[idx] = v;
    if (idx != 0 || seltxt || !v) {
        return;
    }
}

/**
 * Plays rendered music while highlighting the current note.
 */
function startPlayback() {
    console.log('playing back');
    play_tune(-1);
}

/**
 * Stops playing rendered music and clears last highlighted note.
 */
function stopPlayback() {
    if (play.playing && !play.stop) {
        play.stop = -1;
        play.abcplay.stop();
        console.log('Playback stopped');
    }
    console.log('Playback was not engaged. Nothing to do.');
}

/**
 * Called when playback ends because the end of available music was
 * reached.
 */
function endplay() {
    if (play.loop) {
        play.abcplay.play(play.si, play.ei, play.a_pe)
        return
    }
    play.playing = false;
    setsel(0, selx_sav[0]);
    setsel(1, selx_sav[1])
}

/**
 * Called as the virtual "playback head" hits every note displayed
 * in the score.
 */
function notehlight(i, on) {

    console.log('Highlighting note with index', i);
    console.log('document is:', document)

    if (play.stop) {
        if (on) {
            if (play.stop < 0) // if first stop
                play.stop = i // keep the last note reference
            return
        }
        if (i == selx[1]) // if end selection
            return // don't remove highlight
    }
    if (document) {
        var elts = document.getElementsByClassName('_' + i + '_');
        if (elts && elts[0]) {
            if (on) {
                do_scroll(elts[0]);
            }
            elts[0].style.fillOpacity = on ? 0.4 : 0
        }
    }
}

/**
 * Scrolls the page to keep selected note in the viewport
 */
function do_scroll(elt) {
    var r,
        targetArea = document.getElementById('target'),
        dr = targetArea.parentElement,
        drh = dr.getBoundingClientRect().height,
        ty = targetArea.getBoundingClientRect().y;
    while (elt.tagName != 'svg') {
        elt = elt.parentNode;
    }
    r = elt.getBoundingClientRect();
    if (r.y < 0) {
        dr.scrollTo(0, r.y - ty);
    } else if (r.y + r.height > drh) {
        dr.scrollTo(0, r.y - ty - drh + r.height);
    }
}

/**
 * Starts playing a given ABC tune.
 *
 * @param    what
 *           Numeric constant to control playback type. Possible values
 *           are:
 *           -1: All. PLay all tunes in given ABC code;
 *           0: Tune. PLay current tune;
 *           1: Selection. Play current selection;
 *           2: Loop. PLay current tune or selection in a loop.
 *           3: NOT USED.
 */
function play_tune(what) {
    if (play.playing) {
        if (!play.stop) {
            play.stop = -1;
            play.abcplay.stop()
        }
        return
    }

    // search a playing event from a source index
    function get_se(si) { // get highest starting event
        var i, s, tim,
            sih = 1000000,
            pa = play.a_pe,
            ci = 0

        if (si <= pa[0][0])
            return 0
        if (si >= pa[pa.length - 1][0])
            return pa.length

        i = pa.length
        while (--i > 0) {
            s = pa[i][0]
            if (s < si)
                continue
            if (s == si) {
                ci = i
                break
            }
            if (s < sih) {
                ci = i;
                sih = s
            }
        }

        // go to the first voice at this time
        if (ci < pa.length) {
            tim = pa[ci][1]
            while (--ci >= 0) {
                if (pa[ci][1] != tim)
                    break
            }
        }
        return ci + 1
    } // get_se()

    function get_ee(si) { // get lowest ending event
        var i, s, tim,
            sil = 0,
            pa = play.a_pe,
            ci = 0

        if (si <= pa[0][0])
            return 0
        if (si >= pa[pa.length - 1][0])
            return pa.length

        for (i = 0; i < pa.length; i++) {
            s = pa[i][0]
            if (s > si)
                continue
            if (s == si) {
                ci = i
                break
            }
            if (s > sil) {
                ci = i;
                sil = s
            }
        }

        // go to after the last voice at this time
        if (ci > 0) {
            tim = pa[ci++][1]
            for (; ci < pa.length; ci++) {
                if (pa[ci][1] != tim)
                    break
            }
        }
        return ci
    } // get_ee()

    // start playing
    function play_start(si, ei) {
        selx_sav[0] = selx[0]; // remove the colors
        selx_sav[1] = selx[1];
        setsel(0, 0);
        setsel(1, 0);

        play.stop = 0;
        play.abcplay.play(si, ei, play.a_pe) // start playing
    }

    var abc, i, si, ei, elt, tim,
        s = abc_src;

    play.playing = true;
    if (!play.a_pe) { // if no playing event
        config.img_out = null // get the schema and stop SVG generation
        config.get_abcmodel = play.abcplay.add // inject the model in the play engine

        abc = new abc2svg.Abc(config);

        play.abcplay.clear();
        abc.tosvg("play", "%%play")
        try {
            abc.tosvg(abc_fname[0], s)
        } catch (e) {
            console.error(e.message + '\nabc2svg tosvg bug - stack:\n' + e.stack);
            play.playing = false;
            play.a_pe = null
            return
        }
        play.a_pe = play.abcplay.clear(); // keep the playing events

        play.si = play.ei = play.stop = 0;
        play.loop = false
    }

    // play all
    if (what < 0) {
        play.loop = false;
        play.si = 0;
        play.ei = play.a_pe.length;
        play_start(play.si, play.ei)
        return
    }

    // if loop again
    if (what == 2 && play.loop) {
        play_start(play.si, play.ei)
        return
    }

    // get the starting and ending play indexes, and start playing
    if (what == 3 && play.stop > 0) { // if stopped and continue
        play_start(get_se(play.stop), play.ei)
        return
    }
    if (what != 0 && selx[0] && selx[1]) { // if full selection
        si = get_se(selx[0]);
        ei = get_ee(selx[1])
    } else if (what != 0 && selx[0]) { // if selection without end
        si = get_se(selx[0]);
        i = s.indexOf('\nX:', selx[0]);
        ei = i < 0 ? play.a_pe.length : get_ee(i)
    } else if (what != 0 && selx[1]) { // if selection without start
        i = s.lastIndexOf('\nX:', selx[1]);
        si = i < 0 ? 0 : get_se(i);
        ei = get_ee(selx[1])
    } else { // no selection => tune
        i = 0;
        si = ei = 0
        if (s[0] == 'X' && s[1] == ':')
            si = 1
        while (1) { // search the start and end of the tune
            ei = s.indexOf('\nX:', ei)
            if (ei < 0 || ei > i)
                break
            si = s.indexOf('\nK:', ++ei)
            if (si < 0)
                break
            ei = si
        }
        if (si <= 0) {
            play.playing = false
            return // no tune!
        }

        si = get_se(si);
        ei = ei < 0 ? play.a_pe.length : get_ee(ei)
    }

    if (what != 3) { // if not continue
        play.si = si;
        play.ei = ei;
        play.loop = what == 2
    }

    play_start(si, ei)
}

/**
 * Dynamically loads javascript files.
 * @param    fn
 *           File name to load.
 *
 * @param    relay
 *           Function to call when file has been successfully loaded.
 *
 * @param    onerror
 *           Function to call when loading the file fails.
 */
function loadJsFile(fn, relay, onerror) {
    var s = document.createElement('script');
    // Absolute URL
    if (/:\/\//.test(fn)) {
        s.src = fn
    } else {
        s.src = jsdir + fn;
    }
    s.type = 'text/javascript';
    if (relay) {
        s.onload = relay;
    }
    s.onerror = onerror || function() {
        console.error('Error loading ' + fn);
    }
    document.head.appendChild(s);
}

// MAIN
// ----
(function() {

    // Override abc2svg.loadjs stub method
    abc2svg.loadjs = loadJsFile;

    // Hook up buttons
    var playBtn = document.getElementById('playBackButton');
    playBtn.addEventListener('click', startPlayback);

    var stopButton = document.getElementById('stopButton');
    stopButton.addEventListener('click', stopPlayback);

    var targetArea = document.getElementById('target');
    targetArea.addEventListener('click', svgsel);

    // Initialize playback
    if (window.AudioContext || window.webkitAudioContext) {
        if (!play) {
            play = {};
        }
        play.abcplay = AbcPlay({
            onend: endplay,
            onnote: notehlight,
        });
        play.abcplay.set_sfu('Scc1t2');
    }

})();