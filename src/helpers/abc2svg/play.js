// play-1.js - file to include in html pages with abc2svg-1.js for playing

// This file is a wrapper around
// - ToAudio (toaudio.js - convert ABC to audio sequences)
// - Audio5 (toaudio5.js - play the audio sequences with webaudio and SF2)
// - Midi5 (tomidi5.js - play the audio sequences with webmidi)

// AbcPlay methods:
//
// get_outputs() - return an array of output devices
//
// set_output() - set the output type/port
//
// set_sfu() - get/set the soundfont URL
// @url: URL - undefined = return current value
//
// set_speed() - get/set the play speed
// @speed: < 1 slower, > 1 faster - undefined = return current value
//
// set_vol() - get/set the current sound volume
// @volume: range [0..1] - undefined = return current value

function AbcPlay(i_conf) {
    var conf = i_conf,
        audio = ToAudio(),
        audio5, midi5, current,
        abcplay = { // returned object (only instance)

            // get the output type/ports
            get_outputs: function() {
                var o,
                    outputs = []

                if (midi5) {
                    o = midi5.get_outputs()
                    if (o)
                        outputs = o
                }
                if (audio5) {
                    o = audio5.get_outputs()
                    if (o)
                        outputs = outputs.concat(o)
                }
                return outputs;
            },
            set_output: set_output,
            clear: audio.clear,
            add: audio.add,
            set_sft: vf,
            set_sfu: function(v) {
                if (v == undefined) {
                    return conf.sfu;
                };
                conf.sfu = v;
            },
            set_speed: function(v) {
                if (v == undefined)
                    return conf.speed
                conf.new_speed = v
            },
            set_vol: function(v) {
                if (v == undefined)
                    return conf.gain;
                conf.gain = v
                if (current && current.set_vol)
                    current.set_vol(v)
            },
            play: play,
            stop: vf
        }

    function vf() {} // void function

    // start playing when no defined output
    function play(istart, i_iend, a_e) {
        var o,
            os = abcplay.get_outputs()
        if (os.length == 1) {
            o = 0
        } else {
            o = -1
            var res = window.prompt('Use \n0: ' + os[0] +
                '\n1: ' + os[1] + '?', '0')
            if (res) {
                o = Number(res)
                if (isNaN(o) || o < 0 || o >= os.length)
                    o = -1
            }
            if (!res || o < 0) {
                if (conf.onend)
                    conf.onend()
                return
            }
        }
        set_output(os[o]);
        abcplay.play(istart, i_iend, a_e)
    }

    // set the current output changing the play functions
    function set_output(name) {
        current = name == 'sf2' ? audio5 : midi5
        if (!current)
            return
        abcplay.play = current.play;
        abcplay.stop = current.stop
        if (current.set_output)
            current.set_output(name)
    } // set_output()

    // set default configuration values
    conf.gain = 0.7;
    conf.speed = 1;

    // get the play parameters from localStorage
    (function get_param() {
        try {
            if (!localStorage)
                return
        } catch (e) {
            return
        }
        var v = localStorage.getItem("sfu")
        if (v)
            conf.sfu = v;
        v = localStorage.getItem("volume")
        if (v)
            conf.gain = Number(v)
    })()

    // initialize the playing engines
    if (typeof Midi5 == "function")
        midi5 = Midi5(conf)
    if (typeof Audio5 == "function")
        audio5 = Audio5(conf);

    return abcplay
} // AbcPlay

