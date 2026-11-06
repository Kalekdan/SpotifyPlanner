# SpotifyPlanner
A timeline planner for playlists that are played in order. Connect a Spotify playlist to see when each track starts, add event markers, and refresh after rearranging the playlist in Spotify.

## Run locally

```sh
npm install
npm run dev
```

To connect Spotify, create a Spotify app in the Spotify Developer Dashboard. Add the local app URL shown by Vite (for example `http://localhost:5173`) as a Redirect URI. Enter the app's client ID in Spotify Planner, then connect a playlist. The app uses Spotify's browser-based PKCE authorization flow; no client secret is needed.
