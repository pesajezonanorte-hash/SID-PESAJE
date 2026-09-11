/* ========================================
   SoundWave — MP3 Player Application Logic
   ======================================== */

(function () {
    'use strict';

    // ── DOM Elements ──
    const $ = (s) => document.querySelector(s);
    const audio = $('#audioPlayer');
    const fileInput = $('#fileInput');
    const btnAddFiles = $('#btnAddFiles');
    const btnPlay = $('#btnPlay');
    const btnPrev = $('#btnPrev');
    const btnNext = $('#btnNext');
    const btnShuffle = $('#btnShuffle');
    const btnRepeat = $('#btnRepeat');
    const btnMute = $('#btnMute');
    const iconPlay = btnPlay.querySelector('.icon-play');
    const iconPause = btnPlay.querySelector('.icon-pause');
    const iconVol = btnMute.querySelector('.icon-vol');
    const iconMute = btnMute.querySelector('.icon-mute');
    const trackTitle = $('#trackTitle');
    const trackArtist = $('#trackArtist');
    const timeCurrent = $('#timeCurrent');
    const timeTotal = $('#timeTotal');
    const progressTrack = $('#progressTrack');
    const progressFill = $('#progressFill');
    const progressThumb = $('#progressThumb');
    const volumeBar = $('#volumeBar');
    const volumeFill = $('#volumeFill');
    const volumeThumb = $('#volumeThumb');
    const playlistEl = $('#playlist');
    const emptyState = $('#emptyState');
    const trackCount = $('#trackCount');
    const dropOverlay = $('#dropOverlay');
    const albumArt = $('#albumArt');
    const visualizer = $('#visualizer');
    const vizBars = visualizer.querySelectorAll('.viz-bar');

    // ── State ──
    let playlist = [];         // { name, file, objectURL, duration }
    let currentIndex = -1;
    let isPlaying = false;
    let isShuffle = false;
    let repeatMode = 0;        // 0=off, 1=all, 2=one
    let isSeeking = false;
    let savedVolume = 0.8;
    let vizInterval = null;

    // ── Init ──
    audio.volume = savedVolume;
    updateVolumeUI(savedVolume);

    // ── File Input ──
    btnAddFiles.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', (e) => {
        addFiles(Array.from(e.target.files));
        fileInput.value = '';
    });

    // ── Drag & Drop ──
    let dragCounter = 0;
    document.addEventListener('dragenter', (e) => {
        e.preventDefault();
        dragCounter++;
        dropOverlay.classList.add('visible');
    });
    document.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dragCounter--;
        if (dragCounter <= 0) {
            dragCounter = 0;
            dropOverlay.classList.remove('visible');
        }
    });
    document.addEventListener('dragover', (e) => e.preventDefault());
    document.addEventListener('drop', (e) => {
        e.preventDefault();
        dragCounter = 0;
        dropOverlay.classList.remove('visible');
        const files = Array.from(e.dataTransfer.files).filter(f =>
            f.type.startsWith('audio/') || f.name.toLowerCase().endsWith('.mp3')
        );
        if (files.length) addFiles(files);
    });

    // ── Add Files ──
    function addFiles(files) {
        files.forEach(file => {
            const objectURL = URL.createObjectURL(file);
            const name = cleanName(file.name);
            playlist.push({ name, file, objectURL, duration: 0 });

            // Get duration
            const tempAudio = new Audio();
            tempAudio.src = objectURL;
            const idx = playlist.length - 1;
            tempAudio.addEventListener('loadedmetadata', () => {
                playlist[idx].duration = tempAudio.duration;
                updatePlaylistUI();
            });
        });
        updatePlaylistUI();
        if (currentIndex === -1 && playlist.length > 0) {
            loadTrack(0);
        }
    }

    function cleanName(filename) {
        return filename.replace(/\.[^/.]+$/, '').replace(/_/g, ' ').replace(/-/g, ' — ');
    }

    // ── Load & Play ──
    function loadTrack(index) {
        if (index < 0 || index >= playlist.length) return;
        currentIndex = index;
        const track = playlist[currentIndex];
        audio.src = track.objectURL;
        trackTitle.textContent = track.name;
        trackArtist.textContent = `Pista ${index + 1} de ${playlist.length}`;
        updatePlaylistUI();
        audio.addEventListener('loadedmetadata', function onMeta() {
            timeTotal.textContent = formatTime(audio.duration);
            audio.removeEventListener('loadedmetadata', onMeta);
        });
    }

    function playTrack() {
        if (playlist.length === 0) return;
        if (currentIndex === -1) loadTrack(0);
        audio.play().then(() => {
            isPlaying = true;
            updatePlayPause();
            albumArt.classList.add('spinning');
            startVisualizer();
        }).catch(() => {});
    }

    function pauseTrack() {
        audio.pause();
        isPlaying = false;
        updatePlayPause();
        albumArt.classList.remove('spinning');
        stopVisualizer();
    }

    function updatePlayPause() {
        iconPlay.style.display = isPlaying ? 'none' : 'block';
        iconPause.style.display = isPlaying ? 'block' : 'none';
    }

    // ── Controls ──
    btnPlay.addEventListener('click', () => {
        if (isPlaying) pauseTrack();
        else playTrack();
    });

    btnNext.addEventListener('click', nextTrack);
    btnPrev.addEventListener('click', prevTrack);

    function nextTrack() {
        if (playlist.length === 0) return;
        let next;
        if (isShuffle) {
            next = Math.floor(Math.random() * playlist.length);
            if (playlist.length > 1) while (next === currentIndex) next = Math.floor(Math.random() * playlist.length);
        } else {
            next = currentIndex + 1;
            if (next >= playlist.length) {
                if (repeatMode >= 1) next = 0;
                else { pauseTrack(); return; }
            }
        }
        loadTrack(next);
        playTrack();
    }

    function prevTrack() {
        if (playlist.length === 0) return;
        if (audio.currentTime > 3) {
            audio.currentTime = 0;
            return;
        }
        let prev = currentIndex - 1;
        if (prev < 0) prev = playlist.length - 1;
        loadTrack(prev);
        playTrack();
    }

    btnShuffle.addEventListener('click', () => {
        isShuffle = !isShuffle;
        btnShuffle.classList.toggle('active', isShuffle);
    });

    btnRepeat.addEventListener('click', () => {
        repeatMode = (repeatMode + 1) % 3;
        btnRepeat.classList.toggle('active', repeatMode > 0);
        if (repeatMode === 2) {
            btnRepeat.style.position = 'relative';
            if (!btnRepeat.querySelector('.repeat-badge')) {
                const badge = document.createElement('span');
                badge.className = 'repeat-badge';
                badge.textContent = '1';
                badge.style.cssText = 'position:absolute;bottom:2px;right:2px;font-size:9px;font-weight:700;color:var(--accent-light);';
                btnRepeat.appendChild(badge);
            }
        } else {
            const badge = btnRepeat.querySelector('.repeat-badge');
            if (badge) badge.remove();
        }
    });

    // Track ended
    audio.addEventListener('ended', () => {
        if (repeatMode === 2) {
            audio.currentTime = 0;
            audio.play();
        } else {
            nextTrack();
        }
    });

    // ── Progress ──
    audio.addEventListener('timeupdate', () => {
        if (isSeeking || !audio.duration) return;
        const pct = (audio.currentTime / audio.duration) * 100;
        progressFill.style.width = pct + '%';
        progressThumb.style.left = pct + '%';
        timeCurrent.textContent = formatTime(audio.currentTime);
    });

    // Click to seek
    progressTrack.parentElement.addEventListener('mousedown', startSeek);
    progressTrack.parentElement.addEventListener('touchstart', startSeek, { passive: true });

    function startSeek(e) {
        if(e.cancelable) e.preventDefault();
        isSeeking = true;
        seek(e);
        const moveEvt = e.type === 'mousedown' ? 'mousemove' : 'touchmove';
        const upEvt = e.type === 'mousedown' ? 'mouseup' : 'touchend';
        const onMove = (ev) => seek(ev);
        const onUp = () => {
            isSeeking = false;
            document.removeEventListener(moveEvt, onMove);
            document.removeEventListener(upEvt, onUp);
        };
        document.addEventListener(moveEvt, onMove);
        document.addEventListener(upEvt, onUp);
    }

    function seek(e) {
        const rect = progressTrack.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let pct = (clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        progressFill.style.width = (pct * 100) + '%';
        progressThumb.style.left = (pct * 100) + '%';
        if (audio.duration) {
            audio.currentTime = pct * audio.duration;
            timeCurrent.textContent = formatTime(audio.currentTime);
        }
    }

    // ── Volume ──
    volumeBar.addEventListener('mousedown', startVolumeDrag);
    volumeBar.addEventListener('touchstart', startVolumeDrag, { passive: true });

    function startVolumeDrag(e) {
        if(e.cancelable) e.preventDefault();
        setVolume(e);
        const moveEvt = e.type === 'mousedown' ? 'mousemove' : 'touchmove';
        const upEvt = e.type === 'mousedown' ? 'mouseup' : 'touchend';
        const onMove = (ev) => setVolume(ev);
        const onUp = () => {
            document.removeEventListener(moveEvt, onMove);
            document.removeEventListener(upEvt, onUp);
        };
        document.addEventListener(moveEvt, onMove);
        document.addEventListener(upEvt, onUp);
    }

    function setVolume(e) {
        const rect = volumeBar.querySelector('.volume-track').getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        let pct = (clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        audio.volume = pct;
        savedVolume = pct;
        updateVolumeUI(pct);
        updateMuteIcon();
    }

    function updateVolumeUI(pct) {
        volumeFill.style.width = (pct * 100) + '%';
        volumeThumb.style.left = (pct * 100) + '%';
    }

    btnMute.addEventListener('click', () => {
        if (audio.volume > 0) {
            savedVolume = audio.volume;
            audio.volume = 0;
            updateVolumeUI(0);
        } else {
            audio.volume = savedVolume || 0.5;
            updateVolumeUI(audio.volume);
        }
        updateMuteIcon();
    });

    function updateMuteIcon() {
        const muted = audio.volume === 0;
        iconVol.style.display = muted ? 'none' : 'block';
        iconMute.style.display = muted ? 'block' : 'none';
    }

    // ── Playlist UI ──
    function updatePlaylistUI() {
        // Update count
        trackCount.textContent = `${playlist.length} cancion${playlist.length !== 1 ? 'es' : ''}`;

        // Show/hide empty state
        emptyState.style.display = playlist.length === 0 ? 'flex' : 'none';

        // Render list
        playlistEl.innerHTML = '';
        playlist.forEach((track, i) => {
            const li = document.createElement('li');
            li.className = 'playlist-item' + (i === currentIndex ? ' active' : '');
            li.innerHTML = `
                <div class="item-index">
                    <span class="item-index-num">${i + 1}</span>
                    <svg class="item-play-icon" viewBox="0 0 24 24" fill="currentColor">
                        ${i === currentIndex && isPlaying
                            ? '<rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/>'
                            : '<polygon points="5 3 19 12 5 21 5 3"/>'}
                    </svg>
                </div>
                <div class="item-info">
                    <div class="item-name">${track.name}</div>
                </div>
                <span class="item-duration">${track.duration ? formatTime(track.duration) : '—'}</span>
                <button class="item-remove" title="Eliminar">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            `;

            // Click to play
            li.addEventListener('click', (e) => {
                if (e.target.closest('.item-remove')) return;
                loadTrack(i);
                playTrack();
            });

            // Remove
            li.querySelector('.item-remove').addEventListener('click', (e) => {
                e.stopPropagation();
                removeTrack(i);
            });

            playlistEl.appendChild(li);
        });
    }

    function removeTrack(index) {
        URL.revokeObjectURL(playlist[index].objectURL);
        playlist.splice(index, 1);

        if (playlist.length === 0) {
            currentIndex = -1;
            audio.src = '';
            trackTitle.textContent = 'Sin reproducir';
            trackArtist.textContent = 'Agrega archivos MP3 para comenzar';
            timeCurrent.textContent = '0:00';
            timeTotal.textContent = '0:00';
            progressFill.style.width = '0%';
            progressThumb.style.left = '0%';
            pauseTrack();
        } else if (index === currentIndex) {
            const next = currentIndex >= playlist.length ? 0 : currentIndex;
            loadTrack(next);
            if (isPlaying) playTrack();
        } else if (index < currentIndex) {
            currentIndex--;
        }
        updatePlaylistUI();
    }

    // ── Fake Visualizer ──
    function startVisualizer() {
        visualizer.classList.add('active');
        if (vizInterval) clearInterval(vizInterval);
        vizInterval = setInterval(() => {
            vizBars.forEach(bar => {
                const h = Math.random() * 38 + 6;
                bar.style.height = h + 'px';
            });
        }, 150);
    }

    function stopVisualizer() {
        visualizer.classList.remove('active');
        if (vizInterval) clearInterval(vizInterval);
        vizBars.forEach(bar => bar.style.height = '6px');
    }

    // ── Helpers ──
    function formatTime(sec) {
        if (!sec || isNaN(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${s.toString().padStart(2, '0')}`;
    }

    // ── Keyboard ──
    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        switch (e.code) {
            case 'Space':
                e.preventDefault();
                if (isPlaying) pauseTrack();
                else playTrack();
                break;
            case 'ArrowRight':
                e.preventDefault();
                if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
                break;
            case 'ArrowLeft':
                e.preventDefault();
                audio.currentTime = Math.max(0, audio.currentTime - 5);
                break;
            case 'ArrowUp':
                e.preventDefault();
                audio.volume = Math.min(1, audio.volume + 0.05);
                savedVolume = audio.volume;
                updateVolumeUI(audio.volume);
                updateMuteIcon();
                break;
            case 'ArrowDown':
                e.preventDefault();
                audio.volume = Math.max(0, audio.volume - 0.05);
                updateVolumeUI(audio.volume);
                updateMuteIcon();
                break;
            case 'KeyN':
                nextTrack();
                break;
            case 'KeyP':
                prevTrack();
                break;
            case 'KeyM':
                btnMute.click();
                break;
        }
    });

    // ══════════════════════════════════════
    // ── Tab Switching ──
    // ══════════════════════════════════════
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panelQueue = $('#panelQueue');
    const panelYoutube = $('#panelYoutube');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const tab = btn.dataset.tab;
            panelQueue.classList.toggle('active', tab === 'queue');
            panelYoutube.classList.toggle('active', tab === 'youtube');
            if (tab === 'youtube') {
                const input = $('#ytSearchInput');
                setTimeout(() => input.focus(), 100);
            }
        });
    });

    // ══════════════════════════════════════
    // ── YouTube Search via Piped API ──
    // ══════════════════════════════════════
    // Piped API has CORS enabled by default, unlike Invidious
    const PIPED_INSTANCES = [
        'https://pipedapi.kavin.rocks',
        'https://pipedapi.r4fo.com',
        'https://api.piped.privacydev.net',
        'https://pipedapi.in.projectsegfau.lt',
        'https://pipedapi.leptons.xyz'
    ];
    let currentInstance = 0;

    const ytSearchInput = $('#ytSearchInput');
    const btnYtSearch = $('#btnYtSearch');
    const ytResults = $('#ytResults');
    const ytEmpty = $('#ytEmpty');
    const ytLoading = $('#ytLoading');
    const ytError = $('#ytError');
    const ytErrorMsg = $('#ytErrorMsg');
    const btnRetry = $('#btnRetry');
    let lastQuery = '';

    btnYtSearch.addEventListener('click', () => doYtSearch());
    ytSearchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') doYtSearch();
    });
    btnRetry.addEventListener('click', () => doYtSearch(lastQuery));

    async function pipedFetch(path, timeout = 10000) {
        let triedInstances = 0;
        while (triedInstances < PIPED_INSTANCES.length) {
            const instance = PIPED_INSTANCES[currentInstance];
            try {
                const resp = await fetch(`${instance}${path}`, {
                    signal: AbortSignal.timeout(timeout)
                });
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                return await resp.json();
            } catch (err) {
                console.warn(`Piped instance ${instance} failed:`, err.message);
                currentInstance = (currentInstance + 1) % PIPED_INSTANCES.length;
                triedInstances++;
            }
        }
        return null;
    }

    async function doYtSearch(queryOverride) {
        const query = queryOverride || ytSearchInput.value.trim();
        if (!query) return;
        lastQuery = query;

        // Show loading
        ytEmpty.style.display = 'none';
        ytError.style.display = 'none';
        ytResults.innerHTML = '';
        ytLoading.style.display = 'flex';

        const data = await pipedFetch(`/search?q=${encodeURIComponent(query)}&filter=music_songs`, 8000);

        ytLoading.style.display = 'none';

        if (!data || !data.items) {
            // Retry without filter
            const data2 = await pipedFetch(`/search?q=${encodeURIComponent(query)}&filter=videos`, 8000);
            if (!data2 || !data2.items) {
                ytErrorMsg.textContent = 'No se pudo conectar. Intenta de nuevo.';
                ytError.style.display = 'flex';
                return;
            }
            const videos = data2.items.filter(item => item.type === 'stream').slice(0, 20);
            if (videos.length === 0) {
                ytErrorMsg.textContent = 'Sin resultados para esta búsqueda.';
                ytError.style.display = 'flex';
                return;
            }
            renderYtResults(videos);
            return;
        }

        // Filter to streams (videos)
        const videos = data.items.filter(item => item.type === 'stream').slice(0, 20);
        if (videos.length === 0) {
            ytErrorMsg.textContent = 'Sin resultados para esta búsqueda.';
            ytError.style.display = 'flex';
            return;
        }

        renderYtResults(videos);
    }

    function renderYtResults(videos) {
        ytResults.innerHTML = '';
        videos.forEach(video => {
            const li = document.createElement('li');
            li.className = 'yt-result-item';
            const thumbUrl = video.thumbnail || '';
            const duration = video.duration > 0 ? formatTime(video.duration) : '';
            // Piped url format: /watch?v=VIDEO_ID
            const videoId = video.url ? video.url.replace('/watch?v=', '') : '';

            li.innerHTML = `
                <div class="yt-thumb">
                    <img src="${thumbUrl}" alt="" loading="lazy" onerror="this.style.display='none'">
                    ${duration ? `<span class="yt-thumb-duration">${duration}</span>` : ''}
                </div>
                <div class="yt-result-info">
                    <div class="yt-result-title">${escapeHtml(video.title || '')}</div>
                    <div class="yt-result-channel">${escapeHtml(video.uploaderName || video.uploader || '')}</div>
                </div>
                <button class="yt-result-add" title="Agregar a la cola">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M12 5v14M5 12h14"/>
                    </svg>
                </button>
            `;

            const addBtn = li.querySelector('.yt-result-add');

            // Click the whole row to add & play
            li.addEventListener('click', (e) => {
                if (e.target.closest('.yt-result-add')) return;
                addYtTrack(video, videoId, li, addBtn, true);
            });

            // Click + button to just add to queue
            addBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                addYtTrack(video, videoId, li, addBtn, false);
            });

            ytResults.appendChild(li);
        });
    }

    async function addYtTrack(video, videoId, liEl, addBtn, autoPlay) {
        if (liEl.classList.contains('adding')) return;
        liEl.classList.add('adding');

        try {
            const info = await pipedFetch(`/streams/${videoId}`, 12000);
            if (!info) throw new Error('Failed to fetch stream info');

            // Find best audio stream from Piped response
            let audioUrl = null;
            if (info.audioStreams && info.audioStreams.length > 0) {
                // Sort by bitrate descending, prefer m4a/mp4 formats
                const sorted = info.audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));
                const preferred = sorted.find(s => s.mimeType && s.mimeType.includes('audio/mp4')) || sorted[0];
                audioUrl = preferred.url;
            }

            if (!audioUrl) {
                // Fallback: use HLS stream if available
                if (info.hls) {
                    audioUrl = info.hls;
                } else {
                    throw new Error('No audio stream found');
                }
            }

            // Add to playlist
            const track = {
                name: video.title || info.title || 'YouTube Track',
                artist: video.uploaderName || video.uploader || info.uploader || 'YouTube',
                objectURL: audioUrl,
                duration: video.duration || info.duration || 0,
                ytVideoId: videoId,
                thumbnail: video.thumbnail || info.thumbnailUrl || ''
            };

            playlist.push(track);
            updatePlaylistUI();

            // Visual feedback
            addBtn.classList.add('added');
            addBtn.innerHTML = `
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            `;

            if (autoPlay) {
                loadTrack(playlist.length - 1);
                playTrack();
                // Switch to queue tab
                tabBtns.forEach(b => b.classList.remove('active'));
                $('#tabQueue').classList.add('active');
                panelQueue.classList.add('active');
                panelYoutube.classList.remove('active');
            }

        } catch (err) {
            console.error('Failed to add YouTube track:', err);
            addBtn.style.color = '#f87171';
            addBtn.style.opacity = '1';
            setTimeout(() => {
                addBtn.style.color = '';
                addBtn.style.opacity = '';
            }, 2000);
        } finally {
            liEl.classList.remove('adding');
        }
    }

    // ── Update loadTrack to handle YT thumbnail ──
    const origLoadTrack = loadTrack;
    loadTrack = function(index) {
        origLoadTrack(index);
        if (index >= 0 && index < playlist.length) {
            const track = playlist[index];
            if (track.thumbnail) {
                albumArt.innerHTML = `
                    <img src="${track.thumbnail}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">
                    <div class="vinyl-ring"></div>
                `;
            } else {
                albumArt.innerHTML = `
                    <div class="album-art-placeholder">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M9 18V5l12-2v13"/>
                            <circle cx="6" cy="18" r="3"/>
                            <circle cx="18" cy="16" r="3"/>
                        </svg>
                    </div>
                    <div class="vinyl-ring"></div>
                `;
            }
            if (track.artist) {
                trackArtist.textContent = track.artist;
            }
        }
    };

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.textContent = str;
        return d.innerHTML;
    }

})();