// toaudio.js - audio generation
// ToAudio creation
function ToAudio() {

    var C = abc2svg.C,

        scale = new Uint8Array([0, 2, 4, 5, 7, 9, 11]), // note to pitch conversion

        a_e, // event array
        p_time, // last playing time
        abc_time, // last ABC time
        play_factor; // play time factor

    // ToAudio
    return {

        // clear the playing events and
        // return the old ones as an array of Float32Array:
        //	[0]: index of the note in the ABC source
        //	[1]: time in seconds
        //	[2]: MIDI instrument (MIDI GM number - 1)
        //	[3]: MIDI note pitch (with cents)
        //	[4]: duration
        //	[5]: volume (0..1)
        //	[6]: voice number
        clear: function() {
            var a_pe = a_e;
            a_e = null
            return a_pe
        }, // clear()

        // add playing events from the ABC model
        add: function(start, // starting symbol
            voice_tb) { // voice table
            var kmaps = [], // accidentals per voice from key signature
                cmaps = [], // current accidental table
                map, // map of the current voice - 10 octaves
                temper, // temperament
                i, n, dt, d, v,
                top_v, // top voice
                rep_st_s, // start of sequence to be repeated
                rep_en_s, // end ("|1")
                rep_nx_s, // restart at end of repeat
                rep_st_transp, // transposition at start of repeat sequence
                rep_st_map, // and map
                rep_st_fac, // and play factor
                transp, // clef transposition per voice
                instr = [], // instrument per voice
                s = start

            // set the accidentals, transpositions and instruments of the voices
            function set_voices() {
                var v, p_v, s, mi

                temper = voice_tb[0].temper; // (set by the module temper.js)
                transp = new Int8Array(voice_tb.length)
                for (v = 0; v < voice_tb.length; v++) {
                    p_v = voice_tb[v];

                    mi = p_v.instr || 0
                    if (p_v.midictl) {
                        if (p_v.midictl[32]) // bank LSB
                            mi += p_v.midictl[32] * 128
                        if (p_v.midictl[0]) // bank MSB
                            mi += p_v.midictl[0] * 128 * 128
                    }
                    instr[v] = mi; // MIDI instrument

                    s = p_v.clef;
                    transp[v] = (!s.clef_octave || s.clef_oct_transp) ?
                        0 : s.clef_octave

                    kmaps[v] = new Float32Array(70);
                    cmaps[v] = new Float32Array(70);
                    p_v.key.v = v;
                    key_map(p_v.key)
                }
            } // set_voices()

            // define the accidentals of a voice
            function key_map(s) {
                var i, bmap

                if (s.k_bagpipe) {
                    // detune for just intonation in A (C is C#, F is F# and G is Gnat)
                    //		bmap = new Float32Array([100-13.7, -2, 2, 100-15.6, -31.2, 0, 3.9])
                    //		for (i = 0; i < 7; i++)
                    //			bmap[i] = (bmap[i] + 150.6) / 100 // 'A' bagpipe = 480Hz
                    //				// 150.6 = (Math.log2(480/440) - 1)*1200
                    bmap = new Float32Array([2.37, 1.49, 1.53, 2.35, 1.19, 1.51, 1.55])
                } else {
                    bmap = new Float32Array(7)
                    switch (s.k_sf) {
                        case 7:
                            bmap[6] = 1
                        case 6:
                            bmap[2] = 1
                        case 5:
                            bmap[5] = 1
                        case 4:
                            bmap[1] = 1
                        case 3:
                            bmap[4] = 1
                        case 2:
                            bmap[0] = 1
                        case 1:
                            bmap[3] = 1;
                            break
                        case -7:
                            bmap[3] = -1
                        case -6:
                            bmap[0] = -1
                        case -5:
                            bmap[4] = -1
                        case -4:
                            bmap[1] = -1
                        case -3:
                            bmap[5] = -1
                        case -2:
                            bmap[2] = -1
                        case -1:
                            bmap[6] = -1;
                            break
                    }
                }
                for (i = 0; i < 10; i++)
                    kmaps[s.v].set(bmap, i * 7);
                cmaps[s.v].set(kmaps[s.v])
            } // key_map()

            // convert ABC pitch to MIDI index
            function pit2mid(s, i) {
                var note = s.notes[i],
                    p = note.pit + 19, // pitch from C-1
                    a = note.acc

                if (transp[s.v])
                    p += transp[s.v]
                if (a) {
                    if (a == 3) // (3 = natural)
                        a = 0
                    else if (note.micro_n)
                        a = (a < 0 ? -note.micro_n : note.micro_n) /
                        note.micro_d * 2;
                    map[p] = a
                } else {
                    a = map[p]
                }
                p = ((p / 7) | 0) * 12 + scale[p % 7] + a
                if (!temper || a | 0 != a) // if equal temperament or micro-tone
                    return p
                return p + temper[p % 12]
            } // pit2mid()

            // handle the ties
            function do_tie(s, note, d) {
                var n,
                    end_time = s.time + s.dur,
                    pit = note.pit,
                    p = pit + 19,
                    a = note.acc

                if (transp[s.v])
                    p += transp[s.v]

                // search the end of the tie
                for (s = s.next;; s = s.next) {
                    if (!s)
                        return d

                    // skip if end of sequence to be repeated
                    if (s == rep_en_s) {
                        var v = s.v;
                        s = rep_nx_s.ts_next
                        while (s && s.v != v)
                            s = s.ts_next
                        if (!s)
                            return d
                        end_time = s.time
                    }
                    if (s.time != end_time)
                        return d
                    if (s.type == C.NOTE)
                        break
                }
                n = s.notes.length
                for (i = 0; i < n; i++) {
                    note = s.notes[i]
                    if (note.pit == pit) {
                        d += s.dur / play_factor;
                        note.ti2 = true
                        return note.ti1 ? do_tie(s, note, d) : d
                    }
                }
                return d
            } // do_tie()

            // generate the grace notes
            function gen_grace(s) {
                var g, i, n, t, d, s2,
                    next = s.next

                // before beat
                if (s.sappo) {
                    d = C.BLEN / 16
                } else if ((!next || next.type != C.NOTE) &&
                    s.prev && s.prev.type == C.NOTE) {
                    d = s.prev.dur / 2

                    // on beat
                } else {

                    // keep the sound elements in time order
                    next.ts_prev.ts_next = next.ts_next;
                    next.ts_next.ts_prev = next.ts_prev;
                    for (s2 = next.ts_next; s2; s2 = s2.ts_next) {
                        if (s2.time != next.time) {
                            next.ts_next = s2
                            next.ts_prev = s2.ts_prev;
                            next.ts_prev.ts_next = next;
                            s2.ts_prev = next
                            break
                        }
                    }

                    if (!next.dots)
                        d = next.dur / 2
                    else if (next.dots == 1)
                        d = next.dur / 3
                    else
                        d = next.dur * 2 / 7;
                    next.time += d;
                    next.dur -= d
                }
                n = 0
                for (g = s.extra; g; g = g.next)
                    if (g.type == C.NOTE)
                        n++;
                d /= n * play_factor;
                t = p_time
                for (g = s.extra; g; g = g.next) {
                    if (g.type != C.NOTE)
                        continue
                    gen_notes(g, t, d);
                    t += d
                }
            } // gen_grace()

            // generate the notes
            function gen_notes(s, t, d) {
                for (var i = 0; i <= s.nhd; i++) {
                    var note = s.notes[i]
                    if (note.ti2)
                        continue
                    a_e.push(new Float32Array([
                        s.istart,
                        t,
                        instr[s.v],
                        pit2mid(s, i),
                        note.ti1 ? do_tie(s, note, d) : d,
                        1,
                        s.v
                    ]))
                }
            } // gen_note()

            // add() main

            set_voices(); // initialize the voice parameters

            if (!a_e) { // if first call
                a_e = []
                abc_time = rep_st_t = p_time = 0;
                play_factor = C.BLEN / 4 * 120 / 60 // default: Q:1/4=120
            } else if (s.time < abc_time) {
                abc_time = rep_st_t = s.time
            }

            // loop on the symbols
            while (s) {
                //		if (s.type == C.TEMPO
                //		 && s.tempo) {
                if (s.tempo) { // tempo change
                    d = 0;
                    n = s.tempo_notes.length
                    for (i = 0; i < n; i++)
                        d += s.tempo_notes[i];
                    play_factor = d * s.tempo / 60
                }

                dt = s.time - abc_time
                if (dt > 0) {
                    p_time += dt / play_factor;
                    abc_time = s.time
                }

                if (s == rep_en_s) { // repeat end
                    s = rep_nx_s;
                    abc_time = s.time
                }

                map = cmaps[s.v]
                switch (s.type) {
                    case C.BAR:
                        //fixme: does not work if different measures per voice
                        if (s.v != top_v)
                            break

                        // right repeat
                        if (s.bar_type[0] == ':') {
                            s.bar_type = '|' +
                                s.bar_type.slice(1); // don't repeat again
                            rep_nx_s = s // repeat next
                            if (!rep_en_s) // if no "|1"
                                rep_en_s = s // repeat end
                            if (rep_st_s) { // if left repeat
                                s = rep_st_s
                                for (v = 0; v < voice_tb.length; v++) {
                                    cmaps[v].set(rep_st_map[v]);
                                    transp[v] = rep_st_transp[v]
                                }
                                play_factor = rep_st_fac;
                            } else { // back to start
                                s = start;
                                set_voices();
                            }
                            abc_time = s.time
                            break
                        }

                        if (!s.invis) {
                            for (v = 0; v < voice_tb.length; v++)
                                cmaps[v].set(kmaps[v])
                        }

                        // left repeat
                        if (s.bar_type[s.bar_type.length - 1] == ':') {
                            rep_st_s = s;
                            rep_en_s = null
                            for (v = 0; v < voice_tb.length; v++) {
                                if (!rep_st_map)
                                    rep_st_map = []
                                if (!rep_st_map[v])
                                    rep_st_map[v] =
                                    new Float32Array(70)
                                rep_st_map[v].set(cmaps[v]);
                                if (!rep_st_transp)
                                    rep_st_transp = []
                                rep_st_transp[v] = transp[v]
                            }
                            rep_st_fac = play_factor
                            break

                            // 1st time repeat
                        } else if (s.text && s.text[0] == '1') {
                            rep_en_s = s
                        }
                        break
                    case C.CLEF:
                        transp[s.v] = (!s.clef_octave || s.clef_oct_transp) ?
                            0 : s.clef_octave
                        break
                    case C.GRACE:
                        if (s.time == 0 // if before beat at start time
                            &&
                            abc_time == 0) {
                            dt = 0
                            if (s.sappo)
                                dt = C.BLEN / 16
                            else if (!s.next || s.next.type != C.NOTE)
                                dt = d / 2;
                            abc_time -= dt
                        }
                        gen_grace(s)
                        break
                    case C.KEY:
                        key_map(s)
                        break
                    case C.REST:
                    case C.NOTE:
                        d = s.dur
                        if (s.next && s.next.type == C.GRACE) {
                            dt = 0
                            if (s.next.sappo)
                                dt = C.BLEN / 16
                            else if (!s.next.next || s.next.next.type != C.NOTE)
                                dt = d / 2;
                            s.next.time -= dt;
                            d -= dt
                        }
                        d /= play_factor
                        if (s.type == C.NOTE)
                            gen_notes(s, p_time, d)
                        else
                            a_e.push(new Float32Array([
                                s.istart,
                                p_time,
                                0,
                                0,
                                d,
                                0,
                                s.v
                            ]))
                        break
                    case C.STAVES:
                        top_v = s.sy.top_voice
                        break
                }
                s = s.ts_next
            }
        } // add()
    } // return
} // ToAudio

