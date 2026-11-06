import { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownUp,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  ExternalLink,
  Headphones,
  Link2,
  LoaderCircle,
  LogOut,
  Music2,
  Plus,
  RefreshCw,
  Settings2,
  X,
} from 'lucide-react';

const STORAGE = {
  clientId: 'setlist-client-id',
  playlistUrl: 'setlist-playlist-url',
  startTime: 'setlist-start-time',
  events: 'setlist-events',
  tracks: 'setlist-tracks',
  playlist: 'setlist-playlist',
  token: 'setlist-token',
  refreshToken: 'setlist-refresh-token',
  tokenExpiry: 'setlist-token-expiry',
};

const sampleTracks = [
  { id: 's1', name: 'Intro', artists: ['The xx'], duration_ms: 68000, album: 'xx' },
  { id: 's2', name: 'Midnight City', artists: ['M83'], duration_ms: 244000, album: 'Hurry Up, We’re Dreaming' },
  { id: 's3', name: 'Tadow', artists: ['Masego', 'FKJ'], duration_ms: 305000, album: 'Lady Lady' },
  { id: 's4', name: 'Borderline', artists: ['Tame Impala'], duration_ms: 237000, album: 'The Slow Rush' },
  { id: 's5', name: 'Glue', artists: ['Bicep'], duration_ms: 271000, album: 'Bicep' },
  { id: 's6', name: 'A Walk', artists: ['Tycho'], duration_ms: 317000, album: 'Dive' },
  { id: 's7', name: 'Show Me How', artists: ['Men I Trust'], duration_ms: 221000, album: 'Show Me How' },
  { id: 's8', name: 'Innerbloom', artists: ['RÜFÜS DU SOL'], duration_ms: 577000, album: 'Bloom' },
  { id: 's9', name: 'Sunset Lover', artists: ['Petit Biscuit'], duration_ms: 237000, album: 'Presence' },
  { id: 's10', name: 'Weightless', artists: ['Arlo Parks'], duration_ms: 196000, album: 'Collapsed in Sunbeams' },
  { id: 's11', name: 'Open Eye Signal', artists: ['Jon Hopkins'], duration_ms: 477000, album: 'Immunity' },
  { id: 's12', name: 'Outro', artists: ['M83'], duration_ms: 296000, album: 'Hurry Up, We’re Dreaming' },
];

function readStorage(key, fallback = '') {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function getPlaylistId(value) {
  const uri = value.trim().match(/^spotify:playlist:([a-zA-Z0-9]+)$/);
  if (uri) return uri[1];
  try {
    const url = new URL(value.trim());
    const parts = url.pathname.split('/').filter(Boolean);
    const index = parts.indexOf('playlist');
    return index >= 0 ? parts[index + 1] : null;
  } catch {
    return null;
  }
}

function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatClock(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  return `${hours % 12 || 12}:${String(mins).padStart(2, '0')} ${suffix}`;
}

function minutesFromClock(value) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function toClockInput(minutes) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

function formatTotal(ms) {
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours} hr ${minutes % 60} min` : `${minutes} min`;
}

function makeVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(64));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function makeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

async function requestAccessToken(clientId, code, verifier) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: window.location.origin + window.location.pathname,
      code_verifier: verifier,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Spotify sign-in could not be completed.');
  return data;
}

async function renewAccessToken(clientId, refreshToken) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Spotify session expired. Connect again to continue.');
  return data;
}

async function fetchPlaylist(clientId, playlistId, accessToken) {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const playlistResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}`, {
    headers,
  });
  if (!playlistResponse.ok) {
    const detail = await playlistResponse.json().catch(() => ({}));
    const error = new Error(detail.error?.message || 'Could not load this playlist. Check that the playlist is accessible.');
    error.status = playlistResponse.status;
    throw error;
  }
  const playlist = await playlistResponse.json();
  const tracks = [];
  let next = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=50`;

  while (next) {
    const response = await fetch(next, { headers });
    if (!response.ok) {
      const detail = await response.json().catch(() => ({}));
      const error = new Error(detail.error?.message || 'Could not load all playlist tracks.');
      error.status = response.status;
      throw error;
    }
    const page = await response.json();
    for (const entry of page.items || []) {
      const track = entry.item || entry.track;
      if (!track || track.type === 'episode' || !track.duration_ms) continue;
      tracks.push({
        id: track.id || `${track.name}-${tracks.length}`,
        name: track.name,
        artists: (track.artists || []).map((artist) => artist.name),
        duration_ms: track.duration_ms,
        album: track.album?.name || '',
        image: track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || '',
        url: track.external_urls?.spotify || '',
      });
    }
    next = page.next;
  }

  return {
    name: playlist.name,
    owner: playlist.owner?.display_name || 'Spotify playlist',
    image: playlist.images?.[0]?.url || '',
    url: playlist.external_urls?.spotify || `https://open.spotify.com/playlist/${playlistId}`,
    tracks,
  };
}

