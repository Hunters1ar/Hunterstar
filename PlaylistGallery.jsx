import { useState, useEffect } from "react";
import "./PlaylistGallery.css";

const API_KEY = "AIzaSyAfm_Qbui0g02Mi91utkH0pen9XBT7u_kQ";
const PLAYLIST_ID = "playlist?list=PLrEYU1gx-0UOsV8mDxgkbBc_qqleKsRxW";

export default function PlaylistGallery() {
  const [videos, setVideos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    const controller = new AbortController();

    async function fetchAll() {
      try {
        let items = [];
        let pageToken = "";

        do {
          const url =
            `https://www.googleapis.com/youtube/v3/playlistItems` +
            `?part=snippet,contentDetails` +
            `&playlistId=${PLAYLIST_ID}` +
            `&maxResults=50` +
            (pageToken ? `&pageToken=${pageToken}` : "") +
            `&key=${API_KEY}`;

          const res = await fetch(url, { signal: controller.signal });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(
              body?.error?.message || `YouTube API error ${res.status}`
            );
          }
          const data = await res.json();

          const mapped = data.items
            .filter((i) => i.snippet?.thumbnails) 
            .map((i) => ({
              id: i.contentDetails.videoId,
              title: i.snippet.title,
              thumb:
                i.snippet.thumbnails.maxres?.url ||
                i.snippet.thumbnails.standard?.url ||
                i.snippet.thumbnails.high?.url ||
                i.snippet.thumbnails.medium.url,
            }));

          items = items.concat(mapped);
          pageToken = data.nextPageToken || "";
        } while (pageToken);

        setVideos(items);
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") setActive(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (loading)
    return <div className="pg-state">Loading videos…</div>;

  if (error)
    return <div className="pg-state pg-error">Couldn’t load videos: {error}</div>;

  if (videos.length === 0)
    return <div className="pg-state">No videos found in this playlist.</div>;

  return (
    <section className="pg-wrap">
      <div className="pg-grid">
        {videos.map((v) => (
          <button
            key={v.id}
            className="pg-card"
            onClick={() => setActive(v.id)}
            aria-label={`Play ${v.title}`}
          >
            <div className="pg-thumb">
              <img src={v.thumb} alt={v.title} loading="lazy" />
              <span className="pg-play" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="22" height="22">
                  <path d="M8 5v14l11-7z" fill="currentColor" />
                </svg>
              </span>
            </div>
            <h3 className="pg-title">{v.title}</h3>
          </button>
        ))}
      </div>

      {active && (
        <div className="pg-overlay" onClick={() => setActive(null)}>
          <div className="pg-modal" onClick={(e) => e.stopPropagation()}>
            <button
              className="pg-close"
              onClick={() => setActive(null)}
              aria-label="Close"
            >
              ×
            </button>
            <div className="pg-player">
              <iframe
                src={`https://www.youtube.com/embed/${active}?autoplay=1`}
                title="YouTube video player"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