// nodejs
if (typeof module == 'object' && typeof exports == 'object')
    exports.ToAudio = ToAudio

// toaudio5.js - audio output using HTML5 audio

// Audio5 creation

// @conf: configuration object - all items are optional:
//	ac: audio context - (default: created on play start)
//	sfu: soundfont URL (sf2 base64 encoded - default: "Scc1t2")
//	onend: callback function called at end of playing
//		(no arguments)
//	onnote: callback function called on note start/stop playing
//		Arguments:
//			i: start index of the note in the ABC source
//			on: true on note start, false on note stop
//	errmsg: function called on error (default: alert)
//
//  When playing, the following items must/may be set:
//	gain: (mandatory) volume, must be set to [0..1]
//	speed: (mandatory) must be set to 1
//	new_speed: (optional) new speed value

// Audio5 methods

// get_outputs() - get the output devices
//	return ['sf2'] or null
//
// play() - start playing
// @start_index -
// @stop_index: indexes of the play_event array
// @play_event: array of array
//		[0]: index of the note in the ABC source
//		[1]: time in seconds
//		[2]: MIDI instrument (MIDI GM number - 1)
//		[3]: MIDI note pitch (with cents)
//		[4]: duration
//		[5]: volume (0..1 - optional)
//
// stop() - stop playing
//
// set_vol() - set the current sound volume
// @volume: range [0..1] - undefined = return current value

var abcsf2 = [] // SF2 instruments

