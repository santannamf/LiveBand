1/***** =========================================================
 *  LIVE BAND APP — SONG CATALOGUE (FULL SCRIPT + FUZZY MANUAL GENRES)
 *  ========================================================= */

/***** =========================
 *  CONFIG — EDIT THESE
 *  ========================= */
const FOLDER_ID = '16LIsqE7fvzYuJnPh7praX-lE4M8FZIOc';   // e.g., 16LIsqE7fvzYuJnPh7praX-lE4M8FZIOc
const CONTACT_EMAIL = 'santannamf@gmail.com';         // Used in MusicBrainz User-Agent

// Filenames
const CSV_NAME  = 'song_table.csv';              // Header: Title,Artist,Voice,Origin
const BASE_JSON = 'song_full_list.json';         // Final versioned catalogue base name
const WIP_JSON  = 'song_full_list_wip.json';     // Working file during enrichment

// Batch / rate limits
const BATCH_SIZE    = 30;        // Songs per enrichBatch() run
const MB_MIN_SCORE  = 70;        // Min MusicBrainz score
const MB_SLEEP_MS   = 1100;      // ~1 req/sec

// Fallback sources (enable/disable)
const USE_WIKIPEDIA = true;
const USE_ITUNES    = true;
const ITUNES_COUNTRY = 'BR';     // Try BR, fallback to US automatically
const USE_DEEZER    = true;

// Script property keys
const PROP_CURSOR = 'ENRICH_CURSOR';

/***** =========================
 *  STEP 1 — Build/refresh WIP (no network)
 *  ========================= */
function buildBaseCatalogue() {
  const folder = resolveFolder_();
  const csvMap = loadCsvMap_(folder);
  const existing = loadLatestCatalogue_(folder);
  const existingMap = indexByKey_(existing);

  const out = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const fname = f.getName();
    if (!/\.ppsx$/i.test(fname)) continue;

    const base = fname.replace(/\.ppsx$/i, '');
    const dashIdx = base.lastIndexOf('-');
    if (dashIdx <= 0) { log_({level:'warn', msg:'skip_no_dash', filename: fname}); continue; }

    const rawTitle  = base.slice(0, dashIdx);
    const rawArtist = base.slice(dashIdx + 1);

    const titleSentence = sentenceCaseTitle_(rawTitle.replace(/_/g,' ').replace(/\s+/g,' ').trim());
    const artistPretty  = smartTitleCasePtBr_(rawArtist.replace(/_/g,' ').replace(/\s+/g,' ').trim());

    const key  = makeKeyGeneric_(titleSentence, artistPretty);
    const prev = existingMap[key] ? existingMap[key] : {};
    const csvOv = csvMap[key] ? csvMap[key] : {};

    out.push({
      id: makeId_(titleSentence + '-' + artistPretty),
      filename: prev.filename ? prev.filename : fname,
      driveUrl: prev.driveUrl ? prev.driveUrl : f.getUrl(),
      title: titleSentence,
      artist: artistPretty,
      year: prev.year ? prev.year : '',
      tags: {
        genre: prev && prev.tags && prev.tags.genre && prev.tags.genre.length ? dedupeLower_(prev.tags.genre) : [],
        epoch: prev && prev.tags && prev.tags.epoch && prev.tags.epoch.length ? dedupeLower_(prev.tags.epoch) : [],
        origin: csvOv.origin ? csvOv.origin : (prev && prev.tags && prev.tags.origin ? prev.tags.origin : 'international'),
        voice:  csvOv.voice  ? csvOv.voice  : (prev && prev.tags && prev.tags.voice  ? prev.tags.voice  : 'male')
      },
      mbid: prev.mbid ? prev.mbid : '',
      mbCanonicalTitle: prev.mbCanonicalTitle ? prev.mbCanonicalTitle : '',
      mbCanonicalArtist: prev.mbCanonicalArtist ? prev.mbCanonicalArtist : '',
      wikiUrl: prev.wikiUrl ? prev.wikiUrl : '',
      source: prev.source ? prev.source : 'manual'
    });
  }

  overwritePlainFile_(folder, WIP_JSON, JSON.stringify(out, null, 2));
  PropertiesService.getScriptProperties().setProperty(PROP_CURSOR, '0');
  log_({level:'info', msg:'wip_built', count: out.length});
  Logger.log('WIP built with %s songs.', out.length);
}

/***** =========================
 *  STEP 2 — Enrich a batch (MB → Wiki/iTunes/Deezer)
 *  ========================= */
function enrichBatch() {
  const folder = resolveFolder_();
  const wip = loadWip_(folder);
  if (!wip.length) { Logger.log('WIP empty. Run buildBaseCatalogue() first.'); return; }

  const props = PropertiesService.getScriptProperties();
  let start = parseInt(props.getProperty(PROP_CURSOR) || '0', 10);
  if (isNaN(start)) start = 0;
  start = Math.max(0, Math.min(start, wip.length));
  const end = Math.min(start + BATCH_SIZE, wip.length);

  if (start >= wip.length) {
    Logger.log('All items processed. Run finalizeCatalogue().');
    safeStopEnrichmentTrigger_();
    return;
  }

  for (var i = start; i < end; i++) {
    var s = wip[i];
    var hasGenres = s && s.tags && s.tags.genre && s.tags.genre.length > 0;
    if (hasGenres) continue;

    var enr = enrichSong_(s.title, s.artist, s);
    if (enr) {
      if (enr.mbid) s.mbid = enr.mbid;
      if (enr.mbTitle)  s.mbCanonicalTitle  = enr.mbTitle;
      if (enr.mbArtist) s.mbCanonicalArtist = enr.mbArtist;

      var yr = enr.year ? enr.year : (s.year ? s.year : '');
      s.year = yr;
      if (yr) {
        var ep = deriveEpoch_(yr);
        if (ep && (!s.tags.epoch || s.tags.epoch.indexOf(ep) === -1)) {
          if (!s.tags.epoch) s.tags.epoch = [];
          s.tags.epoch.push(ep);
        }
      }

      if (enr.genres && enr.genres.length) {
        var current = (s.tags && s.tags.genre) ? s.tags.genre : [];
        s.tags.genre = dedupeLower_(current.concat(enr.genres));
      }

      if (enr.wikiUrl && !s.wikiUrl) s.wikiUrl = enr.wikiUrl;
      s.source = enr.source ? enr.source : s.source;
    }
  }

  overwritePlainFile_(folder, WIP_JSON, JSON.stringify(wip, null, 2));
  PropertiesService.getScriptProperties().setProperty(PROP_CURSOR, String(end));

  Logger.log('Enriched batch: %s–%s of %s. Next start = %s', start+1, end, wip.length, end);
  if (end >= wip.length) {
    Logger.log('All items processed. Run finalizeCatalogue().');
    safeStopEnrichmentTrigger_();
  }
}

