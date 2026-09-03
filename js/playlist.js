(function () {
  "use strict";
  var API_BASE = window.PLAYLIST_API_BASE || (location.hostname === "localhost" || location.hostname === "127.0.0.1" ? "http://localhost:3001" : "https://api.hunterstar.uz");
  var mount = document.getElementById("playlistApp"); if (!mount) return;
  var tracks = [], queue = [], active = null, playing = false, favorites = read("hunterstar-favorites"), recent = read("hunterstar-recent");
  var isShuffle = false;
  var ytPlayer = null;
  var ytReady = false;
  var progressInterval = null;

  var icon = { 
    play:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>', 
    pause:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>', 
    back:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M11 6 5 12l6 6M6 12h13"/></svg>', 
    next:'<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="m13 6 6 6-6 6M18 12H5"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M10.59 9.17L5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41l-1.41 1.41 3.13 3.13L14.5 20H20v-5.5l-2.04 2.04-3.13-3.13z"/></svg>',
    expand: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14zm-10-7h9v6h-9z"/></svg>',
    popout: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>'
  };

  window.onYouTubeIframeAPIReady = function() {
      ytReady = true;
      if (active && !ytPlayer) createYTPlayer(active.id);
  };
  var tag = document.createElement('script');
  tag.src = "https://www.youtube.com/iframe_api";
  var firstScriptTag = document.getElementsByTagName('script')[0];
  if(firstScriptTag) firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
  else document.head.appendChild(tag);

  function createYTPlayer(videoId) {
      var ytContainer = document.getElementById("hunterstar-yt-container");
      if (!ytContainer) {
          ytContainer = document.createElement("div");
          ytContainer.id = "hunterstar-yt-container";
          ytContainer.className = "yt-hidden";
          ytContainer.innerHTML = '<button id="ytCloseBtn" aria-label="Close Video"><svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor"><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/></svg></button><div id="hunterstar-yt-player"></div>';
          document.body.appendChild(ytContainer);
          document.getElementById("ytCloseBtn").onclick = function() {
              ytContainer.classList.remove("yt-expanded");
              ytContainer.classList.add("yt-hidden");
          };
      }
      ytPlayer = new YT.Player('hunterstar-yt-player', {
          height: '1', width: '1', videoId: videoId,
          playerVars: { 'autoplay': 1, 'controls': 1, 'playsinline': 1 },
          events: {
              'onReady': function(e) { if (playing) e.target.playVideo(); },
              'onStateChange': function(e) {
                  if (e.data === YT.PlayerState.PLAYING && !playing) {
                      playing = true; render();
                  } else if (e.data === YT.PlayerState.PAUSED && playing) {
                      playing = false; render();
                  } else if (e.data === YT.PlayerState.ENDED) {
                      playNextTrack();
                  }
              }
          }
      });
  }

  function read(k){try{return JSON.parse(localStorage.getItem(k))||[]}catch(e){return[]}} function save(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
  function esc(s){var d=document.createElement("div");d.textContent=s||"";return d.innerHTML} function short(s){return (s||"Untitled track").replace(/\s+/g," ").trim()}
  function state(text,error){mount.innerHTML='<div class="pg-state '+(error?'pg-error':'')+'">'+esc(text)+'</div>'}
  
  function playTrack(t){
    var isNewTrack = (!active || active.id !== t.id);
    active=t; playing=true; recent=[t.id].concat(recent.filter(function(id){return id!==t.id})).slice(0,12);save("hunterstar-recent",recent);
    if (ytReady) {
        if (!ytPlayer) createYTPlayer(t.id);
        else if (isNewTrack) ytPlayer.loadVideoById(t.id);
        else ytPlayer.playVideo();
    }
    render();
  }

  function playNextTrack() {
      var list = queue.length ? queue : tracks;
      var idx = list.findIndex(function(t) { return active && t.id === active.id; });
      if (idx === -1) idx = 0;
      var nextIdx = isShuffle ? Math.floor(Math.random() * list.length) : (idx + 1) % list.length;
      playTrack(list[nextIdx]);
  }

  function playPrevTrack() {
      var list = queue.length ? queue : tracks;
      var idx = list.findIndex(function(t) { return active && t.id === active.id; });
      if (idx === -1) idx = 0;
      var prevIdx = isShuffle ? Math.floor(Math.random() * list.length) : (idx - 1 + list.length) % list.length;
      playTrack(list[prevIdx]);
  }

  function toggleFavorite(t){favorites=favorites.indexOf(t.id)>-1?favorites.filter(function(id){return id!==t.id}):favorites.concat(t.id);save("hunterstar-favorites",favorites);render()}
  
  function formatTime(s) {
      if (!s || isNaN(s)) return "0:00";
      var m = Math.floor(s / 60);
      var sec = Math.floor(s % 60);
      return m + ":" + (sec < 10 ? "0" : "") + sec;
  }

  function render(){
    var searchEl = document.getElementById("playlistSearch");
    var search = searchEl ? searchEl.value : "";
    var hadFocus = searchEl && document.activeElement === searchEl;
    var cursorPos = searchEl ? searchEl.selectionStart : 0;
    
    var source=(document.getElementById("playlistSource")||{}).value||"all", tab=document.querySelector(".pg-tab.is-active"); tab=tab?tab.dataset.tab:"all";
    queue=tracks.filter(function(t){return (!search||short(t.title).toLowerCase().indexOf(search.toLowerCase())>-1)&& (source==="all"||t.source===source) && (tab==="all"||(tab==="favorites"&&favorites.indexOf(t.id)>-1)||(tab==="recent"&&recent.indexOf(t.id)>-1))});
    var sources=[...new Set(tracks.map(function(t){return t.source}))];
    
    mount.innerHTML='<div class="playlist-toolbar"><label class="search-box"><span class="sr-only">Search tracks</span><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></svg><input id="playlistSearch" type="search" placeholder="Search tracks..." value="'+esc(search)+'"></label><label class="source-box"><span class="sr-only">Filter by source</span><select id="playlistSource"><option value="all">All sources</option>'+sources.map(function(s){return '<option value="'+esc(s)+'" '+(source===s?'selected':'')+'>'+esc(s)+'</option>'}).join("")+'</select></label><div class="pg-tabs" role="tablist"><button class="pg-tab '+(tab==="all"?'is-active':'')+'" data-tab="all">All <span>'+tracks.length+'</span></button><button class="pg-tab '+(tab==="favorites"?'is-active':'')+'" data-tab="favorites">Favorites <span>'+favorites.length+'</span></button><button class="pg-tab '+(tab==="recent"?'is-active':'')+'" data-tab="recent">Recently played <span>'+recent.length+'</span></button></div></div><div class="tracklist" role="list">'+(queue.length?queue.map(row).join(""):'<div class="pg-state">No tracks match your filters.</div>')+'</div>'+(active?player():"");
    
    var newSearchEl = document.getElementById("playlistSearch");
    newSearchEl.addEventListener("input",render);
    if (hadFocus) {
        newSearchEl.focus();
        try { newSearchEl.setSelectionRange(cursorPos, cursorPos); } catch(e){}
    }
    
    document.getElementById("playlistSource").addEventListener("change",render);
    mount.querySelectorAll(".pg-tab").forEach(function(b){b.addEventListener("click",function(){mount.querySelectorAll(".pg-tab").forEach(function(x){x.classList.remove("is-active")});b.classList.add("is-active");render()})});
    mount.querySelectorAll(".track-row").forEach(function(r){r.addEventListener("click",function(e){if(!e.target.closest(".favorite-btn"))playTrack(tracks.find(function(t){return t.id===r.dataset.id}))});r.addEventListener("keydown",function(e){if(e.key==="Enter"||e.key===" "){e.preventDefault();playTrack(tracks.find(function(t){return t.id===r.dataset.id}))}})});
    mount.querySelectorAll(".favorite-btn").forEach(function(b){b.addEventListener("click",function(e){e.stopPropagation();toggleFavorite(tracks.find(function(t){return t.id===b.dataset.id}))})});
    var count=document.getElementById("trackCount");if(count)count.textContent=tracks.length;
    
    if(active){
      document.getElementById("playerPrev").onclick = playPrevTrack;
      document.getElementById("playerNext").onclick = playNextTrack;
      document.getElementById("playerShuffle").onclick = function() {
          isShuffle = !isShuffle; render();
      };
      document.getElementById("playerPlay").onclick = function(){
          playing = !playing;
          if (ytPlayer && ytPlayer.playVideo) {
              if (playing) ytPlayer.playVideo(); else ytPlayer.pauseVideo();
          }
          render();
      };
      
      var expandBtn = document.getElementById("playerExpand");
      if (expandBtn) expandBtn.onclick = function() {
          var container = document.getElementById("hunterstar-yt-container");
          if (container) { container.classList.remove("yt-hidden"); container.classList.add("yt-expanded"); }
      };
      
      var pop = document.getElementById("playerPopOut");
      if(pop) pop.onclick=function(){
        save("hunterstar_queue", tracks);
        if(active) save("hunterstar_active_id", active.id);
        var popWin = window.open("player.html", "HunterstarPlayerWindow", "width=900,height=700,menubar=no,toolbar=no,location=no,status=no");
        if (popWin) popWin.focus();
        try {
          var bc = new BroadcastChannel('hunterstar_player_channel');
          bc.postMessage({ type: 'play', id: active ? active.id : (tracks[0] ? tracks[0].id : ''), queue: tracks });
        } catch(e){}
        playing = false; 
        if (ytPlayer && ytPlayer.pauseVideo) ytPlayer.pauseVideo();
        render();
      };
      
      var bar = document.getElementById("playerProgressBar");
      if (bar) {
          bar.addEventListener("mousedown", function() { bar.isDragging = true; });
          bar.addEventListener("touchstart", function() { bar.isDragging = true; }, {passive:true});
          bar.addEventListener("change", function() {
              if (ytPlayer && ytPlayer.seekTo) ytPlayer.seekTo(bar.value, true);
              bar.isDragging = false;
          });
          bar.addEventListener("mouseup", function() { bar.isDragging = false; });
          bar.addEventListener("touchend", function() { bar.isDragging = false; });
      }
      
      if (!progressInterval) {
          progressInterval = setInterval(function() {
              if (ytPlayer && ytPlayer.getCurrentTime && playing) {
                  var current = ytPlayer.getCurrentTime();
                  var duration = ytPlayer.getDuration();
                  var pBar = document.getElementById("playerProgressBar");
                  var curEl = document.getElementById("time-current");
                  var totEl = document.getElementById("time-total");
                  if (pBar && !pBar.isDragging) {
                      pBar.max = duration || 100;
                      pBar.value = current || 0;
                  }
                  if (curEl) curEl.textContent = formatTime(current);
                  if (totEl && duration) totEl.textContent = formatTime(duration);
              }
          }, 500);
      }
    }
  }
  
  function row(t,i){return '<div class="track-row '+(active&&active.id===t.id?'is-active':'')+'" role="listitem" tabindex="0" data-id="'+esc(t.id)+'"><span class="track-index">'+String(i+1).padStart(2,"0")+'</span><img src="'+esc(t.thumb)+'" alt="" loading="lazy"><span class="track-copy"><strong>'+esc(short(t.title))+'</strong><small>'+esc(t.source)+'</small></span><span class="track-status">'+(active&&active.id===t.id&&playing?'<i class="equalizer"><b></b><b></b><b></b></i>':icon.play)+'</span><button class="favorite-btn '+(favorites.indexOf(t.id)>-1?'is-favorite':'')+'" data-id="'+esc(t.id)+'" aria-label="'+(favorites.indexOf(t.id)>-1?'Remove from favorites':'Add to favorites')+'">'+(favorites.indexOf(t.id)>-1?'&#9733;':'&#9734;')+'</button></div>'}
  
  function player(){return '<section class="sticky-player" aria-label="Audio player"><div class="now-playing"><img src="'+esc(active.thumb)+'" alt=""><div><small>NOW PLAYING</small><strong>'+esc(short(active.title))+'</strong><span>'+esc(active.source)+'</span></div></div><div class="player-progress"><span id="time-current">0:00</span><input type="range" id="playerProgressBar" value="0" min="0" step="1"><span id="time-total">0:00</span></div><div class="player-controls"><button id="playerShuffle" aria-label="Shuffle" title="Shuffle" style="'+(isShuffle?'color:var(--color-accent-primary);border-color:var(--color-accent-primary);':'')+'">'+icon.shuffle+'</button><button id="playerPrev" aria-label="Previous track" title="Previous">'+icon.back+'</button><button id="playerPlay" class="player-main" aria-label="'+(playing?'Pause':'Play')+'" title="'+(playing?'Pause':'Play')+'">'+(playing?icon.pause:icon.play)+'</button><button id="playerNext" aria-label="Next track" title="Next">'+icon.next+'</button><button id="playerExpand" aria-label="Watch video" title="Watch video">'+icon.expand+'</button><button id="playerPopOut" aria-label="Open in player" title="Open in player">'+icon.popout+'</button></div></section>'}
  
  state("Loading tracks...",false);fetch(API_BASE+"/api/playlists",{cache:"no-store"}).then(function(r){return r.json().then(function(d){if(!r.ok||d.ok===false)throw Error(d.error||"Request failed");return d.playlists||[]})}).then(function(ps){tracks=[];ps.forEach(function(p){(p.videos||[]).forEach(function(v){tracks.push({id:v.id,title:v.title,thumb:v.thumb,source:p.title||"Playlist"})})});if(!tracks.length)state("No videos found in these playlists.",false);else{save("hunterstar_queue",tracks);render();try{var bc=new BroadcastChannel('hunterstar_player_channel');bc.postMessage({type:'queue_update',queue:tracks});}catch(e){}}}).catch(function(e){state("Couldn't load videos: "+e.message,true)});
})();