function Audio5(i_conf) {
    var conf = i_conf, // configuration
        onend = conf.onend || function() {},
        onnote = conf.onnote || function() {},
        errmsg = conf.errmsg || console.error,
        ac, // audio context
        gain, // global gain

        // instruments/notes
        params = [], // [instr][key] note parameters per instrument
        rates = [], // [instr][key] playback rates
        w_instr = 0, // number of instruments being loaded

        // -- play the memorized events --
        evt_idx, // event index while playing
        iend, // play array stop index
        stime // start playing time

    // base64 stuff
    var b64d = []

    function init_b64d() {
        var b64l = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',
            l = b64l.length
        for (var i = 0; i < l; i++)
            b64d[b64l[i]] = i
        b64d['='] = 0
    }

    function b64dcod(s) {
        var i, t, dl, a,
            l = s.length,
            j = 0

        dl = l * 3 / 4 // destination length
        if (s[l - 1] == '=') {
            if (s[l - 2] == '=')
                dl--;
            dl--;
            l -= 4
        }
        a = new Uint8Array(dl)
        for (i = 0; i < l; i += 4) {
            t = (b64d[s[i]] << 18) +
                (b64d[s[i + 1]] << 12) +
                (b64d[s[i + 2]] << 6) +
                b64d[s[i + 3]];
            a[j++] = (t >> 16) & 0xff;
            a[j++] = (t >> 8) & 0xff;
            a[j++] = t & 0xff
        }
        if (l != s.length) {
            t = (b64d[s[i]] << 18) +
                (b64d[s[i + 1]] << 12) +
                (b64d[s[i + 2]] << 6) +
                b64d[s[i + 3]];
            a[j++] = (t >> 16) & 0xff
            if (j < dl)
                a[j++] = (t >> 8) & 0xff
        }
        return a
    }

    // copy a sf2 sample to an audio buffer
    // @b = audio buffer (array of [-1..1])
    // @s = sf2 sample (PCM 16 bits)
    function sample_cp(b, s) {
        var i, n,
            a = b.getChannelData(0) // destination = array of float32

        for (i = 0; i < s.length; i++)
            a[i] = s[i] / 196608 // volume divided by 6
    }

    // create all notes of an instrument
    function sf2_create(parser, instr) {
        var i, sid, gen, parm, sampleRate, sample,
            infos = parser.getInstruments()[0].info;

        rates[instr] = []
        for (i = 0; i < infos.length; i++) {
            gen = infos[i].generator;
            if (!gen.sampleID) // (empty generator!)
                continue
            sid = gen.sampleID.amount;
            sampleRate = parser.sampleHeader[sid].sampleRate;
            sample = parser.sample[sid];
            parm = {
                attack: Math.pow(2, (gen.attackVolEnv ?
                    gen.attackVolEnv.amount : -12000) / 1200),
                hold: Math.pow(2, (gen.holdVolEnv ?
                    gen.holdVolEnv.amount : -12000) / 1200),
                decay: Math.pow(2, (gen.decayVolEnv ?
                    gen.decayVolEnv.amount : -12000) / 1200) / 3,
                sustain: gen.sustainVolEnv ?
                    (gen.sustainVolEnv.amount / 1000) : 0,
                //				release: Math.pow(2, (gen.releaseVolEnv ?
                //					gen.releaseVolEnv.amount : -12000) / 1200),
                buffer: ac.createBuffer(1,
                    sample.length,
                    sampleRate)
            }
            parm.hold += parm.attack;
            parm.decay += parm.hold;

            // sustain > 40dB is not audible
            if (parm.sustain >= .4)
                parm.sustain = 0.01 // must not be null
            else
                parm.sustain = 1 - parm.sustain / .4

            sample_cp(parm.buffer, sample)

            if (gen.sampleModes && (gen.sampleModes.amount & 1)) {
                parm.loopStart = parser.sampleHeader[sid].startLoop /
                    sampleRate;
                parm.loopEnd = parser.sampleHeader[sid].endLoop /
                    sampleRate
            }

            // define the notes
            var scale = (gen.scaleTuning ?
                    gen.scaleTuning.amount : 100) / 100,
                tune = (gen.coarseTune ? gen.coarseTune.amount : 0) +
                (gen.fineTune ? gen.fineTune.amount : 0) / 100 +
                parser.sampleHeader[sid].pitchCorrection / 100 -
                (gen.overridingRootKey ?
                    gen.overridingRootKey.amount :
                    parser.sampleHeader[sid].originalPitch)

            for (j = gen.keyRange.lo; j <= gen.keyRange.hi; j++) {
                rates[instr][j] = Math.pow(Math.pow(2, 1 / 12),
                    (j + tune) * scale);
                params[instr][j] = parm
            }
        }
    } // sf2_create()

    // load an instrument (.js file)
    function load_instr(instr) {
        w_instr++;

        console.log ('trying to load instrument:', conf.sfu + '/' + instr + '.js');

        abc2svg.loadjs(conf.sfu + '/' + instr + '.js',
            function() {
                var parser = new sf2.Parser(b64dcod(abcsf2[instr]));
                parser.parse();
                sf2_create(parser, instr);
                w_instr--
            },
            function() {
                errmsg('could not find the instrument ' +
                    ((instr / 128) | 0).toString() + '-' +
                    (instr % 128).toString());
                w_instr--
            })
    } // load_instr()

    // start loading the instruments
    function load_res(a_e) {
        var i, e, instr

        for (i = evt_idx;; i++) {
            e = a_e[i]
            if (!e || evt_idx >= iend)
                break
            instr = e[2]
            if (!params[instr]) {
                params[instr] = [];
                load_instr(instr)
            }
        }
    }

    // create a note
    // @e[2] = instrument index
    // @e[3] = MIDI key + detune
    // @t = audio start time
    // @d = duration adjusted for speed
    function note_run(e, t, d) {
        var g, st,
            instr = e[2],
            key = e[3] | 0,
            parm = params[instr][key],
            o = ac.createBufferSource();

        if (!parm) // if the instrument could not be loaded
            return // or if it has not this key
        o.buffer = parm.buffer
        if (parm.loopStart) {
            o.loop = true;
            o.loopStart = parm.loopStart;
            o.loopEnd = parm.loopEnd;
        }
        if (o.detune) {
            var dt = (e[3] * 100) % 100
            if (dt) // if micro-tone
                o.detune.value = dt
        }
        //		o.playbackRate.setValueAtTime(parm.rate, ac.currentTime);
        o.playbackRate.value = rates[instr][key];

        g = ac.createGain();
        if (parm.hold < 0.002) {
            g.gain.setValueAtTime(1, t)
        } else {
            if (parm.attack < 0.002) {
                g.gain.setValueAtTime(1, t)
            } else {
                g.gain.setValueAtTime(0, t);
                g.gain.linearRampToValueAtTime(1, t + parm.attack)
            }
            g.gain.setValueAtTime(1, t + parm.hold)
        }

        g.gain.exponentialRampToValueAtTime(parm.sustain,
            t + parm.decay);

        o.connect(g);
        g.connect(gain);

        // start the note
        o.start(t);
        o.stop(t + d)
    } // note_run()

    // play the next time sequence
    function play_next(a_e) {
        var t, e, e2, maxt, st, d;

        // play the next events
        e = a_e[evt_idx]
        if (!e || evt_idx >= iend) {
            onend()
            return
        }

        // if speed change, shift the start time
        if (conf.new_speed) {
            stime = ac.currentTime -
                (ac.currentTime - stime) *
                conf.speed / conf.new_speed;
            conf.speed = conf.new_speed;
            conf.new_speed = 0
        }

        //fixme: better, count the number of events?
        t = e[1] / conf.speed; // start time
        maxt = t + 3 // max time = evt time + 3 seconds
        while (1) {
            d = e[4] / conf.speed
            if (e[5] != 0) // if not a rest
                note_run(e, t + stime, d)

            // follow the notes while playing
            var i = e[0];
            st = (t + stime - ac.currentTime) * 1000;
            setTimeout(onnote, st, i, true);
            setTimeout(onnote, st + d * 1000, i, false)

            e = a_e[++evt_idx]
            if (!e || evt_idx >= iend) {
                setTimeout(onend,
                    (t + stime - ac.currentTime + d) * 1000)
                return
            }
            t = e[1] / conf.speed
            if (t > maxt)
                break
        }

        // delay before next sound generation
        setTimeout(play_next, (t + stime - ac.currentTime) *
            1000 - 300, // wake before end of playing
            a_e)
    } // play_next()

    // wait for all resources, then start playing
    function play_start(a_e) {
        if (iend == 0) { // play stop
            onend()
            return
        }

        // wait for instruments
        if (w_instr != 0) {
            setTimeout(play_start, 300, a_e)
            return
        }

        // all resources are there
        gain.connect(ac.destination);
        stime = ac.currentTime + .2 // start time + 0.2s
            -
            a_e[evt_idx][1] * conf.speed;
        play_next(a_e)
    } // play_start()

    // Audio5 object creation

    init_b64d(); // initialize base64 decoding

    if (!conf.sfu)
        conf.sfu = "Scc1t2" // set the default soundfont location

    // external methods
    return {

        // get outputs
        get_outputs: function() {
            return (window.AudioContext || window.webkitAudioContext) ? ['sf2'] : null
        }, // get_outputs()

        // play the events
        play: function(istart, i_iend, a_e) {
            if (!a_e || istart >= a_e.length) {
                onend() // nothing to play
                return
            }

            // initialize the audio subsystem if not done yet
            // (needed for iPhone/iPad/...)
            if (!gain) {
                ac = conf.ac
                if (!ac)
                    conf.ac = ac = new(window.AudioContext ||
                        window.webkitAudioContext);
                gain = ac.createGain();
                gain.gain.value = conf.gain
            }

            iend = i_iend;
            evt_idx = istart;
            load_res(a_e);
            play_start(a_e)
        }, // play()

        // stop playing
        stop: function() {
            iend = 0
            if (gain) {
                gain.disconnect();
                gain = null
            }
        }, // stop()

        // set volume
        set_vol: function(v) {
            if (gain)
                gain.gain.value = v
        } // set_vol()
    }
} // end Audio5

/*! JavaScript SoundFont 2 Parser. Copyright 2013-2015 imaya/GREE Inc and Colin Clark. Licensed under the MIT License. */
/*global require*/