/***** =========================
 *  STEP 3 — Finalize (versioned)
 *  ========================= */
function finalizeCatalogue() {
  const folder = resolveFolder_();
  const wip = loadWip_(folder);
  if (!wip.length) throw new Error('No WIP found. Run buildBaseCatalogue() first.');
  const newName = nextVersionedName_(folder, BASE_JSON);
  overwritePlainFile_(folder, newName, JSON.stringify(wip, null, 2));
  Logger.log('Finalized to %s (%s songs).', newName, wip.length);
}

/***** OPTIONAL — CSV review of current WIP *****/
function exportWipReviewCsv() {
  const folder = resolveFolder_();
  const wip = loadWip_(folder);
  const rows = [["Title","Artist","Voice","Origin","Year","Genres","Epoch","MBID","WikiUrl"]];
  for (var i = 0; i < wip.length; i++) {
    var it = wip[i];
    rows.push([
      it.title || "",
      it.artist || "",
      it.tags && it.tags.voice ? it.tags.voice : "",
      it.tags && it.tags.origin ? it.tags.origin : "",
      it.year || "",
      (it.tags && it.tags.genre ? it.tags.genre : []).join(';'),
      (it.tags && it.tags.epoch ? it.tags.epoch : []).join(';'),
      it.mbid || "",
      it.wikiUrl || ""
    ]);
  }
  const csv = toCsv_(rows);
  overwritePlainFile_(folder, 'song_catalogue_wip_review.csv', csv);
  Logger.log('Exported WIP review CSV.');
}

/***** OPTIONAL — Reset cursor *****/
function resetEnrichmentProgress() {
  PropertiesService.getScriptProperties().setProperty(PROP_CURSOR, '0');
  Logger.log('Cursor reset to 0.');
}

/***** =========================
 *  ENRICHMENT CORE
 *  ========================= */
function enrichSong_(titleSentence, artistPretty, existing) {
  try {
    var genres = [];
    var year = '';
    var mbid = (existing && existing.mbid) ? existing.mbid : '';
    var mbTitle = '';
    var mbArtist = '';
    var wikiUrl = '';
    var source = 'manual';

    // 1) MUSICBRAINZ
    if (mbid) {
      var det = mbRecordingDetails_(mbid);
      if (det) {
        var bundle = foldMbDetails_(det);
        genres = dedupeLower_(genres.concat(bundle.genres || []));
        year   = year || bundle.year || '';
        mbTitle  = det.title || mbTitle;
        mbArtist = firstArtistName_(det) || mbArtist;

        if (!genres.length) {
          var rgid = rgIdFromRecording_(det);
          if (rgid) {
            var rg = mbReleaseGroupDetails_(rgid);
            var more = foldMbRG_(rg);
            genres = dedupeLower_(genres.concat(more.genres || []));
            year   = year || more.year || '';
          }
        }
        if (!genres.length) {
          var aid = firstArtistId_(det);
          if (aid) {
            var art = mbArtistDetails_(aid);
            var ag = foldMbArtist_(art);
            genres = dedupeLower_(genres.concat(ag.genres || []));
          }
        }
        if (genres.length || year) source = 'musicbrainz';
      }
    } else {
      var mbBest = mbLookupBest_(titleSentence, artistPretty);
      if (mbBest) {
        mbid     = mbBest.id || mbid;
        year     = year || (mbBest['first-release-date'] ? String(mbBest['first-release-date']).slice(0,4) : '');
        mbTitle  = mbBest.title || mbTitle;
        mbArtist = (mbBest['artist-credit'] && mbBest['artist-credit'][0] && mbBest['artist-credit'][0].name) ? mbBest['artist-credit'][0].name : mbArtist;

        var det2 = mbRecordingDetails_(mbid);
        if (det2) {
          var bundle2 = foldMbDetails_(det2);
          genres = dedupeLower_(genres.concat(bundle2.genres || []));
          year   = year || bundle2.year || '';

          if (!genres.length) {
            var rgid2 = rgIdFromRecording_(det2);
            if (rgid2) {
              var rg2 = mbReleaseGroupDetails_(rgid2);
              var more2 = foldMbRG_(rg2);
              genres = dedupeLower_(genres.concat(more2.genres || []));
              year   = year || more2.year || '';
            }
          }
          if (!genres.length) {
            var aid2 = firstArtistId_(det2);
            if (aid2) {
              var art2 = mbArtistDetails_(aid2);
              var ag2 = foldMbArtist_(art2);
              genres = dedupeLower_(genres.concat(ag2.genres || []));
            }
          }
        }
        if (genres.length || year) source = 'musicbrainz';
      }
    }

    // 2) iTUNES
    if (USE_ITUNES && !genres.length) {
      var it = itunesLookupGenre_(titleSentence, artistPretty);
      if (it && it.genres && it.genres.length) {
        genres = dedupeLower_(genres.concat(it.genres));
        source = (source === 'manual') ? 'itunes' : (source + '+itunes');
      }
    }

    // 3) DEEZER
    if (USE_DEEZER && !genres.length) {
      var dz = deezerLookupGenre_(titleSentence, artistPretty);
      if (dz && dz.genres && dz.genres.length) {
        genres = dedupeLower_(genres.concat(dz.genres));
        source = (source === 'manual') ? 'deezer' : (source + '+deezer');
      }
    }

    // 4) WIKIPEDIA (year/url only)
    if (USE_WIKIPEDIA) {
      var wiki = wikiLookup_(titleSentence, artistPretty);
      if (wiki) {
        wikiUrl = wikiUrl || wiki.url || '';
        year = year || wiki.year || '';
        if (wikiUrl) source = (source === 'manual') ? 'wikipedia' : (source + '+wikipedia');
      }
    }

    var normalized = normalizeGenreList_(genres);
    if (normalized.length || year || mbid || wikiUrl) {
      return {
        source: source,
        mbid: mbid || '',
        mbTitle: mbTitle || '',
        mbArtist: mbArtist || '',
        genres: normalized,
        year: year,
        wikiUrl: wikiUrl
      };
    }
    return null;
  } catch (e) {
    log_({ level:'error', msg:'enrich_error', title:titleSentence, artist:artistPretty, err:String(e) });
    return null;
  }
}