function App() {
  const [clientId, setClientId] = useState(() => readStorage(STORAGE.clientId));
  const [playlistUrl, setPlaylistUrl] = useState(() => readStorage(STORAGE.playlistUrl));
  const [playlist, setPlaylist] = useState(() => {
    try { return JSON.parse(readStorage(STORAGE.playlist, 'null')); } catch { return null; }
  });
  const [tracks, setTracks] = useState(() => {
    try { return JSON.parse(readStorage(STORAGE.tracks, '[]')); } catch { return []; }
  });
  const [startTime, setStartTime] = useState(() => readStorage(STORAGE.startTime, '21:00'));
  const [events, setEvents] = useState(() => {
    try { return JSON.parse(readStorage(STORAGE.events, '[]')); } catch { return []; }
  });
  const [token, setToken] = useState(() => readStorage(STORAGE.token));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventTime, setEventTime] = useState('23:59');
  const [eventDay, setEventDay] = useState('0');
  const [demoMode, setDemoMode] = useState(false);

  const isConnected = Boolean(token);
  const redirectUri = window.location.origin + window.location.pathname;

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;
    const state = params.get('state');
    const savedState = sessionStorage.getItem('setlist-oauth-state');
    const verifier = sessionStorage.getItem('setlist-oauth-verifier');
    const savedClientId = readStorage(STORAGE.clientId);
    window.history.replaceState({}, document.title, window.location.pathname);

    if (!state || state !== savedState || !verifier || !savedClientId) {
      setError('Spotify sign-in expired. Please connect again.');
      return;
    }
    setLoading(true);
    requestAccessToken(savedClientId, code, verifier)
      .then((data) => {
        localStorage.setItem(STORAGE.token, data.access_token);
        localStorage.setItem(STORAGE.tokenExpiry, String(Date.now() + data.expires_in * 1000));
        if (data.refresh_token) localStorage.setItem(STORAGE.refreshToken, data.refresh_token);
        setToken(data.access_token);
        sessionStorage.removeItem('setlist-oauth-state');
        sessionStorage.removeItem('setlist-oauth-verifier');
        const url = readStorage(STORAGE.playlistUrl);
        const id = getPlaylistId(url);
        if (id) return fetchPlaylist(savedClientId, id, data.access_token);
        return null;
      })
      .then((data) => {
        if (data) savePlaylist(data);
      })
      .catch((cause) => setError(cause.message || 'Spotify sign-in failed.'))
      .finally(() => setLoading(false));
  }, []);

  function persist(key, value) {
    try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ }
  }

  function savePlaylist(data) {
    setPlaylist(data);
    setTracks(data.tracks);
    setDemoMode(false);
    persist(STORAGE.playlist, JSON.stringify(data));
    persist(STORAGE.tracks, JSON.stringify(data.tracks));
  }

  async function connectSpotify() {
    setError('');
    const id = getPlaylistId(playlistUrl);
    if (!id) {
      setError('Paste a Spotify playlist link to continue.');
      return;
    }
    if (!clientId.trim()) {
      setSettingsOpen(true);
      setError('Add your Spotify app client ID in settings first.');
      return;
    }
    persist(STORAGE.clientId, clientId.trim());
    persist(STORAGE.playlistUrl, playlistUrl.trim());
    const verifier = makeVerifier();
    const state = makeVerifier().slice(0, 32);
    sessionStorage.setItem('setlist-oauth-verifier', verifier);
    sessionStorage.setItem('setlist-oauth-state', state);
    const challenge = await makeChallenge(verifier);
    const authorizeUrl = new URL('https://accounts.spotify.com/authorize');
    authorizeUrl.search = new URLSearchParams({
      client_id: clientId.trim(),
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: 'playlist-read-private playlist-read-collaborative',
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
    });
    window.location.assign(authorizeUrl);
  }

  async function refreshPlaylist() {
    setError('');
    const id = getPlaylistId(playlistUrl);
    if (!id) {
      setError('Add a valid Spotify playlist link first.');
      return;
    }
    if (demoMode) {
      loadSample();
      return;
    }
    if (!token) {
      connectSpotify();
      return;
    }
    setLoading(true);
    try {
      let accessToken = token;
      const refreshToken = readStorage(STORAGE.refreshToken);
      const expiry = Number(readStorage(STORAGE.tokenExpiry, '0'));
      const renew = async () => {
        if (!refreshToken) throw new Error('Spotify session expired. Connect again to continue.');
        const renewed = await renewAccessToken(clientId, refreshToken);
        accessToken = renewed.access_token;
        localStorage.setItem(STORAGE.token, accessToken);
        localStorage.setItem(STORAGE.tokenExpiry, String(Date.now() + renewed.expires_in * 1000));
        if (renewed.refresh_token) localStorage.setItem(STORAGE.refreshToken, renewed.refresh_token);
        setToken(accessToken);
      };
      if (expiry && expiry <= Date.now() + 60000) await renew();
      let data;
      try {
        data = await fetchPlaylist(clientId, id, accessToken);
      } catch (cause) {
        if (cause.status !== 401 || !refreshToken) throw cause;
        await renew();
        data = await fetchPlaylist(clientId, id, accessToken);
      }
      savePlaylist(data);
      setLastUpdated(new Date());
    } catch (cause) {
      setError(cause.message || 'Could not refresh this playlist.');
    } finally {
      setLoading(false);
    }
  }

  const [lastUpdated, setLastUpdated] = useState(null);

  function loadSample() {
    const data = {
      name: 'After Hours — in order',
      owner: 'A little night drive',
      image: '',
      url: '',
      tracks: sampleTracks,
    };
    setPlaylist(data);
    setTracks(sampleTracks);
    setPlaylistUrl('');
    setDemoMode(true);
    setError('');
  }

  function updateStartTime(value) {
    setStartTime(value);
    persist(STORAGE.startTime, value);
  }

  function addEvent(event) {
    event.preventDefault();
    if (!eventTitle.trim()) return;
    const startMinutes = minutesFromClock(startTime);
    const clockMinutes = minutesFromClock(eventTime);
    const day = Number(eventDay) || 0;
    let offsetMinutes = clockMinutes - startMinutes + day * 1440;
    if (offsetMinutes < 0 && day === 0) offsetMinutes += 1440;
    const nextEvents = [...events, {
      id: crypto.randomUUID(),
      title: eventTitle.trim(),
      offsetMs: offsetMinutes * 60000,
    }].sort((a, b) => a.offsetMs - b.offsetMs);
    setEvents(nextEvents);
    persist(STORAGE.events, JSON.stringify(nextEvents));
    setEventTitle('');
    setEventOpen(false);
  }

  function removeEvent(id) {
    const nextEvents = events.filter((event) => event.id !== id);
    setEvents(nextEvents);
    persist(STORAGE.events, JSON.stringify(nextEvents));
  }

  function signOut() {
    [STORAGE.token, STORAGE.refreshToken, STORAGE.tokenExpiry].forEach((key) => localStorage.removeItem(key));
    setToken('');
  }

  const timeline = useMemo(() => {
    let elapsedMs = 0;
    return tracks.map((track, index) => {
      const startMs = elapsedMs;
      elapsedMs += track.duration_ms;
      return { ...track, index, startMs, endMs: elapsedMs };
    });
  }, [tracks]);
  const totalDuration = timeline.at(-1)?.endMs || 0;
  const startMinutes = minutesFromClock(startTime);

  const timelineItems = useMemo(() => {
    const items = timeline.map((track) => ({ type: 'track', ...track, offsetMs: track.startMs }));
    events.forEach((event) => items.push({ type: 'event', ...event }));
    return items.sort((a, b) => a.offsetMs - b.offsetMs || (a.type === 'event' ? -1 : 1));
  }, [timeline, events]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Setlist home">
          <span className="brand-mark"><span /><span /><span /></span>
          <span>setlist<span className="wordmark-dot">.</span></span>
        </a>
        <div className="topbar-right">
          <span className="playback-note"><span className="live-dot" /> PLAY IN ORDER</span>
          <button className="icon-button settings-toggle" onClick={() => setSettingsOpen((open) => !open)} aria-label="Settings" title="Settings">
            <Settings2 size={18} />
          </button>
          {isConnected && <button className="icon-button" onClick={signOut} aria-label="Disconnect Spotify" title="Disconnect Spotify"><LogOut size={17} /></button>}
        </div>
      </header>

      <main id="top" className="main-content">
        <section className="intro-row">
          <div>
            <p className="eyebrow">YOUR NIGHT, IN SEQUENCE</p>
            <h1>Know what’s playing <span>when.</span></h1>
            <p className="intro-copy">Map the moments that matter to the songs that get you there.</p>
          </div>
          <div className="header-stamp" aria-hidden="true">
            <div className="stamp-ring"><Music2 size={20} /><span>NO SHUFFLE</span><span>JUST THE FLOW</span></div>
          </div>
        </section>

        <section className="source-bar" aria-label="Playlist source">
          <div className="source-icon"><Link2 size={19} /></div>
          <div className="source-field">
            <label htmlFor="playlist-url">SPOTIFY PLAYLIST</label>
            <input
              id="playlist-url"
              type="url"
              placeholder="Paste a playlist link"
              value={playlistUrl}
              onChange={(event) => {
                setPlaylistUrl(event.target.value);
                persist(STORAGE.playlistUrl, event.target.value);
              }}
              onKeyDown={(event) => { if (event.key === 'Enter') connectSpotify(); }}
            />
          </div>
          <button className="connect-button" onClick={connectSpotify} disabled={loading}>
            {loading ? <LoaderCircle size={16} className="spin" /> : isConnected && !demoMode ? <Check size={16} /> : <Headphones size={16} />}
            <span>{loading ? 'Loading' : isConnected && !demoMode ? 'Connected' : 'Connect playlist'}</span>
          </button>
          <button className="sample-button" onClick={loadSample}>Try sample</button>
        </section>
        {error && <div className="error-message" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={15} /></button></div>}

        {settingsOpen && (
          <section className="settings-panel" aria-label="Spotify settings">
            <div className="settings-heading"><div><Settings2 size={16} /><strong>Spotify app settings</strong></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Close settings"><X size={17} /></button></div>
            <label htmlFor="client-id">CLIENT ID</label>
            <div className="settings-input-row">
              <input id="client-id" value={clientId} onChange={(event) => { setClientId(event.target.value); persist(STORAGE.clientId, event.target.value); }} placeholder="Your Spotify app client ID" />
              <button onClick={() => setSettingsOpen(false)}>Done</button>
            </div>
            <p>Register this redirect URI in your Spotify Developer Dashboard: <code>{redirectUri}</code></p>
          </section>
        )}

        {playlist && tracks.length > 0 ? (
          <>
            <section className="playlist-summary">
              <div className="playlist-identity">
                {playlist.image ? <img className="playlist-cover" src={playlist.image} alt="" /> : <div className="playlist-cover cover-fallback"><Music2 size={21} /></div>}
                <div className="playlist-meta">
                  <p className="eyebrow">NOW PLANNING</p>
                  <h2>{playlist.name}</h2>
                  <span>{playlist.owner} <i /> {tracks.length} tracks <i /> {formatTotal(totalDuration)}</span>
                </div>
              </div>
              <div className="start-time-control">
                <label htmlFor="start-time"><Clock3 size={15} /> STARTS AT</label>
                <div className="time-input-wrap"><input id="start-time" type="time" value={startTime} onChange={(event) => updateStartTime(event.target.value)} /><ChevronDown size={14} /></div>
              </div>
              <button className="refresh-button" onClick={refreshPlaylist} disabled={loading} title="Reload tracks from Spotify">
                {loading ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}
                <span>Refresh</span>
              </button>
            </section>

            <section className="timeline-section">
              <div className="timeline-heading">
                <div><p className="eyebrow">THE RUN OF SHOW</p><h2>Timeline <span>{formatClock(startMinutes)} start</span></h2></div>
                <button className="add-event-button" onClick={() => setEventOpen((open) => !open)}><Plus size={16} /> Add event</button>
              </div>

              {eventOpen && (
                <form className="event-form" onSubmit={addEvent}>
                  <div className="event-form-title"><CalendarDays size={17} /><strong>Pin a moment</strong><span>We’ll find the song playing then.</span></div>
                  <input aria-label="Event name" autoFocus placeholder="e.g. Cake, last call, midnight" value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} />
                  <input aria-label="Event time" type="time" value={eventTime} onChange={(event) => setEventTime(event.target.value)} />
                  <select aria-label="Event day" value={eventDay} onChange={(event) => setEventDay(event.target.value)}>
                    <option value="0">Day 1</option><option value="1">Day 2</option><option value="2">Day 3</option>
                  </select>
                  <button type="submit" className="event-save-button"><Check size={15} /> Add</button>
                  <button type="button" className="icon-button" onClick={() => setEventOpen(false)} aria-label="Cancel"><X size={16} /></button>
                </form>
              )}

              <div className="timeline-card">
                <div className="timeline-topline"><span>START</span><span>{formatClock(startMinutes)}</span></div>
                <div className="timeline-list">
                  {timelineItems.map((item) => {
                    const time = formatClock(startMinutes + Math.floor(item.offsetMs / 60000));
                    if (item.type === 'event') {
                      const track = timeline.find((entry) => item.offsetMs >= entry.startMs && item.offsetMs < entry.endMs);
                      const minuteInto = track ? Math.floor((item.offsetMs - track.startMs) / 60000) : 0;
                      return (
                        <div className="event-marker" key={item.id}>
                          <div className="event-axis"><span className="event-pin"><CalendarDays size={12} /></span><span>{time}</span></div>
                          <div className="event-content">
                            <div className="event-rule" />
                            <div className="event-label"><strong>{item.title}</strong><span>{track ? `During “${track.name}” · ${minuteInto} min in` : 'After the playlist ends'}</span></div>
                            <button onClick={() => removeEvent(item.id)} aria-label={`Remove ${item.title}`} title="Remove event"><X size={14} /></button>
                          </div>
                        </div>
                      );
                    }
                    const isFirst = item.index === 0;
                    return (
                      <article className={`track-row ${isFirst ? 'first-track' : ''}`} key={`${item.id}-${item.index}`} title={`${item.name} starts at ${time} · ${formatDuration(item.duration_ms)}`}>
                        <div className="track-axis"><span className="axis-time">{time}</span><span className="axis-dot" /></div>
                        <div className="track-card">
                          <span className="track-index">{String(item.index + 1).padStart(2, '0')}</span>
                          {item.image ? <img src={item.image} alt="" className="track-art" /> : <span className="track-art track-art-fallback"><Music2 size={15} /></span>}
                          <div className="track-info"><strong>{item.name}</strong><span>{item.artists.join(', ')}</span></div>
                          <span className="track-album">{item.album}</span>
                          <span className="track-duration">{formatDuration(item.duration_ms)}</span>
                          {item.url && <a className="track-open" href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.name} in Spotify`}><ExternalLink size={14} /></a>}
                        </div>
                        <div className="track-hover-time"><span>{time}</span><span>through {formatClock(startMinutes + Math.ceil(item.endMs / 60000))}</span></div>
                      </article>
                    );
                  })}
                </div>
                <div className="timeline-bottomline"><span>END OF PLAYLIST</span><span>{formatClock(startMinutes + Math.ceil(totalDuration / 60000))}</span></div>
              </div>
              <div className="timeline-footnote"><span><ArrowDownUp size={14} /> Track order follows Spotify</span><span>Times are estimates; fades and crossfades may shift them.</span></div>
            </section>
          </>
        ) : (
          <section className="empty-state">
            <div className="empty-art" aria-hidden="true"><div className="vinyl-disc"><div className="vinyl-center"><span className="brand-mark"><span /><span /><span /></span></div></div><span className="orbit orbit-one" /><span className="orbit orbit-two" /></div>
            <p className="eyebrow">THE NIGHT HAS A SOUNDTRACK</p>
            <h2>Put the playlist<br />on the clock.</h2>
            <p>Connect an ordered Spotify playlist or explore the sample to map your night.</p>
            <button className="empty-sample-button" onClick={loadSample}><Music2 size={16} /> Explore sample playlist</button>
            <span className="empty-hint">Need a Spotify app? <button onClick={() => setSettingsOpen(true)}>Set it up here <ExternalLink size={12} /></button></span>
          </section>
        )}
        {lastUpdated && <div className="updated-note"><Check size={13} /> Synced from Spotify at {lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>}
      </main>
      <footer className="footer"><span>setlist<span className="wordmark-dot">.</span></span><span>Made for nights that unfold in order.</span></footer>
    </div>
  );
}

export default App;