(function(root, factory) {
    if (typeof exports === "object") {
        // We're in a CommonJS-style loader.
        root.sf2 = exports;
        factory(exports);
    } else if (typeof define === "function" && define.amd) {
        // We're in an AMD-style loader.
        define(["exports"], function(exports) {
            root.sf2 = exports;
            return (root.sf2, factory(exports));
        });
    } else {
        // Plain old browser.
        root.sf2 = {};
        factory(root.sf2);
    }
}(this, function(exports) {
    "use strict";

    var sf2 = exports;

    sf2.Parser = function(input, options) {
        options = options || {};
        /** @type {ByteArray} */
        this.input = input;
        /** @type {(Object|undefined)} */
        this.parserOptions = options.parserOptions;

        /** @type {Array.<Object>} */
        // this.presetHeader;
        /** @type {Array.<Object>} */
        // this.presetZone;
        /** @type {Array.<Object>} */
        // this.presetZoneModulator;
        /** @type {Array.<Object>} */
        // this.presetZoneGenerator;
        /** @type {Array.<Object>} */
        // this.instrument;
        /** @type {Array.<Object>} */
        // this.instrumentZone;
        /** @type {Array.<Object>} */
        // this.instrumentZoneModulator;
        /** @type {Array.<Object>} */
        // this.instrumentZoneGenerator;
        /** @type {Array.<Object>} */
        //this.sampleHeader;
    };

    sf2.Parser.prototype.parse = function() {
        /** @type {sf2.Riff.Parser} */
        var parser = new sf2.Riff.Parser(this.input, this.parserOptions),
            /** @type {?sf2.Riff.Chunk} */
            chunk;

        // parse RIFF chunk
        parser.parse();
        if (parser.chunkList.length !== 1)
            throw new Error('wrong chunk length');

        chunk = parser.getChunk(0);
        if (chunk === null)
            throw new Error('chunk not found');

        this.parseRiffChunk(chunk);

        // TODO: Presumably this is here to reduce memory,
        // but does it really matter? Shouldn't we always be
        // referencing the underlying ArrayBuffer and thus
        // it will persist, in which case why delete it?
        this.input = null;
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseRiffChunk = function(chunk) {
        /** @type {sf2.Riff.Parser} */
        var parser,
            /** @type {ByteArray} */
            data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {string} */
            signature;

        // check parse target
        if (chunk.type !== 'RIFF')
            throw new Error('invalid chunk type:' + chunk.type);

        // check signature
        signature = String.fromCharCode(data[ip++], data[ip++], data[ip++], data[ip++]);
        if (signature !== 'sfbk')
            throw new Error('invalid signature:' + signature);

        // read structure
        parser = new sf2.Riff.Parser(data, { 'index': ip, 'length': chunk.size - 4 });
        parser.parse();
        if (parser.getNumberOfChunks() !== 3)
            throw new Error('invalid sfbk structure');

        // INFO-list
        this.parseInfoList( /** @type {!sf2.Riff.Chunk} */ parser.getChunk(0));

        // sdta-list
        this.parseSdtaList( /** @type {!sf2.Riff.Chunk} */ parser.getChunk(1));

        // pdta-list
        this.parsePdtaList( /** @type {!sf2.Riff.Chunk} */ parser.getChunk(2));
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseInfoList = function(chunk) {
        /** @type {sf2.Riff.Parser} */
        var parser,
            /** @type {ByteArray} */
            data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {string} */
            signature;

        // check parse target
        if (chunk.type !== 'LIST')
            throw new Error('invalid chunk type:' + chunk.type);

        // check signature
        signature = String.fromCharCode(data[ip++], data[ip++], data[ip++], data[ip++]);
        if (signature !== 'INFO')
            throw new Error('invalid signature:' + signature);

        // read structure
        parser = new sf2.Riff.Parser(data, { 'index': ip, 'length': chunk.size - 4 });
        parser.parse();
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseSdtaList = function(chunk) {
        /** @type {sf2.Riff.Parser} */
        var parser,
            /** @type {ByteArray} */
            data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {string} */
            signature;

        // check parse target
        if (chunk.type !== 'LIST')
            throw new Error('invalid chunk type:' + chunk.type);

        // check signature
        signature = String.fromCharCode(data[ip++], data[ip++], data[ip++], data[ip++]);
        if (signature !== 'sdta')
            throw new Error('invalid signature:' + signature);

        // read structure
        parser = new sf2.Riff.Parser(data, { 'index': ip, 'length': chunk.size - 4 });
        parser.parse();
        if (parser.chunkList.length !== 1)
            throw new Error('TODO');
        this.samplingData =
            /** @type {{type: string, size: number, offset: number}} */
            parser.getChunk(0);
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parsePdtaList = function(chunk) {
        /** @type {sf2.Riff.Parser} */
        var parser,
            /** @type {ByteArray} */
            data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {string} */
            signature;

        // check parse target
        if (chunk.type !== 'LIST')
            throw new Error('invalid chunk type:' + chunk.type);

        // check signature
        signature = String.fromCharCode(data[ip++], data[ip++], data[ip++], data[ip++]);
        if (signature !== 'pdta')
            throw new Error('invalid signature:' + signature);

        // read structure
        parser = new sf2.Riff.Parser(data, { 'index': ip, 'length': chunk.size - 4 });
        parser.parse();

        // check number of chunks
        if (parser.getNumberOfChunks() !== 9)
            throw new Error('invalid pdta chunk');

        this.parsePhdr( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(0)));
        this.parsePbag( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(1)));
        this.parsePmod( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(2)));
        this.parsePgen( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(3)));
        this.parseInst( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(4)));
        this.parseIbag( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(5)));
        this.parseImod( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(6)));
        this.parseIgen( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(7)));
        this.parseShdr( /** @type {sf2.Riff.Chunk} */ (parser.getChunk(8)));
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parsePhdr = function(chunk) {
        /** @type {ByteArray} */
        var data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {Array.<Object>} */
            presetHeader = this.presetHeader = [],
            /** @type {number} */
            size = chunk.offset + chunk.size;

        // check parse target
        if (chunk.type !== 'phdr')
            throw new Error('invalid chunk type:' + chunk.type);

        while (ip < size) {
            presetHeader.push({
                presetName: String.fromCharCode.apply(null, data.subarray(ip, ip += 20)),
                preset: data[ip++] | (data[ip++] << 8),
                bank: data[ip++] | (data[ip++] << 8),
                presetBagIndex: data[ip++] | (data[ip++] << 8),
                library: (data[ip++] | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24)) >>> 0,
                genre: (data[ip++] | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24)) >>> 0,
                morphology: (data[ip++] | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24)) >>> 0
            });
        }
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parsePbag = function(chunk) {
        /** @type {ByteArray} */
        var data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {Array.<Object>} */
            presetZone = this.presetZone = [],
            /** @type {number} */
            size = chunk.offset + chunk.size;

        // check parse target
        if (chunk.type !== 'pbag')
            throw new Error('invalid chunk type:' + chunk.type);

        while (ip < size) {
            presetZone.push({
                presetGeneratorIndex: data[ip++] | (data[ip++] << 8),
                presetModulatorIndex: data[ip++] | (data[ip++] << 8)
            });
        }
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parsePmod = function(chunk) {
        // check parse target
        if (chunk.type !== 'pmod')
            throw new Error('invalid chunk type:' + chunk.type);

        this.presetZoneModulator = this.parseModulator(chunk);
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parsePgen = function(chunk) {
        // check parse target
        if (chunk.type !== 'pgen')
            throw new Error('invalid chunk type:' + chunk.type);
        this.presetZoneGenerator = this.parseGenerator(chunk);
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseInst = function(chunk) {
        /** @type {ByteArray} */
        var data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {Array.<Object>} */
            instrument = this.instrument = [],
            /** @type {number} */
            size = chunk.offset + chunk.size;

        // check parse target
        if (chunk.type !== 'inst')
            throw new Error('invalid chunk type:' + chunk.type);

        while (ip < size) {
            instrument.push({
                instrumentName: String.fromCharCode.apply(null, data.subarray(ip, ip += 20)),
                instrumentBagIndex: data[ip++] | (data[ip++] << 8)
            });
        }
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseIbag = function(chunk) {
        /** @type {ByteArray} */
        var data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {Array.<Object>} */
            instrumentZone = this.instrumentZone = [],
            /** @type {number} */
            size = chunk.offset + chunk.size;

        // check parse target
        if (chunk.type !== 'ibag')
            throw new Error('invalid chunk type:' + chunk.type);

        while (ip < size) {
            instrumentZone.push({
                instrumentGeneratorIndex: data[ip++] | (data[ip++] << 8),
                instrumentModulatorIndex: data[ip++] | (data[ip++] << 8)
            });
        }
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseImod = function(chunk) {
        // check parse target
        if (chunk.type !== 'imod')
            throw new Error('invalid chunk type:' + chunk.type);

        this.instrumentZoneModulator = this.parseModulator(chunk);
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseIgen = function(chunk) {
        // check parse target
        if (chunk.type !== 'igen')
            throw new Error('invalid chunk type:' + chunk.type);

        this.instrumentZoneGenerator = this.parseGenerator(chunk);
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     */
    sf2.Parser.prototype.parseShdr = function(chunk) {
        /** @type {ByteArray} */
        var data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {Array.<Object>} */
            samples = this.sample = [],
            /** @type {Array.<Object>} */
            sampleHeader = this.sampleHeader = [],
            /** @type {number} */
            size = chunk.offset + chunk.size,
            /** @type {string} */
            sampleName,
            /** @type {number} */
            start,
            /** @type {number} */
            end,
            /** @type {number} */
            startLoop,
            /** @type {number} */
            endLoop,
            /** @type {number} */
            sampleRate,
            /** @type {number} */
            originalPitch,
            /** @type {number} */
            pitchCorrection,
            /** @type {number} */
            sampleLink,
            /** @type {number} */
            sampleType;

        // check parse target
        if (chunk.type !== 'shdr')
            throw new Error('invalid chunk type:' + chunk.type);

        while (ip < size) {
            sampleName = String.fromCharCode.apply(null, data.subarray(ip, ip += 20));
            start =
                (data[ip++] << 0) | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24);
            end =
                (data[ip++] << 0) | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24);
            startLoop =
                (data[ip++] << 0) | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24);
            endLoop =
                (data[ip++] << 0) | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24);
            sampleRate =
                (data[ip++] << 0) | (data[ip++] << 8) | (data[ip++] << 16) | (data[ip++] << 24);
            originalPitch = data[ip++];
            pitchCorrection = (data[ip++] << 24) >> 24;
            sampleLink = data[ip++] | (data[ip++] << 8);
            sampleType = data[ip++] | (data[ip++] << 8);

            var sample = new Int16Array(new Uint8Array(data.subarray(
                this.samplingData.offset + start * 2,
                this.samplingData.offset + end * 2
            )).buffer);

            startLoop -= start;
            endLoop -= start;

            if (sampleRate > 0) {
                var adjust = this.adjustSampleData(sample, sampleRate);
                sample = adjust.sample;
                sampleRate *= adjust.multiply;
                startLoop *= adjust.multiply;
                endLoop *= adjust.multiply;
            }

            samples.push(sample);

            sampleHeader.push({
                sampleName: sampleName,
                /*
                start: start,
                end: end,
                */
                startLoop: startLoop,
                endLoop: endLoop,
                sampleRate: sampleRate,
                originalPitch: originalPitch,
                pitchCorrection: pitchCorrection,
                sampleLink: sampleLink,
                sampleType: sampleType
            });
        }
    };

    // TODO: This function is questionable;
    // it doesn't interpolate the sample data
    // and always forces a sample rate of 22050 or higher. Why?
    sf2.Parser.prototype.adjustSampleData = function(sample, sampleRate) {
        /** @type {Int16Array} */
        var newSample,
            /** @type {number} */
            i,
            /** @type {number} */
            il,
            /** @type {number} */
            j,
            /** @type {number} */
            multiply = 1;

        // buffer
        while (sampleRate < 22050) {
            newSample = new Int16Array(sample.length * 2);
            for (i = j = 0, il = sample.length; i < il; ++i) {
                newSample[j++] = sample[i];
                newSample[j++] = sample[i];
            }
            sample = newSample;
            multiply *= 2;
            sampleRate *= 2;
        }

        return {
            sample: sample,
            multiply: multiply
        };
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     * @return {Array.<Object>}
     */
    sf2.Parser.prototype.parseModulator = function(chunk) {
        /** @type {ByteArray} */
        var data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {number} */
            size = chunk.offset + chunk.size,
            /** @type {number} */
            code,
            /** @type {string} */
            key,
            /** @type {Array.<Object>} */
            output = [];

        while (ip < size) {
            // Src  Oper
            // TODO
            ip += 2;

            // Dest Oper
            code = data[ip++] | (data[ip++] << 8);
            key = sf2.Parser.GeneratorEnumeratorTable[code];
            if (key === undefined) {
                // Amount
                output.push({
                    type: key,
                    value: {
                        code: code,
                        amount: data[ip] | (data[ip + 1] << 8) << 16 >> 16,
                        lo: data[ip++],
                        hi: data[ip++]
                    }
                });
            } else {
                // Amount
                switch (key) {
                    case 'keyRange':
                        /* FALLTHROUGH */
                    case 'velRange':
                        /* FALLTHROUGH */
                    case 'keynum':
                        /* FALLTHROUGH */
                    case 'velocity':
                        output.push({
                            type: key,
                            value: {
                                lo: data[ip++],
                                hi: data[ip++]
                            }
                        });
                        break;
                    default:
                        output.push({
                            type: key,
                            value: {
                                amount: data[ip++] | (data[ip++] << 8) << 16 >> 16
                            }
                        });
                        break;
                }
            }

            // AmtSrcOper
            // TODO
            ip += 2;

            // Trans Oper
            // TODO
            ip += 2;
        }

        return output;
    };

    /**
     * @param {sf2.Riff.Chunk} chunk
     * @return {Array.<Object>}
     */
    sf2.Parser.prototype.parseGenerator = function(chunk) {
        /** @type {ByteArray} */
        var data = this.input,
            /** @type {number} */
            ip = chunk.offset,
            /** @type {number} */
            size = chunk.offset + chunk.size,
            /** @type {number} */
            code,
            /** @type {string} */
            key,
            /** @type {Array.<Object>} */
            output = [];

        while (ip < size) {
            code = data[ip++] | (data[ip++] << 8);
            key = sf2.Parser.GeneratorEnumeratorTable[code];
            if (key === undefined) {
                output.push({
                    type: key,
                    value: {
                        code: code,
                        amount: data[ip] | (data[ip + 1] << 8) << 16 >> 16,
                        lo: data[ip++],
                        hi: data[ip++]
                    }
                });
                continue;
            }

            switch (key) {
                case 'keynum':
                    /* FALLTHROUGH */
                case 'keyRange':
                    /* FALLTHROUGH */
                case 'velRange':
                    /* FALLTHROUGH */
                case 'velocity':
                    output.push({
                        type: key,
                        value: {
                            lo: data[ip++],
                            hi: data[ip++]
                        }
                    });
                    break;
                default:
                    output.push({
                        type: key,
                        value: {
                            amount: data[ip++] | (data[ip++] << 8) << 16 >> 16
                        }
                    });
                    break;
            }
        }

        return output;
    };

    sf2.Parser.prototype.getInstruments = function() {
        /** @type {Array.<Object>} */
        var instrument = this.instrument,
            /** @type {Array.<Object>} */
            zone = this.instrumentZone,
            /** @type {Array.<Object>} */
            output = [],
            /** @type {number} */
            bagIndex,
            /** @type {number} */
            bagIndexEnd,
            /** @type {Array.<Object>} */
            zoneInfo,
            /** @type {{generator: Object, generatorInfo: Array.<Object>}} */
            instrumentGenerator,
            /** @type {{modulator: Object, modulatorInfo: Array.<Object>}} */
            instrumentModulator,
            /** @type {number} */
            i,
            /** @type {number} */
            il,
            /** @type {number} */
            j,
            /** @type {number} */
            jl;

        // instrument -> instrument bag -> generator / modulator
        for (i = 0, il = instrument.length; i < il; ++i) {
            bagIndex = instrument[i].instrumentBagIndex;
            bagIndexEnd = instrument[i + 1] ? instrument[i + 1].instrumentBagIndex : zone.length;
            zoneInfo = [];

            // instrument bag
            for (j = bagIndex, jl = bagIndexEnd; j < jl; ++j) {
                instrumentGenerator = this.createInstrumentGenerator_(zone, j);
                instrumentModulator = this.createInstrumentModulator_(zone, j);

                zoneInfo.push({
                    generator: instrumentGenerator.generator,
                    modulator: instrumentModulator.modulator,
                });
            }

            output.push({
                name: instrument[i].instrumentName,
                info: zoneInfo
            });
        }

        return output;
    };

    /**
     * @param {Array.<Object>} zone
     * @param {number} index
     * @returns {{generator: Object, generatorInfo: Array.<Object>}}
     * @private
     */
    sf2.Parser.prototype.createInstrumentGenerator_ = function(zone, index) {
        var modgen = this.createBagModGen_(
            zone,
            zone[index].instrumentGeneratorIndex,
            zone[index + 1] ? zone[index + 1].instrumentGeneratorIndex : this.instrumentZoneGenerator.length,
            this.instrumentZoneGenerator
        );

        return {
            generator: modgen.modgen,
        };
    };

    /**
     * @param {Array.<Object>} zone
     * @param {number} index
     * @returns {{modulator: Object, modulatorInfo: Array.<Object>}}
     * @private
     */
    sf2.Parser.prototype.createInstrumentModulator_ = function(zone, index) {
        var modgen = this.createBagModGen_(
            zone,
            zone[index].presetModulatorIndex,
            zone[index + 1] ? zone[index + 1].instrumentModulatorIndex : this.instrumentZoneModulator.length,
            this.instrumentZoneModulator
        );

        return {
            modulator: modgen.modgen
        };
    };

    /**
     * @param {Array.<Object>} zone
     * @param {number} indexStart
     * @param {number} indexEnd
     * @param zoneModGen
     * @returns {{modgen: Object, modgenInfo: Array.<Object>}}
     * @private
     */
    sf2.Parser.prototype.createBagModGen_ = function(zone, indexStart, indexEnd, zoneModGen) {
        /** @type {Object} */
        var modgen = {
            unknown: [],
            'keyRange': {
                hi: 127,
                lo: 0
            }
        }; // TODO
        /** @type {Object} */
        var info,
            /** @type {number} */
            i,
            /** @type {number} */
            il;

        for (i = indexStart, il = indexEnd; i < il; ++i) {
            info = zoneModGen[i];

            if (info.type === 'unknown')
                modgen.unknown.push(info.value);
            else
                modgen[info.type] = info.value;
        }

        return {
            modgen: modgen
        };
    };

    /**
     * @type {Array.<string>}
     * @const
     */
    sf2.Parser.GeneratorEnumeratorTable = [
        'startAddrsOffset',
        'endAddrsOffset',
        'startloopAddrsOffset',
        'endloopAddrsOffset',
        'startAddrsCoarseOffset',
        'modLfoToPitch',
        'vibLfoToPitch',
        'modEnvToPitch',
        'initialFilterFc',
        'initialFilterQ',
        'modLfoToFilterFc',
        'modEnvToFilterFc',
        'endAddrsCoarseOffset',
        'modLfoToVolume',
        undefined, // 14
        'chorusEffectsSend',
        'reverbEffectsSend',
        'pan',
        undefined,
        undefined,
        undefined, // 18,19,20
        'delayModLFO',
        'freqModLFO',
        'delayVibLFO',
        'freqVibLFO',
        'delayModEnv',
        'attackModEnv',
        'holdModEnv',
        'decayModEnv',
        'sustainModEnv',
        'releaseModEnv',
        'keynumToModEnvHold',
        'keynumToModEnvDecay',
        'delayVolEnv',
        'attackVolEnv',
        'holdVolEnv',
        'decayVolEnv',
        'sustainVolEnv',
        'releaseVolEnv',
        'keynumToVolEnvHold',
        'keynumToVolEnvDecay',
        'instrument',
        undefined, // 42
        'keyRange',
        'velRange',
        'startloopAddrsCoarseOffset',
        'keynum',
        'velocity',
        'initialAttenuation',
        undefined, // 49
        'endloopAddrsCoarseOffset',
        'coarseTune',
        'fineTune',
        'sampleID',
        'sampleModes',
        undefined, // 55
        'scaleTuning',
        'exclusiveClass',
        'overridingRootKey'
    ];

    sf2.Riff = {};

    sf2.Riff.Parser = function(input, options) {
        options = options || {};
        /** @type {ByteArray} */
        this.input = input;
        /** @type {number} */
        this.ip = options.index || 0;
        /** @type {number} */
        this.length = options.length || input.length - this.ip;
        /** @type {Array.<sf2.Riff.Chunk>} */
        //   this.chunkList;
        /** @type {number} */
        this.offset = this.ip;
        /** @type {boolean} */
        this.padding = options.padding !== undefined ? options.padding : true;
        /** @type {boolean} */
        this.bigEndian = options.bigEndian !== undefined ? options.bigEndian : false;
    };

    /**
     * @param {string} type
     * @param {number} size
     * @param {number} offset
     * @constructor
     */
    sf2.Riff.Chunk = function(type, size, offset) {
        /** @type {string} */
        this.type = type;
        /** @type {number} */
        this.size = size;
        /** @type {number} */
        this.offset = offset;
    };

    sf2.Riff.Parser.prototype.parse = function() {
        /** @type {number} */
        var length = this.length + this.offset;

        this.chunkList = [];

        while (this.ip < length)
            this.parseChunk();
    };

    sf2.Riff.Parser.prototype.parseChunk = function() {
        /** @type {ByteArray} */
        var input = this.input,
            /** @type {number} */
            ip = this.ip,
            /** @type {number} */
            size;

        this.chunkList.push(new sf2.Riff.Chunk(
            String.fromCharCode(input[ip++], input[ip++], input[ip++], input[ip++]),
            (size = this.bigEndian ?
                ((input[ip++] << 24) | (input[ip++] << 16) |
                    (input[ip++] << 8) | (input[ip++])) :
                ((input[ip++]) | (input[ip++] << 8) |
                    (input[ip++] << 16) | (input[ip++] << 24))
            ),
            ip
        ));

        ip += size;

        // padding
        if ((this.padding && (ip - this.offset) & 1) === 1)
            ip++;

        this.ip = ip;
    };

    /**
     * @param {number} index chunk index.
     * @return {?sf2.Riff.Chunk}
     */
    sf2.Riff.Parser.prototype.getChunk = function(index) {
        /** @type {sf2.Riff.Chunk} */
        var chunk = this.chunkList[index];

        if (chunk === undefined)
            return null;

        return chunk;
    };

    /**
     * @return {number}
     */
    sf2.Riff.Parser.prototype.getNumberOfChunks = function() {
        return this.chunkList.length;
    };

    return sf2;
}));

// tomidi5.js - audio output using HTML5 MIDI
// Midi5 creation

// @conf: configuration object - all items are optional:
//	onend: callback function called at end of playing
//		(no arguments)
//	onnote: callback function called on note start/stop playing
//		Arguments:
//			i: start index of the note in the ABC source
//			on: true on note start, false on note stop

//  When playing, the following items must/may be set:
//	speed: (mandatory) must be set to 1
//	new_speed: (optional) new speed value

// Midi5 methods

// get_outputs() - get the output ports
//
// set_output() - set the output port
//
// play() - start playing
// @start_index -
// @stop_index: indexes of the play_event array
// @play_event: array of array
//		[0]: index of the note in the ABC source
//		[1]: time in seconds
//		[2]: MIDI instrument (MIDI GM number - 1)
//		[3]: MIDI note pitch (with cents)
//		[4]: duration
//		[5]: volume (0..1 - optional)
//		[6]: voice number
//
// stop() - stop playing

function Midi5(i_conf) {
    var conf = i_conf, // configuration
        onend = conf.onend || function() {},
        onnote = conf.onnote || function() {},

        // MIDI variables
        op, // output port
        v_i = [], // voice (channel) to instrument

        // -- play the memorized events --
        evt_idx, // event index while playing
        iend, // play array stop index
        stime // start playing time in ms

    // create a note
    // @e[2] = instrument index
    // @e[3] = MIDI key + detune
    // @e[6] = voice (channel) number
    // @t = audio start time (ms)
    // @d = duration adjusted for speed (ms)
    function note_run(e, t, d) {
        var k = e[3] | 0,
            i = e[2],
            c = e[6] & 0x0f, //fixme
            d = (e[3] * 100) % 100

        if (i != v_i[c]) { // if program change
            v_i[c] = i
            op.send(new Uint8Array([
                0xb0 + c, 0, (i >> 14) & 0x7f, // MSB bank
                0xb0 + c, 32, (i >> 7) & 0x7f, // LSB bank
                0xc0 + c, i & 0x7f // program
            ]))
        }
        if (d && Midi5.ma.sysexEnabled) { // if microtone
            // fixme: should cache the current microtone values
            op.send(new Uint8Array([
                0xf0, 0x7f, // realtime SysEx
                0x7f, // all devices
                0x08, // MIDI tuning standard
                0x02, // note change
                i & 0x7f, // tuning prog number
                0x01, // number of notes
                k, // key
                k, // note
                d / .78125, // MSB fract
                0, // LSB fract
                0xf7 // SysEx end
            ]), t);
        }
        op.send(new Uint8Array([0x90 + c, k, 127]), t); // note on
        op.send(new Uint8Array([0x80 + c, k, 0x40]), t + d - 20) // note off
    } // note_run()

    // play the next time sequence
    function play_next(a_e) {
        var t, e, e2, maxt, st, d

        // play the next events
        e = a_e[evt_idx]
        if (!op || evt_idx >= iend || !e) {
            onend()
            return
        }

        // if speed change, shift the start time
        if (conf.new_speed) {
            stime = window - performance.now() -
                (window.performance.now() - stime) *
                conf.speed / conf.new_speed;
            conf.speed = conf.new_speed;
            conf.new_speed = 0
        }

        t = e[1] / conf.speed * 1000; // start time
        maxt = t + 3000 // max time = evt time + 3 seconds
        while (1) {
            d = e[4] / conf.speed * 1000
            if (e[5] != 0) // if not a rest
                note_run(e, t + stime, d)

            // follow the notes while playing
            st = t + stime - window.performance.now();
            setTimeout(onnote, st, e[0], true);
            setTimeout(onnote, st + d, e[0], false)

            e = a_e[++evt_idx]
            if (!e || evt_idx >= iend) {
                setTimeout(onend,
                    t + stime - window.performance.now() + d)
                return
            }
            t = e[1] / conf.speed * 1000
            if (t > maxt)
                break
        }

        // delay before next sound generation
        setTimeout(play_next, (t + stime - window.performance.now()) -
            300, // wake before end of playing
            a_e)
    } // play_next()

    // Midi5 object creation (only one instance)

    // public methods
    return {

        // get outputs
        get_outputs: function() {
            //fixme: just the first output port for now...
            if (Midi5.ma)
                op = Midi5.ma.outputs.values().next().value
            if (op)
                return [op.name]
        }, // get_outputs()

        // set the output port
        set_output: function(name) {
            //fixme: todo
            //		if (!Midi5.ma)
            //			return
        },

        // play the events
        play: function(istart, i_iend, a_e) {
            if (!a_e || istart >= a_e.length) {
                onend() // nothing to play
                return
            }
            iend = i_iend;
            evt_idx = istart;
            if (0) {
                // temperament
                op.send(new Uint8Array([
                    0xf0, 0x7f, // realtime SysEx
                    0x7f, // all devices
                    0x08, // MIDI tuning standard
                    0x02, // note change
                    0x00, // tuning prog number
                    0x01, // number of notes
                    0x69, // key
                    0x69, // note
                    0x00, // MSB fract
                    0, // LSB fract
                    0xf7 // SysEx end
                ]), t);
            }

            stime = window.performance.now() + 200 // start time + 0.2s
                -
                a_e[evt_idx][1] * conf.speed * 1000;
            play_next(a_e)
        }, // play()

        // stop playing
        stop: function() {
            iend = 0
            //fixme: op.clear() should exist...
            if (op && op.clear)
                op.clear()
        } // stop()
    }
} // end Midi5

// check MIDI access at script load time
function onMIDISuccess(access) {
    Midi5.ma = access // store the MIDI access in the Midi5 function
} // onMIDISuccess()

// (no SysEx)
function onMIDIFailure1(msg) {
    //navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure2)
} // onMIDIFailure1()

// (no MIDI access)
function onMIDIFailure2(msg) {} // onMIDIFailure2()

// (try SysEx)
//if (navigator.requestMIDIAccess)
//	navigator.requestMIDIAccess({sysex: true}).then(onMIDISuccess, onMIDIFailure1)