/***** =========================
 *  MUSICBRAINZ — SEARCH + DETAILS
 *  ========================= */
function mbLookupBest_(titleSentence, artistPretty) {
  var queries = [
    'artist:"' + artistPretty + '" AND recording:"' + titleSentence + '"',
    'artist:"' + artistPretty + '" AND recording:"' + titleSentence.replace(/\s+/g,'') + '"',
    'artist:"' + artistPretty + '" AND "' + titleSentence.split(/\s+/).join('" AND ') + '"'
  ];
  for (var i = 0; i < queries.length; i++) {
    var res = mbSearchRecording_(queries[i]);
    Utilities.sleep(MB_SLEEP_MS);
    if (res && res.recordings && res.recordings.length) {
      var best = res.recordings.slice().sort(function(a,b){ return Number(b.score||0)-Number(a.score||0); })[0];
      if (Number(best.score||0) >= MB_MIN_SCORE) return best;
    }
  }
  return null;
}
function mbSearchRecording_(luceneQuery) {
  var url = 'https://musicbrainz.org/ws/2/recording/?fmt=json&query=' + encodeURIComponent(luceneQuery);
  var options = { method:'get', muteHttpExceptions:true, headers:{ 'User-Agent': 'LiveBandApp/1.0 (' + CONTACT_EMAIL + ')' } };
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) return JSON.parse(resp.getContentText());
  log_({level:'error', msg:'mb_http_search', code:code, body: resp.getContentText().slice(0,300)});
  return null;
}
function mbRecordingDetails_(mbid) {
  var inc = 'genres+tags+releases+artist-credits+artists';
  var url = 'https://musicbrainz.org/ws/2/recording/' + encodeURIComponent(mbid) + '?fmt=json&inc=' + inc;
  var options = { method:'get', muteHttpExceptions:true, headers:{ 'User-Agent': 'LiveBandApp/1.0 (' + CONTACT_EMAIL + ')' } };
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  Utilities.sleep(MB_SLEEP_MS);
  if (code >= 200 && code < 300) return JSON.parse(resp.getContentText());
  log_({level:'error', msg:'mb_http_rec_detail', code:code, body: resp.getContentText().slice(0,300)});
  return null;
}
function mbReleaseGroupDetails_(rgid) {
  var inc = 'genres+tags';
  var url = 'https://musicbrainz.org/ws/2/release-group/' + encodeURIComponent(rgid) + '?fmt=json&inc=' + inc;
  var options = { method:'get', muteHttpExceptions:true, headers:{ 'User-Agent': 'LiveBandApp/1.0 (' + CONTACT_EMAIL + ')' } };
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  Utilities.sleep(MB_SLEEP_MS);
  if (code >= 200 && code < 300) return JSON.parse(resp.getContentText());
  log_({level:'error', msg:'mb_http_rg_detail', code:code, body: resp.getContentText().slice(0,300)});
  return null;
}
function mbArtistDetails_(artistId) {
  var inc = 'genres+tags';
  var url = 'https://musicbrainz.org/ws/2/artist/' + encodeURIComponent(artistId) + '?fmt=json&inc=' + inc;
  var options = { method:'get', muteHttpExceptions:true, headers:{ 'User-Agent': 'LiveBandApp/1.0 (' + CONTACT_EMAIL + ')' } };
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  Utilities.sleep(MB_SLEEP_MS);
  if (code >= 200 && code < 300) return JSON.parse(resp.getContentText());
  log_({level:'error', msg:'mb_http_artist_detail', code:code, body: resp.getContentText().slice(0,300)});
  return null;
}

/***** MUSICBRAINZ — FOLD HELPERS *****/
function foldMbDetails_(rec) {
  var genres = mergeGenresAndTags_(rec && rec.genres ? rec.genres : [], rec && rec.tags ? rec.tags : []);
  var year = rec && rec['first-release-date'] ? String(rec['first-release-date']).slice(0,4) : '';
  return { genres: genres, year: year };
}
function foldMbRG_(rg) {
  var genres = mergeGenresAndTags_(rg && rg.genres ? rg.genres : [], rg && rg.tags ? rg.tags : []);
  var year = rg && rg['first-release-date'] ? String(rg['first-release-date']).slice(0,4) : '';
  return { genres: genres, year: year };
}
function foldMbArtist_(art) {
  var genres = mergeGenresAndTags_(art && art.genres ? art.genres : [], art && art.tags ? art.tags : []);
  return { genres: genres };
}
function mergeGenresAndTags_(genresObj, tagsObj) {
  var g1 = (genresObj || []).map(function(g){ return String(g && g.name ? g.name : '').toLowerCase(); }).filter(Boolean);
  var g2 = (tagsObj || []).map(function(t){ return String(t && t.name ? t.name : '').toLowerCase(); }).filter(Boolean);
  return dedupeLower_(g1.concat(g2));
}
function rgIdFromRecording_(rec) {
  try {
    var rels = rec && rec.releases ? rec.releases : [];
    for (var i=0; i<rels.length; i++) {
      var rg = rels[i] && rels[i]['release-group'] ? rels[i]['release-group'] : null;
      if (rg && rg.id) return rg.id;
    }
  } catch (e) {}
  return '';
}
function firstArtistId_(rec) {
  try {
    var ac = rec && rec['artist-credit'] ? rec['artist-credit'] : [];
    var art = (ac[0] && ac[0].artist) ? ac[0].artist : (rec && rec.artists && rec.artists[0] ? rec.artists[0] : null);
    return art && art.id ? art.id : '';
  } catch (e) { return ''; }
}
function firstArtistName_(rec) {
  try {
    var ac = rec && rec['artist-credit'] ? rec['artist-credit'] : [];
    return (ac[0] && ac[0].name) ? ac[0].name : (rec && rec.artists && rec.artists[0] && rec.artists[0].name ? rec.artists[0].name : '');
  } catch (e) { return ''; }
}

/***** =========================
 *  WIKIPEDIA (fallback)
 *  ========================= */
function wikiLookup_(titleSentence, artistPretty) {
  try {
    var q = titleSentence + ' ' + artistPretty + ' song';
    var url = 'https://en.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srprop=snippet&srsearch=' + encodeURIComponent(q);
    var resp = UrlFetchApp.fetch(url, { method:'get', muteHttpExceptions:true });
    if (resp.getResponseCode() < 200 || resp.getResponseCode() >= 300) return null;
    var data = JSON.parse(resp.getContentText());
    var hit = data && data.query && data.query.search && data.query.search[0] ? data.query.search[0] : null;
    if (!hit || !hit.title) return null;

    var pageTitle = hit.title;
    var pageUrl = 'https://en.wikipedia.org/wiki/' + encodeURIComponent(pageTitle.replace(/ /g,'_'));

    var url2 = 'https://en.wikipedia.org/w/api.php?action=query&prop=extracts&format=json&exintro=1&explaintext=1&titles=' + encodeURIComponent(pageTitle);
    var resp2 = UrlFetchApp.fetch(url2, { method:'get', muteHttpExceptions:true });
    var year = '';
    if (resp2.getResponseCode() >= 200 && resp2.getResponseCode() < 300) {
      var data2 = JSON.parse(resp2.getContentText());
      var pages = data2 && data2.query && data2.query.pages ? data2.query.pages : {};
      var firstKey = Object.keys(pages)[0];
      var extract = firstKey ? (pages[firstKey] && pages[firstKey].extract ? pages[firstKey].extract : '') : '';
      var m = extract.match(/\b(19|20)\d{2}\b/);
      if (m) year = m[0];
    }
    return { title: pageTitle, url: pageUrl, year: year };
  } catch (e) {
    log_({level:'error', msg:'wiki_error', err:String(e)});
    return null;
  }
}

/***** =========================
 *  ITUNES (fallback)
 *  ========================= */
function itunesLookupGenre_(title, artist) {
  try {
    var term = title + ' ' + artist;
    var url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=5&country=' + encodeURIComponent(ITUNES_COUNTRY);
    var res = UrlFetchApp.fetch(url, { method:'get', muteHttpExceptions:true });
    if (!(res.getResponseCode() >= 200 && res.getResponseCode() < 300)) {
      url = 'https://itunes.apple.com/search?term=' + encodeURIComponent(term) + '&entity=song&limit=5&country=US';
      res = UrlFetchApp.fetch(url, { method:'get', muteHttpExceptions:true });
      if (!(res.getResponseCode() >= 200 && res.getResponseCode() < 300)) return null;
    }
    var data = JSON.parse(res.getContentText());
    var hits = data && data.results ? data.results : [];
    if (!hits.length) return null;

    var pick = pickBestItunes_(hits, title, artist);
    var g = (pick && pick.primaryGenreName) ? [String(pick.primaryGenreName)] : [];
    return g.length ? { genres: g } : null;
  } catch (e) {
    log_({ level:'error', msg:'itunes_error', err:String(e) });
    return null;
  }
}
function pickBestItunes_(hits, title, artist) {
  var tN = normStr_(title), aN = normStr_(artist);
  var best = null, bestScore = -1;
  for (var i=0; i<hits.length; i++) {
    var h = hits[i];
    var ht = normStr_(h.trackName || ''), ha = normStr_(h.artistName || '');
    var s = 0;
    if (ht === tN) s += 3;
    else if (ht.indexOf(tN) !== -1 || tN.indexOf(ht) !== -1) s += 2;
    if (ha === aN) s += 3;
    else if (ha.indexOf(aN) !== -1 || aN.indexOf(ha) !== -1) s += 2;
    if (s > bestScore) { bestScore = s; best = h; }
  }
  return best;
}

/***** =========================
 *  DEEZER (fallback)
 *  ========================= */
function deezerLookupGenre_(title, artist) {
  try {
    var q = 'track:"' + title + '" artist:"' + artist + '"';
    var url = 'https://api.deezer.com/search?q=' + encodeURIComponent(q) + '&limit=3';
    var res = UrlFetchApp.fetch(url, { method:'get', muteHttpExceptions:true });
    if (!(res.getResponseCode() >= 200 && res.getResponseCode() < 300)) return null;
    var data = JSON.parse(res.getContentText());
    var hits = data && data.data ? data.data : [];
    if (!hits.length) return null;

    var pick = pickBestDeezer_(hits, title, artist);
    var aid = pick && pick.artist && pick.artist.id ? pick.artist.id : null;
    if (!aid) return null;

    var res2 = UrlFetchApp.fetch('https://api.deezer.com/artist/' + encodeURIComponent(aid), { method:'get', muteHttpExceptions:true });
    if (!(res2.getResponseCode() >= 200 && res2.getResponseCode() < 300)) return null;
    var art = JSON.parse(res2.getContentText());
    var g = art && art.genres && art.genres.data ? art.genres.data.map(function(x){ return String(x && x.name ? x.name : ''); }).filter(Boolean) : [];
    return g.length ? { genres: g } : null;
  } catch (e) {
    log_({ level:'error', msg:'deezer_error', err:String(e) });
    return null;
  }
}
function pickBestDeezer_(hits, title, artist) {
  var tN = normStr_(title), aN = normStr_(artist);
  var best = null, bestScore = -1;
  for (var i=0; i<hits.length; i++) {
    var h = hits[i];
    var ht = normStr_(h.title || ''), ha = normStr_(h.artist && h.artist.name ? h.artist.name : '');
    var s = 0;
    if (ht === tN) s += 3;
    else if (ht.indexOf(tN) !== -1 || tN.indexOf(ht) !== -1) s += 2;
    if (ha === aN) s += 3;
    else if (ha.indexOf(aN) !== -1 || aN.indexOf(ha) !== -1) s += 2;
    if (s > bestScore) { bestScore = s; best = h; }
  }
  return best;
}

/***** =========================
 *  GENRE NORMALIZATION (compact taxonomy)
 *  ========================= */
function normalizeGenreList_(arr) {
  var out = {};
  (arr || []).forEach(function(g){
    var x = String(g || '').toLowerCase();
    if (!x) return;

    // Brazilian styles
    if (/\bmpb\b/.test(x)) out['mpb'] = true;
    else if (/sertanej/.test(x)) out['sertanejo'] = true;
    else if (/pagode/.test(x)) out['pagode'] = true;
    else if (/samba/.test(x)) out['samba'] = true;
    else if (/ax[ée]/.test(x) || x === 'axe') out['axé'] = true;
    else if (/forr[oó]/.test(x)) out['forró'] = true;
    else if (/bossa/.test(x)) out['bossa nova'] = true;
    else if (/funk\s*carioca|baile\s*funk/.test(x)) out['funk carioca'] = true;

    // International
    else if (/grunge/.test(x)) out['grunge'] = true;
    else if (/(alt|alternative)/.test(x)) out['alternative'] = true;
    else if (/indie/.test(x)) out['indie'] = true;
    else if (/hard\s*rock/.test(x)) out['rock'] = true;
    else if (/rock/.test(x)) out['rock'] = true;
    else if (/metal/.test(x)) out['metal'] = true;
    else if (/punk/.test(x)) out['punk'] = true;
    else if (/(hip[-\s]?hop|rap|trap)/.test(x)) out['hip-hop'] = true;
    else if (/(r&b|rhythm.*blues)/.test(x)) out['r&b'] = true;
    else if (/soul/.test(x)) out['soul'] = true;
    else if (/(edm|electro|electronic|dance)/.test(x)) out['electronic'] = true;
    else if (/house/.test(x)) out['house'] = true;
    else if (/techno/.test(x)) out['techno'] = true;
    else if (/reggae/.test(x)) out['reggae'] = true;
    else if (/pop/.test(x)) out['pop'] = true;
    else if (/country/.test(x)) out['country'] = true;
    else if (/blues/.test(x)) out['blues'] = true;
    else if (/jazz/.test(x)) out['jazz'] = true;
    else if (/latin/.test(x)) out['latin'] = true;
    else if (/acoustic/.test(x)) out['acoustic'] = true; // keep acoustic
  });
  return Object.keys(out);
}

/***** =========================
 *  EPOCH LABEL
 *  ========================= */
function deriveEpoch_(yearStr) {
  var y = parseInt(String(yearStr), 10);
  if (!y || y < 1900 || y > 2100) return '';
  var decade = Math.floor(y/10)*10;
  var short = decade % 100;
  var label = (short < 10 ? '0' + short : String(short)) + 's';
  return label;
}

/***** =========================
 *  NORMALIZATION (title / artist)
 *  ========================= */
function sentenceCaseTitle_(s) {
  var t = (s || '').toLowerCase();
  return t.replace(/^\s*([a-zà-ú])/i, function(m,p1){ return p1.toUpperCase(); });
}
function smartTitleCasePtBr_(input) {
  if (!input) return '';
  var small = {
    'a':1,'as':1,'o':1,'os':1,'um':1,'uma':1,'uns':1,'umas':1,
    'de':1,'do':1,'da':1,'dos':1,'das':1,
    'em':1,'no':1,'na':1,'nos':1,'nas':1,
    'por':1,'pelo':1,'pelos':1,'pela':1,'pelas':1,
    'para':1,'pra':1,
    'e':1,'ou':1,
    'com':1,'sem':1,'sob':1,'sobre':1,
    'até':1,'após':1,'ante':1,'entre':1,'perante':1,'desde':1,'contra':1
  };
  var forceUpper = {'mc':'MC','dj':'DJ',"n'":"N'","n’":"N’"};
  var words = input.replace(/\s+/g,' ').trim().split(' ');
  var total = words.length;
  return words.map(function(w, i){
    if (w.indexOf('-') !== -1) {
      return w.split('-').map(function(p){ return fmtWord_(p,i,total,small,forceUpper); }).join('-');
    }
    return fmtWord_(w,i,total,small,forceUpper);
  }).join(' ');
}
function fmtWord_(word, index, total, small, forceUpper) {
  var original = word;
  var lower = word.toLowerCase();
  if (/^[A-Z0-9./&]+$/.test(original) && original.length <= 6) return original;
  if (forceUpper[lower]) return forceUpper[lower];
  if (small[lower] && index !== 0 && index !== total - 1) return lower;
  var parts = lower.split(/(['’])/);
  if (parts.length > 1) {
    return parts.map(function(seg,k){ return (k%2===1 ? seg : cap_(seg)); }).join('');
  }
  return cap_(lower);
}
function cap_(s){ return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function dedupeLower_(arr){
  var seen = {}, out = [];
  for (var i=0;i<(arr||[]).length;i++){
    var v = String(arr[i]).toLowerCase();
    if (!v) continue;
    if (!seen[v]) { seen[v]=1; out.push(v); }
  }
  return out;
}

/***** =========================
 *  CSV / VALUE NORMALIZERS
 *  ========================= */
function loadCsvMap_(folder) {
  var csvFile = firstByName_(folder, CSV_NAME);
  if (!csvFile) throw new Error('CSV not found: ' + CSV_NAME);
  var rows = Utilities.parseCsv(csvFile.getBlob().getDataAsString());
  if (!rows || rows.length < 2) throw new Error('CSV must have header + data.');
  var header = rows[0].map(function(h){ return h.trim().toLowerCase(); });
  var idx = { title: header.indexOf('title'), artist: header.indexOf('artist'), voice: header.indexOf('voice'), origin: header.indexOf('origin') };
  if (idx.title<0 || idx.artist<0 || idx.voice<0 || idx.origin<0) throw new Error('CSV header must be: Title, Artist, Voice, Origin');

  var map = {};
  for (var r=1; r<rows.length; r++) {
    var row = rows[r]; if (!row || !row.length) continue;
    var t = String(row[idx.title]||'').trim();
    var a = String(row[idx.artist]||'').trim();
    if (!t || !a) continue;
    map[makeKeyGeneric_(t,a)] = {
      voice: normalizeVoice_(String(row[idx.voice]||'').trim()),
      origin: normalizeOrigin_(String(row[idx.origin]||'').trim())
    };
  }
  return map;
}
function normalizeVoice_(v) {
  var x = (v||'').trim().toLowerCase();
  if (x==='male' || x==='masculina' || x==='m') return 'male';
  if (x==='female' || x==='feminina' || x==='f') return 'female';
  if (x==='duet' || x==='dueto' || x==='d') return 'duet';
  return '';
}
function normalizeOrigin_(o) {
  var x = (o||'').trim().toLowerCase();
  if (x==='national' || x==='nacional' || x==='br' || x==='brazil' || x==='brasil') return 'national';
  if (x==='international' || x==='internacional' || x==='int') return 'international';
  return '';
}

/***** =========================
 *  KEYS / IDS
 *  ========================= */
function makeKeyGeneric_(title, artist) {
  return slugBase_(String(title)) + '|' + slugBase_(String(artist));
}
function makeId_(s){ return slugBase_(s); }
function slugBase_(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9\s-]/g,'')
    .trim().replace(/\s+/g,'-').replace(/-+/g,'-');
}
function indexByKey_(arr) {
  var map = {};
  (arr || []).forEach(function(it){
    var t = it && it.title ? it.title : '';
    var a = it && it.artist ? it.artist : '';
    map[ makeKeyGeneric_(t, a) ] = it;
  });
  return map;
}

/***** =========================
 *  DRIVE & JSON IO
 *  ========================= */
function resolveFolder_() {
  var id = (typeof FOLDER_ID !== 'undefined' ? String(FOLDER_ID) : '').trim();
  if (!id) id = (PropertiesService.getScriptProperties().getProperty('FOLDER_ID') || '').trim();
  if (!id) throw new Error('FOLDER_ID is not set. Put it at the top or save it in Script Properties.');
  var folder = DriveApp.getFolderById(id);
  folder.getName(); // permission check
  return folder;
}
function firstByName_(folder, name) {
  var it = folder.getFilesByName(name);
  return it.hasNext() ? it.next() : null;
}
function overwritePlainFile_(folder, name, content) {
  var it = folder.getFilesByName(name);
  if (it.hasNext()) it.next().setTrashed(true);
  folder.createFile(name, content, MimeType.PLAIN_TEXT);
}
function loadLatestCatalogue_(folder) {
  var found = findLatestCatalogue_(folder, BASE_JSON);
  var latestFile = found.latestFile;
  if (!latestFile) return [];
  try {
    var arr = JSON.parse(latestFile.getBlob().getDataAsString());
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}
function loadWip_(folder) {
  var file = firstByName_(folder, WIP_JSON);
  if (!file) return [];
  try {
    var arr = JSON.parse(file.getBlob().getDataAsString());
    return Array.isArray(arr) ? arr : [];
  } catch (e) { return []; }
}

/***** =========================
 *  VERSIONING
 *  ========================= */
function findLatestCatalogue_(folder, baseName) {
  var latestFile = firstByName_(folder, baseName);
  var latestName = latestFile ? baseName : null;
  var prefix = baseName.replace(/\.json$/i,'');
  var files = folder.getFiles();
  var maxN = 0, maxFile = null, maxName = null;
  var re = new RegExp('^' + escapeRegExp_(prefix) + '_v(\\d+)\\.json$', 'i');
  while (files.hasNext()) {
    var f = files.next();
    var m = f.getName().match(re);
    if (m) {
      var n = parseInt(m[1],10)||0;
      if (n>maxN){ maxN=n; maxFile=f; maxName=f.getName(); }
    }
  }
  if (maxN > 0) { latestFile = maxFile; latestName = maxName; }
  return { latestFile: latestFile, latestName: latestName };
}
function nextVersionedName_(folder, baseName) {
  var baseExists = !!firstByName_(folder, baseName);
  if (!baseExists) return baseName;
  var prefix = baseName.replace(/\.json$/i,'');
  var files = folder.getFiles();
  var maxN = 1;
  var re = new RegExp('^' + escapeRegExp_(prefix) + '_v(\\d+)\\.json$', 'i');
  while (files.hasNext()) {
    var f = files.next();
    var m = f.getName().match(re);
    if (m) {
      var n = parseInt(m[1],10)||0;
      if (n>maxN) maxN=n;
    }
  }
  return prefix + '_v' + (maxN+1) + '.json';
}
function escapeRegExp_(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g,'\\$&'); }

/***** =========================
 *  LOGGING & UTIL
 *  ========================= */
function log_(obj) {
  var folder = resolveFolder_();
  var name = 'songs_log.jsonl';
  var it = folder.getFilesByName(name);
  var line = JSON.stringify(Object.assign({}, obj, { ts: new Date().toISOString() })) + '\n';
  if (it.hasNext()) {
    var f = it.next();
    var old = f.getBlob().getDataAsString();
    f.setTrashed(true);
    folder.createFile(name, old + line, MimeType.PLAIN_TEXT);
  } else {
    folder.createFile(name, line, MimeType.PLAIN_TEXT);
  }
}
function toCsv_(rows) {
  return rows.map(function(r){
    return r.map(function(s){ return String(s).replace(/"/g,'""'); })
            .map(function(s){ return /[",\n]/.test(s) ? '"' + s + '"' : s; })
            .join(',');
  }).join('\n');
}
function normStr_(s) {
  return String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}

/***** =========================
 *  TRIGGERS
 *  ========================= */
function startEnrichmentTrigger() {
  if (isEnrichmentTriggerActive_()) {
    Logger.log('enrichBatch trigger already active.');
    return;
  }
  ScriptApp.newTrigger('enrichBatch').timeBased().everyMinutes(1).create();
  Logger.log('enrichBatch trigger started (every 1 minute).');
}
function stopEnrichmentTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t){
    if (t.getHandlerFunction() === 'enrichBatch') ScriptApp.deleteTrigger(t);
  });
  Logger.log('enrichBatch trigger stopped.');
}
function isEnrichmentTriggerActive_() {
  var list = ScriptApp.getProjectTriggers();
  for (var i=0;i<list.length;i++){
    if (list[i].getHandlerFunction() === 'enrichBatch') return true;
  }
  return false;
}
function safeStopEnrichmentTrigger_() {
  if (isEnrichmentTriggerActive_()) stopEnrichmentTrigger();
}
function driveAuthProbe() {
  const folder = resolveFolder_();
  Logger.log('OK: %s (%s)', folder.getName(), folder.getId());
}

/***** =========================
 *  CLEANUP — remove "brazilian" from tags.genre
 *  ========================= */
function cleanBrazilianFromGenresInWip() {
  var folder = resolveFolder_();
  var wip = loadWip_(folder);
  if (!wip.length) { Logger.log('No WIP found. Run buildBaseCatalogue() first.'); return; }

  var affected = 0;
  for (var i=0; i<wip.length; i++) {
    var it = wip[i];
    var g = it && it.tags && it.tags.genre ? it.tags.genre.slice() : [];
    if (!g.length) continue;

    var filtered = [];
    var removed = 0;
    for (var j=0; j<g.length; j++) {
      var v = String(g[j] || '').trim();
      if (v && v.toLowerCase() === 'brazilian') { removed++; continue; }
      filtered.push(v);
    }
    if (removed > 0) {
      if (!it.tags) it.tags = {};
      it.tags.genre = dedupeLower_(filtered);
      affected++;
    }
  }

  overwritePlainFile_(folder, WIP_JSON, JSON.stringify(wip, null, 2));
  Logger.log('cleanBrazilianFromGenresInWip(): removed "brazilian" from %s songs.', affected);
}

/** Clean the latest finalized catalogue (BASE_JSON or highest _vN) and write a new version. */
function cleanBrazilianFromGenresInLatestFinal() {
  var folder = resolveFolder_();
  var found = findLatestCatalogue_(folder, BASE_JSON);
  var latestFile = found.latestFile;
  if (!latestFile) { Logger.log('No finalized catalogue found.'); return; }

  var arr;
  try { arr = JSON.parse(latestFile.getBlob().getDataAsString()); }
  catch (e) { throw new Error('Could not parse latest catalogue JSON: ' + e); }
  if (!Array.isArray(arr) || !arr.length) { Logger.log('Catalogue is empty.'); return; }

  var affected = 0;
  for (var i=0; i<arr.length; i++) {
    var it = arr[i];
    var g = it && it.tags && it.tags.genre ? it.tags.genre.slice() : [];
    if (!g.length) continue;

    var filtered = [];
    var removed = 0;
    for (var j=0; j<g.length; j++) {
      var v = String(g[j] || '').trim();
      if (v && v.toLowerCase() === 'brazilian') { removed++; continue; }
      filtered.push(v);
    }
    if (removed > 0) {
      if (!it.tags) it.tags = {};
      it.tags.genre = dedupeLower_(filtered);
      affected++;
    }
  }

  var newName = nextVersionedName_(folder, BASE_JSON);
  overwritePlainFile_(folder, newName, JSON.stringify(arr, null, 2));
  Logger.log('cleanBrazilianFromGenresInLatestFinal(): removed "brazilian" from %s songs → %s', affected, newName);
}

/***** =========================
 *  MANUAL GENRE ASSIGNMENTS (FUZZY) — YOUR NEW LIST
 *  ========================= */
function applyManualGenresFromChat() {
  const folder = resolveFolder_();
  const wip = loadWip_(folder);
  if (!wip.length) throw new Error('No WIP found. Run buildBaseCatalogue() first.');

  // Your assignments (Brazilian/International → origin; not stored as genre)
  const overrides = [
    { title: 'Leilao',                    artist: 'Cesar Menotte e Fabiano V2',   genres: ['Sertanejo','Brazilian'] },
    { title: 'Pagina de amigos',          artist: 'Chitazinho e Xororo',          genres: ['Sertanejo','Brazilian'] },
    { title: 'Segredos',                  artist: 'Frejat',                        genres: ['Pop','Rock','Brazilian'] },
    { title: 'Convite de casamento',      artist: 'Gian e Giovani',                genres: ['Sertanejo','Brazilian'] },
    { title: 'Amei te ver-tiago',         artist: 'Iork',                          genres: ['MPB','Pop','Brazilian'] },
    { title: 'Stitting waiting wishing',  artist: 'Jack Johnson',                  genres: ['Pop','International','Acoustic'] },
    { title: 'Uma arlinda mulher',        artist: 'Mamonas Assassinas',            genres: ['Rock','Brazilian'] },
    { title: 'Ouvi dizer',                artist: 'Melin',                         genres: ['MPB','Pop','','Brazilian'] },
    { title: 'Pagode pout pourri',        artist: 'Raca Negra',                    genres: ['Pagode','Brazilian'] },
    { title: 'Your love',                 artist: 'The Outfield',                   genres: ['Pop','Rock','International'] },
    { title: 'Morena',                    artist: 'Vitor Kley',                    genres: ['MPB','Pop','Brazilian'] },
    { title: 'O sol',                     artist: 'Vitor Kley',                    genres: ['MPB','Pop','Brazilian'] }
  ];

  // Build indices from WIP
  const byExact = {};
  const byTitleSlug = {};
  for (var i=0;i<wip.length;i++){
    var item = wip[i];
    var t = item.title || '', a = item.artist || '';
    var k = makeKeyGeneric_(t, a);
    byExact[k] = item;
    var ts = slugBase_(t);
    if (!byTitleSlug[ts]) byTitleSlug[ts] = [];
    byTitleSlug[ts].push(item);
  }

  function normGenresForOverride_(arr) {
    var filtered = [];
    for (var j=0;j<(arr||[]).length;j++){
      var g = String(arr[j]||'').trim();
      if (!g) continue;
      var gl = g.toLowerCase();
      if (gl === 'brazilian' || gl === 'international') continue; // origins → not genre
      filtered.push(g);
    }
    return normalizeGenreList_(filtered);
  }

  var unmatched = [];
  var updated = 0;

  for (var u=0; u<overrides.length; u++) {
    var o = overrides[u];
    var targetGenres = normGenresForOverride_(o.genres);
    if (!targetGenres.length) continue;

    // Try to find item (exact → same-title → hyphen-fix → global best)
    var itemToUse = findItemForOverride_(o, byExact, byTitleSlug, wip);

    if (!itemToUse) {
      unmatched.push({ title:o.title, artist:o.artist, genres:o.genres.join('; ') });
      continue;
    }

    var current = (itemToUse.tags && itemToUse.tags.genre) ? itemToUse.tags.genre : [];
    var merged = dedupeLower_(current.concat(targetGenres));
    if (!itemToUse.tags) itemToUse.tags = {};
    itemToUse.tags.genre = merged;
    itemToUse.source = (itemToUse.source && itemToUse.source !== 'manual') ? (itemToUse.source + '+manual') : 'manual';
    updated++;
  }

  overwritePlainFile_(folder, WIP_JSON, JSON.stringify(wip, null, 2));
  Logger.log('applyManualGenresFromChat(): applied to %s songs.', updated);

  if (unmatched.length) {
    var rows = [["Title","Artist (you wrote)","Genres (you chose)"]];
    for (var m=0;m<unmatched.length;m++){
      var uo = unmatched[m];
      rows.push([uo.title, uo.artist, uo.genres]);
    }
    var csv = toCsv_(rows);
    overwritePlainFile_(folder, 'manual_genre_unmatched.csv', csv);
    Logger.log('Some overrides did not match exactly. See manual_genre_unmatched.csv');
  }
}

/***** ---------- FUZZY MATCH HELPERS ---------- *****/
function findItemForOverride_(o, byExact, byTitleSlug, wip) {
  // 1) exact
  var exact = byExact[ makeKeyGeneric_(o.title, o.artist) ];
  if (exact) return exact;

  // 2) same-title candidates
  var candidates = byTitleSlug[ slugBase_(o.title) ] || [];

  // 2a) if none, try hyphen-fix: if "title-part1 - part2" probably part2 bled from artist
  if (!candidates.length && o.title.indexOf('-') !== -1) {
    var left = o.title.split('-')[0].trim();
    candidates = byTitleSlug[ slugBase_((left)) ] || [];
  }

  // 2b) single candidate → accept
  if (candidates.length === 1) return candidates[0];

  // 2c) multiple → choose best by artist similarity
  if (candidates.length > 1) {
    var want = simplifyArtist_(o.artist);
    var best = null, bestScore = 1e9;
    for (var i=0;i<candidates.length;i++){
      var cand = candidates[i];
      var have = simplifyArtist_(cand.artist || '');
      var d = softArtistDistance_(want, have);
      if (d < bestScore) { bestScore = d; best = cand; }
    }
    if (best && bestScore <= 4) return best;
  }

  // 3) global best (title + artist distances)
  var wantTitle = simplifyTitle_(o.title);
  var wantArtist = simplifyArtist_(o.artist);
  var globalBest = null, globalScore = 1e9;
  for (var k=0;k<wip.length;k++){
    var it = wip[k];
    var haveT = simplifyTitle_(it.title || '');
    var haveA = simplifyArtist_(it.artist || '');
    var dt = levenshtein_(wantTitle, haveT);
    var da = softArtistDistance_(wantArtist, haveA);
    var score = dt + da;
    // prefer “contains” by subtracting a small amount
    if (haveT.indexOf(wantTitle) !== -1 || wantTitle.indexOf(haveT) !== -1) score -= 1;
    if (haveA.indexOf(wantArtist) !== -1 || wantArtist.indexOf(haveA) !== -1) score -= 1;
    if (score < globalScore) { globalScore = score; globalBest = it; }
  }
  if (globalBest && globalScore <= 7) return globalBest;

  return null;
}
function simplifyTitle_(s) {
  return String(s||'')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\b(feat\.?|ft\.?)\b/g, '')
    .replace(/[^a-z0-9]/g,'')
    .trim();
}
function simplifyArtist_(s) {
  return String(s||'')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase()
    .replace(/\bv\d+\b/g, '')                      // kill v2/v3…
    .replace(/\b(feat\.?|ft\.?|with|com|and|&|e)\b/g, '')
    .replace(/\b(vers(ao|ão|ion)|ao vivo|live|acoustic)\b/g, '')
    .replace(/[^a-z0-9]/g,'')
    .trim()
    // common typos/aliases small fixups
    .replace(/menotte/g, 'menotti')
    .replace(/chitazinho/g, 'chitaozinho')
    .replace(/melin/g, 'melim')
    ;
}
function softArtistDistance_(a, b) {
  var d = levenshtein_(a,b);
  if (a && b && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) d -= 1;
  return Math.max(0, d);
}
function levenshtein_(a, b) {
  var m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  var dp = new Array(n+1);
  for (var j=0; j<=n; j++) dp[j] = j;
  for (var i=1; i<=m; i++) {
    var prev = dp[0];
    dp[0] = i;
    for (var k=1; k<=n; k++) {
      var tmp = dp[k];
      dp[k] = Math.min(
        dp[k] + 1,
        dp[k-1] + 1,
        prev + (a.charAt(i-1) === b.charAt(k-1) ? 0 : 1)
      );
      prev = tmp;
    }
  }
  return dp[n];
}

/***** =========================
 *  (OPTIONAL) CSV-driven overrides
 *  ========================= */
function applyGenreOverrides() {
  const folder = resolveFolder_();
  const wip = loadWip_(folder);
  if (!wip.length) throw new Error('No WIP found. Run buildBaseCatalogue() first.');

  const csvFile = firstByName_(folder, 'genre_overrides.csv');
  if (!csvFile) throw new Error('Missing genre_overrides.csv in the Drive folder.');
  const rows = Utilities.parseCsv(csvFile.getBlob().getDataAsString());
  if (!rows || rows.length < 2) throw new Error('genre_overrides.csv must have header + data.');

  const header = rows[0].map(function(h){ return h.trim().toLowerCase(); });
  const idx = { title: header.indexOf('title'), artist: header.indexOf('artist'), genres: header.indexOf('genres') };
  if (idx.title<0 || idx.artist<0 || idx.genres<0) throw new Error('CSV header must be: Title, Artist, Genres');

  const override = {};
  for (var r=1; r<rows.length; r++) {
    var row = rows[r];
    if (!row || !row.length) continue;
    var title = String(row[idx.title]||'').trim();
    var artist = String(row[idx.artist]||'').trim();
    var genres = String(row[idx.genres]||'').split(';').map(function(s){return s.trim();}).filter(Boolean);
    if (!title || !artist || !genres.length) continue;
    var key = makeKeyGeneric_(title, artist);
    override[key] = normalizeGenreList_(genres);
  }

  var updated = 0;
  for (var i=0;i<wip.length;i++){
    var item = wip[i];
    var key = makeKeyGeneric_(item.title || '', item.artist || '');
    var g = override[key];
    if (g && g.length) {
      var current = (item.tags && item.tags.genre) ? item.tags.genre : [];
      var merged = dedupeLower_(current.concat(g));
      if (!item.tags) item.tags = {};
      item.tags.genre = merged;
      item.source = (item.source && item.source !== 'manual') ? (item.source + '+manual') : 'manual';
      updated++;
    }
  }

  overwritePlainFile_(folder, WIP_JSON, JSON.stringify(wip, null, 2));
  Logger.log('applyGenreOverrides(): applied to %s songs.', updated);
}