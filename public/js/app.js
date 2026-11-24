/**
 * SatTrack - Main Application Orchestrator
 * Coordinates Cesium 3D Globe, KeepTrack API V4 data ingestion,
 * OOTK SGP4 orbital propagation, search, and historical simulation.
 */

class App {
  constructor() {
    this.satellites = [];
    this.satMap = new Map(); // noradId -> satRecord
    this.selectedSatellite = null;
    
    // Simulation Clock State
    this.simulationTime = new Date();
    this.simulationSpeed = 1.0; // 1x real-time
    this.isPlaying = true;
    this.lastFrameTime = performance.now();
    this.isScrubbing = false;
    this.currentTimezone = 'Asia/Kolkata'; // Default: India Standard Time (IST, UTC+5:30)

    // Fleet Trajectory Paths Toggle State
    this.showFleetTrajectories = false;

    // Managers
    this.cesium = null;
    this.ui = null;
    this.search = null;

    // Performance metrics
    this.frameCount = 0;
    this.lastFpsUpdate = performance.now();

    this.init();
  }

  async init() {
    console.log('[SatTrack] Initializing Satellite Tracking & Earth Observation Dashboard...');

    // 1. Initialize Cesium 3D Globe
    this.cesium = new CesiumManager('cesiumContainer');

    // 2. Initialize UI Manager
    this.ui = new UIManager();

    // 3. Initialize Global Search Manager
    const searchInput = document.getElementById('globalSearchInput');
    const searchDropdown = document.getElementById('searchResultsDropdown');
    const clearSearchBtn = document.getElementById('clearSearchBtn');
    this.search = new SearchManager(searchInput, searchDropdown, clearSearchBtn);

    // 4. Wire Manager Callbacks
    this.wireCallbacks();

    // 5. Check API Status & Fetch Satellite Catalog
    await this.checkApiStatus();
    await this.loadCatalog();

    // 6. Fetch Auxiliary KeepTrack Data (Launches, Reentries)
    this.loadLaunches();
    this.loadReentries();

    // 7. Initialize Simulation Timeline Controls
    this.initTimelineControls();

    // 8. Start Real-time Animation Loop
    requestAnimationFrame((t) => this.animationLoop(t));

    // Expose app globally for debugging and export tools
    window.app = this;
  }

  wireCallbacks() {
    // 3D Globe Click
    this.cesium.onSatelliteClick = (noradId) => {
      this.selectSatelliteById(noradId);
    };

    // 3D Globe Hover Tooltip
    const tooltip = document.getElementById('globeTooltip');
    this.cesium.onHover = (satRecord, screenPos) => {
      if (satRecord && screenPos) {
        tooltip.innerHTML = `<strong>${satRecord.name}</strong><br><span style="color: var(--text-dim); font-size: 10px;">NORAD: ${satRecord.noradId} • ${satRecord.orbitClass} • Alt: ${Math.round(satRecord.lastLla ? satRecord.lastLla.alt : 400)} km</span>`;
        tooltip.style.left = `${screenPos.x + 15}px`;
        tooltip.style.top = `${screenPos.y - 15}px`;
        tooltip.style.display = 'block';
      } else {
        tooltip.style.display = 'none';
      }
    };

    // Search Result Selection
    this.search.onSelectSatellite = (satRecord) => {
      this.selectSatellite(satRecord, true);
    };
    this.search.onSelectLocation = (lat, lon, height, label) => {
      this.cesium.flyToLocation(lat, lon, height, label);
    };
    this.search.isSatelliteFollowed = (noradId) => {
      return this.cesium && this.cesium.followedSatellites ? this.cesium.followedSatellites.has(noradId) : false;
    };
    this.search.onToggleFollow = (satRecord) => {
      return this.toggleFollowSatellite(satRecord);
    };

    // UI Callbacks
    this.ui.onFilterChange = () => {
      this.renderVirtualList();
    };
    this.ui.onToggleMultiFollow = (satRecord) => {
      this.toggleFollowSatellite(satRecord);
    };
    this.ui.onSelectSatellite = (noradId) => {
      this.selectSatelliteById(noradId);
    };
    this.ui.onFrameAll = () => {
      this.cesium.frameAllFollowedSatellites(this.simulationTime);
    };
    this.ui.onClearAllFollow = () => {
      this.cesium.clearFollowedSatellites();
      this.ui.renderFollowedPills(this.cesium.followedSatellites, this.selectedSatellite ? this.selectedSatellite.noradId : null);
    };
    this.ui.onEpochJump = (targetDate) => {
      this.setSimulationTime(targetDate, true);
    };

    // Non-tracked satellite fleet dimming (90% dim / hide / solo)
    this.ui.onBackgroundFleetChange = (mode, opacity) => {
      this.cesium.setBackgroundFleetDisplay(mode, opacity);
    };

    // API Key Updated in Modal
    this.ui.onKeyUpdated = async () => {
      await this.checkApiStatus();
      await this.loadCatalog(true);
    };

    // Reset View Button
    document.getElementById('resetViewBtn').addEventListener('click', () => {
      this.cesium.resetView();
      const btn = document.getElementById('focusSatBtn');
      if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Follow Satellite';
        btn.style.background = 'var(--accent-cyan)';
      }
    });

    // 2D/3D Scene Mode Toggle Button
    document.getElementById('dimensionToggleBtn').addEventListener('click', () => {
      this.cesium.cycleSceneMode();
    });

    // Focus / Follow Satellite Button with Full Zoom Freedom
    document.getElementById('focusSatBtn').addEventListener('click', () => {
      if (this.selectedSatellite) {
        const btn = document.getElementById('focusSatBtn');
        const isCurrentlyFollowing = this.cesium.isTrackingSelected && 
          this.cesium.followTargetSat && 
          this.cesium.followTargetSat.noradId === this.selectedSatellite.noradId;

        if (isCurrentlyFollowing) {
          this.cesium.stopFollowing();
          btn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Follow Satellite';
          btn.style.background = 'var(--accent-cyan)';
        } else {
          this.cesium.startFollowing(this.selectedSatellite, this.simulationTime);
          btn.innerHTML = '<i class="fa-solid fa-lock"></i> Following (Zoom Free)';
          btn.style.background = 'var(--accent-orange)';
        }
      }
    });

    // Layer Checkboxes
    document.getElementById('layerEsri').addEventListener('change', (e) => {
      this.cesium.setLayerVisibility('esri', e.target.checked);
    });
    document.getElementById('layerLabels').addEventListener('change', (e) => {
      this.cesium.setLayerVisibility('labels', e.target.checked);
    });
    document.getElementById('layerAtmosphere').addEventListener('change', (e) => {
      this.cesium.setLayerVisibility('atmosphere', e.target.checked);
    });
    document.getElementById('layerSunLighting').addEventListener('change', (e) => {
      this.cesium.setLayerVisibility('lighting', e.target.checked);
    });
    document.getElementById('layerGroundTrack').addEventListener('change', (e) => {
      this.cesium.setLayerVisibility('groundTrack', e.target.checked);
    });
    document.getElementById('layerOrbitTrajectory').addEventListener('change', (e) => {
      this.cesium.setLayerVisibility('trajectory', e.target.checked);
    });
    document.getElementById('layerFootprint').addEventListener('change', (e) => {
      this.cesium.toggleFootprints(e.target.checked);
    });

    // Fleet Trajectory Checkbox & Button Controls (Synced in Fleet drawer & Layers drawer)
    const toggleFleetTraj = document.getElementById('toggleFleetTrajectories');
    if (toggleFleetTraj) {
      toggleFleetTraj.addEventListener('change', (e) => {
        this.setFleetTrajectories(e.target.checked);
      });
    }

    const layerFleetTraj = document.getElementById('layerFleetTrajectories');
    if (layerFleetTraj) {
      layerFleetTraj.addEventListener('change', (e) => {
        this.setFleetTrajectories(e.target.checked);
      });
    }

    const btnToggleOrbits = document.getElementById('btnToggleFleetOrbits');
    if (btnToggleOrbits) {
      btnToggleOrbits.addEventListener('click', (e) => {
        e.preventDefault();
        this.setFleetTrajectories(!this.showFleetTrajectories);
      });
    }
  }

  setFleetTrajectories(checked) {
    this.showFleetTrajectories = checked;
    const toggleFleetTraj = document.getElementById('toggleFleetTrajectories');
    const layerFleetTraj = document.getElementById('layerFleetTrajectories');
    const fleetBadge = document.getElementById('fleetTrajCountBadge');
    const fleetCard = document.querySelector('.fleet-trajectories-card');
    const btn = document.getElementById('btnToggleFleetOrbits');
    const btnText = document.getElementById('btnToggleFleetOrbitsText');

    if (toggleFleetTraj) toggleFleetTraj.checked = checked;
    if (layerFleetTraj) layerFleetTraj.checked = checked;
    if (fleetCard) fleetCard.classList.toggle('active', checked);

    const targetFleet = (this.filteredSatellites && this.filteredSatellites.length > 0)
      ? this.filteredSatellites
      : this.satellites;

    if (checked) {
      const count = this.cesium.showFleetTrajectories(targetFleet, this.simulationTime);
      if (fleetBadge) {
        fleetBadge.textContent = `${count} Active Orbits`;
        fleetBadge.classList.add('active');
      }
      if (btnText) {
        btnText.textContent = `Hide All Fleet Orbits (${count})`;
      }
      if (btn) {
        btn.classList.add('active');
      }
    } else {
      this.cesium.clearFleetTrajectories();
      if (fleetBadge) {
        fleetBadge.textContent = `${targetFleet.length} Available`;
        fleetBadge.classList.remove('active');
      }
      if (btnText) {
        btnText.textContent = `Show All Fleet Orbits (${targetFleet.length})`;
      }
      if (btn) {
        btn.classList.remove('active');
      }
    }
  }

  async checkApiStatus() {
    try {
      const resp = await fetch('/api/status');
      if (resp.ok) {
        const data = await resp.json();
        const indicator = document.getElementById('apiStatusIndicator');
        const text = document.getElementById('apiStatusText');
        
        if (indicator && text) {
          if (data.has_api_key) {
            indicator.className = 'status-dot active';
            text.textContent = 'KeepTrack V4';
          } else {
            indicator.className = 'status-dot';
            text.textContent = 'Set API Key';
          }
        }

        // Provenance info
        document.getElementById('provSource').textContent = data.source || 'KeepTrack API V4';
        document.getElementById('provUpdate').textContent = data.last_updated ? new Date(data.last_updated).toLocaleString() : 'Just now';
        document.getElementById('provEtag').textContent = data.cache_etag || 'ETag cached';
      }
    } catch (e) {
      console.warn('[Status] Could not fetch server status:', e);
    }
  }

  /**
   * Load satellite catalog via ONE bulk request from backend caching proxy
   */
  async loadCatalog(force = false) {
    const statVal = document.getElementById('satCountVal');
    statVal.textContent = 'Fetching...';

    try {
      const url = force ? '/api/catalog?force=true' : '/api/catalog';
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP error ${resp.status}`);

      const data = await resp.json();
      const rawSats = data.satellites || [];
      console.log(`[SatTrack] Ingested ${rawSats.length} satellites from ${data.source}`);

      // Parse with OOTK OrbitEngine
      this.satellites = [];
      this.satMap.clear();

      rawSats.forEach(raw => {
        const sat = window.orbitEngine.createSatelliteRecord(raw);
        this.satellites.push(sat);
        this.satMap.set(sat.noradId, sat);
      });

      statVal.textContent = `${this.satellites.length.toLocaleString()} active`;
      
      // Populate Country dropdown dynamically from catalog
      this.populateCountryDropdown();

      // Update Cesium 3D Globe
      this.cesium.loadSatellites(this.satellites, this.simulationTime);
      this.cesium.setBackgroundFleetDisplay(this.ui ? this.ui.currentBgMode : 'all');

      // Update Search Index
      this.search.setSatellites(this.satellites);

      // Update Left Drawer Virtual List
      this.renderVirtualList();

      // Start with a clean, free globe (no satellite auto-selected)
      console.log(`[Catalog] Loaded ${this.satellites.length} satellites. Globe is free for user exploration.`);
    } catch (e) {
      console.error('[Catalog Error] Failed to load satellite catalog:', e);
      statVal.textContent = 'Error loading';
    }
  }

  populateCountryDropdown() {
    const select = document.getElementById('fleetCountrySelect');
    if (!select) return;
    const counts = new Map();
    this.satellites.forEach(s => {
      let c = (s.country || 'OTHER').toUpperCase().trim();
      if (c === 'IND' || c === 'ISRO') c = 'IN';
      if (c === 'PRC' || c === 'CHN') c = 'CN';
      if (c === 'SU' || c === 'CIS' || c === 'RUS') c = 'RU';
      if (c === 'JPN' || c === 'J') c = 'JP';
      if (c === 'GBR') c = 'UK';
      if (c === 'I-ESA' || c === 'I-EU') c = 'ESA';
      counts.set(c, (counts.get(c) || 0) + 1);
    });
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    
    let html = `<option value="all">-- All Countries & Operators (${this.satellites.length.toLocaleString()}) --</option>`;
    const countryNames = {
      'US': 'United States',
      'IN': 'India 🇮🇳',
      'CN': 'China',
      'RU': 'Russia / CIS',
      'ESA': 'European Space Agency (ESA)',
      'UK': 'United Kingdom',
      'F': 'France',
      'FR': 'France',
      'JP': 'Japan (JAXA)',
      'CA': 'Canada',
      'D': 'Germany',
      'GER': 'Germany',
      'KR': 'South Korea',
      'IT': 'Italy',
      'AU': 'Australia',
      'UNK': 'Uncataloged / Debris'
    };
    sorted.forEach(([code, count]) => {
      const name = countryNames[code] ? `${countryNames[code]} (${code})` : code;
      html += `<option value="${code}">${name} — ${count.toLocaleString()} sats</option>`;
    });
    select.innerHTML = html;
  }

  getFilteredSatellites() {
    const filterChip = document.querySelector('.filter-chip[data-filter].active');
    const purposeChip = document.querySelector('.filter-chip[data-purpose].active');
    const countryChip = document.querySelector('.filter-chip[data-country].active');
    const countrySelect = document.getElementById('fleetCountrySelect');

    const orbitFilter = filterChip ? filterChip.dataset.filter : 'all';
    const purposeFilter = purposeChip ? purposeChip.dataset.purpose : 'all';

    let countryFilter = 'all';
    if (countryChip && countryChip.dataset.country && countryChip.dataset.country !== 'all') {
      countryFilter = countryChip.dataset.country;
    } else if (countrySelect && countrySelect.value && countrySelect.value !== 'all') {
      countryFilter = countrySelect.value;
    }

    return this.satellites.filter(s => {
      // Orbit filter
      if (orbitFilter !== 'all' && s.orbitClass.toLowerCase() !== orbitFilter) {
        return false;
      }
      // Purpose filter
      if (purposeFilter !== 'all') {
        const p = s.purpose.toLowerCase();
        if (purposeFilter === 'stations' && !p.includes('station') && !p.includes('manned') && !p.includes('crew')) return false;
        if (purposeFilter === 'navigation' && !p.includes('nav') && !p.includes('gps') && !p.includes('gnss')) return false;
        if (purposeFilter === 'weather' && !p.includes('weather') && !p.includes('earth')) return false;
        if (purposeFilter === 'science' && !p.includes('science') && !p.includes('astro')) return false;
        if (purposeFilter === 'communication' && !p.includes('comm')) return false;
      }
      // Country / Operator filter
      if (countryFilter !== 'all') {
        const c = (s.country || '').toUpperCase().trim();
        if (countryFilter === 'IN' && !['IN', 'IND', 'ISRO'].includes(c)) return false;
        else if (countryFilter === 'US' && c !== 'US') return false;
        else if (countryFilter === 'CN' && !['CN', 'PRC', 'CHN'].includes(c)) return false;
        else if (countryFilter === 'RU' && !['RU', 'SU', 'CIS', 'RUS'].includes(c)) return false;
        else if (countryFilter === 'ESA' && !['ESA', 'I-ESA', 'I-EU', 'FR', 'F', 'D', 'GER', 'IT'].includes(c)) return false;
        else if (countryFilter === 'UK' && c !== 'UK') return false;
        else if (countryFilter === 'JP' && !['JP', 'JPN', 'J'].includes(c)) return false;
        else if (!['IN', 'US', 'CN', 'RU', 'ESA', 'UK', 'JP'].includes(countryFilter) && c !== countryFilter) return false;
      }
      return true;
    });
  }

  renderVirtualList() {
    const listContainer = document.getElementById('satellitesList');
    const filtered = this.getFilteredSatellites();
    this.filteredSatellites = filtered;
    document.getElementById('visibleSatCount').textContent = filtered.length;

    // Load ONLY the filtered satellites onto the Cesium 3D Globe!
    // This purges all non-matching satellites from the WebGL buffer so only the filtered country is visible!
    this.cesium.loadSatellites(filtered, this.simulationTime);

    // Dynamic Fleet Orbit Trajectories Synchronization
    const fleetBadge = document.getElementById('fleetTrajCountBadge');
    const btnText = document.getElementById('btnToggleFleetOrbitsText');
    const btn = document.getElementById('btnToggleFleetOrbits');
    if (this.showFleetTrajectories) {
      const count = this.cesium.showFleetTrajectories(filtered, this.simulationTime);
      if (fleetBadge) {
        fleetBadge.textContent = `${count} Active Orbits`;
        fleetBadge.classList.add('active');
      }
      if (btnText) btnText.textContent = `Hide All Fleet Orbits (${count})`;
      if (btn) btn.classList.add('active');
    } else {
      if (fleetBadge) {
        fleetBadge.textContent = `${filtered.length} Available`;
        fleetBadge.classList.remove('active');
      }
      if (btnText) btnText.textContent = `Show All Fleet Orbits (${filtered.length})`;
      if (btn) btn.classList.remove('active');
    }

    // If currently selected satellite is not in the filtered country, deselect it cleanly
    if (this.selectedSatellite && filtered.length > 0) {
      const noradSet = new Set(filtered.map(s => s.noradId));
      if (!noradSet.has(this.selectedSatellite.noradId)) {
        this.deselectSatellite();
      }
    }

    // Render first 100 for fast UI response
    const displayList = filtered.slice(0, 100);
    let html = '';
    displayList.forEach(s => {
      const isSelected = this.selectedSatellite && this.selectedSatellite.noradId === s.noradId;
      html += `
        <div class="sat-list-item ${isSelected ? 'selected' : ''}" data-norad="${s.noradId}">
          <div>
            <div class="sat-list-item-title">${s.name}</div>
            <div class="sat-list-item-sub">NORAD: ${s.noradId} • ${s.orbitClass} • ${s.country}</div>
          </div>
          <span class="search-item-badge">${s.orbitClass}</span>
        </div>
      `;
    });

    listContainer.innerHTML = html;

    listContainer.querySelectorAll('.sat-list-item').forEach(item => {
      item.addEventListener('click', () => {
        const norad = item.dataset.norad;
        this.selectSatelliteById(norad);
      });
    });
  }

  deselectSatellite() {
    this.selectedSatellite = null;
    this.cesium.deselectSatellite();
    const panel = document.getElementById('satDetailPanel');
    if (panel) panel.classList.add('collapsed');
    const ktHud = document.getElementById('ktTargetOverlay');
    if (ktHud) ktHud.style.display = 'none';
    document.querySelectorAll('.sat-list-item').forEach(item => {
      item.classList.remove('selected');
    });
  }

  selectSatelliteById(noradId) {
    const sat = this.satMap.get(noradId);
    if (sat) {
      this.selectSatellite(sat, true);
    }
  }

  selectSatellite(sat, flyTo = false) {
    this.selectedSatellite = sat;
    this.cesium.selectSatellite(sat, this.simulationTime);
    this.ui.showSatelliteDetails(sat);

    // Update follow button state
    const focusBtn = document.getElementById('focusSatBtn');
    if (focusBtn) {
      const isFollowingThis = this.cesium.isTrackingSelected && 
        this.cesium.followTargetSat && 
        this.cesium.followTargetSat.noradId === sat.noradId;
      if (isFollowingThis) {
        focusBtn.innerHTML = '<i class="fa-solid fa-lock"></i> Following (Zoom Free)';
        focusBtn.style.background = 'var(--accent-orange)';
      } else {
        focusBtn.innerHTML = '<i class="fa-solid fa-crosshairs"></i> Follow Satellite';
        focusBtn.style.background = 'var(--accent-cyan)';
      }
    }

    // Refresh Fleet Dock pills
    this.ui.renderFollowedPills(this.cesium.followedSatellites, sat.noradId);

    if (flyTo) {
      this.cesium.flyToSatellite(sat, this.simulationTime);
    }

    // Highlight in virtual list
    document.querySelectorAll('.sat-list-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.norad === sat.noradId);
    });
  }

  toggleFollowSatellite(satRecord) {
    if (!satRecord) return false;
    let isNowFollowed = false;
    if (this.cesium.followedSatellites.has(satRecord.noradId)) {
      this.cesium.removeFollowedSatellite(satRecord.noradId);
      isNowFollowed = false;
    } else {
      this.cesium.addFollowedSatellite(satRecord, this.simulationTime);
      isNowFollowed = true;
    }
    this.ui.renderFollowedPills(
      this.cesium.followedSatellites, 
      this.selectedSatellite ? this.selectedSatellite.noradId : null
    );
    return isNowFollowed;
  }

  async loadLaunches() {
    try {
      const resp = await fetch('/api/launches');
      if (resp.ok) {
        const launches = await resp.json();
        this.ui.renderLaunches(launches);
      }
    } catch (e) {
      console.warn('Could not load launches:', e);
    }
  }

  async loadReentries() {
    try {
      const resp = await fetch('/api/reentries');
      if (resp.ok) {
        const reentries = await resp.json();
        this.ui.renderReentries(reentries);
      }
    } catch (e) {
      console.warn('Could not load reentries:', e);
    }
  }

  /**
   * Historical Simulation Controls
   */
  initTimelineControls() {
    const playPauseBtn = document.getElementById('simPlayPauseBtn');
    const nowBtn = document.getElementById('simNowBtn');
    const stepBackBtn = document.getElementById('simStepBackBtn');
    const stepFwdBtn = document.getElementById('simStepFwdBtn');
    const scrubber = document.getElementById('timeScrubber');
    const datePicker = document.getElementById('simDatePicker');
    const applyDateBtn = document.getElementById('applyCustomDateBtn');

    // Play / Pause Toggle
    const togglePlay = () => {
      this.isPlaying = !this.isPlaying;
      playPauseBtn.innerHTML = this.isPlaying ? '<i class="fa-solid fa-pause"></i>' : '<i class="fa-solid fa-play"></i>';
    };
    playPauseBtn.addEventListener('click', togglePlay);

    // Keyboard Spacebar Shortcut
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
        e.preventDefault();
        togglePlay();
      }
    });

    // Speed Buttons
    document.querySelectorAll('.speed-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.speed-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.simulationSpeed = parseFloat(btn.dataset.speed);
      });
    });

    // Step Controls (10 minutes)
    stepBackBtn.addEventListener('click', () => {
      this.setSimulationTime(new Date(this.simulationTime.getTime() - 10 * 60 * 1000));
    });
    stepFwdBtn.addEventListener('click', () => {
      this.setSimulationTime(new Date(this.simulationTime.getTime() + 10 * 60 * 1000));
    });

    // Reset to "Now" Real-time
    nowBtn.addEventListener('click', () => {
      this.simulationSpeed = 1.0;
      this.isPlaying = true;
      playPauseBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
      document.querySelectorAll('.speed-btn').forEach(b => b.classList.toggle('active', b.dataset.speed === '1'));
      this.setSimulationTime(new Date());
    });

    // Time Scrubber (±24 hours range relative to current real-time)
    scrubber.addEventListener('input', () => {
      this.isScrubbing = true;
      const val = parseInt(scrubber.value, 10); // 0 .. 1000
      // 500 = Now; 0 = -24h; 1000 = +24h
      const offsetMs = (val - 500) * (24 * 3600 * 1000 / 500);
      this.simulationTime = new Date(Date.now() + offsetMs);
      this.updateSimulationUI();
    });
    scrubber.addEventListener('change', () => {
      this.isScrubbing = false;
      this.setSimulationTime(this.simulationTime);
    });

    // Directly Visible Calendar & Date/Time Picker
    const triggerCalendarBtn = document.getElementById('triggerCalendarBtn');
    if (triggerCalendarBtn) {
      triggerCalendarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          if (typeof datePicker.showPicker === 'function') {
            datePicker.showPicker();
          } else {
            datePicker.focus();
          }
        } catch (err) {
          datePicker.focus();
        }
      });
    }

    const onDateCommitted = () => {
      this.isDatePickerActive = false;
      if (datePicker && datePicker.value) {
        const d = new Date(datePicker.value);
        if (!isNaN(d.getTime())) {
          this.setSimulationTime(d, true);
        }
      }
    };

    // ONLY listen to change, NEVER input or click on the input itself, to prevent recursive event loops
    datePicker.addEventListener('change', onDateCommitted);
    applyDateBtn.addEventListener('click', onDateCommitted);

    this.isDatePickerActive = false;
    datePicker.addEventListener('focus', () => {
      this.isDatePickerActive = true;
    });
    datePicker.addEventListener('blur', () => {
      setTimeout(() => {
        this.isDatePickerActive = false;
      }, 300);
    });

    // Timezone Selector (Defaults to India / IST)
    const tzSelect = document.getElementById('timezoneSelect');
    if (tzSelect) {
      tzSelect.value = this.currentTimezone;
      tzSelect.addEventListener('change', (e) => {
        this.currentTimezone = e.target.value;
        this.updateSimulationUI();
      });
    }
  }

  setSimulationTime(targetDate, updateVisuals = true) {
    if (this._isUpdatingTime) return;
    this._isUpdatingTime = true;

    try {
      if (!targetDate || isNaN(targetDate.getTime())) return;
      this.simulationTime = targetDate;
      this.updateSimulationUI(false);

      if (updateVisuals) {
        // 1. Immediately update selected satellite trajectory
        if (this.selectedSatellite) {
          this.cesium.selectSatellite(this.selectedSatellite, this.simulationTime);
        }
        // 2. Re-propagate followed satellites using a static list snapshot (never mutate while iterating)
        if (this.cesium.followedSatellites.size > 0) {
          const followedList = Array.from(this.cesium.followedSatellites.values()).map(d => d.satRecord);
          this.cesium.clearFollowedSatellites();
          for (let i = 0; i < followedList.length; i++) {
            this.cesium.addFollowedSatellite(followedList[i], this.simulationTime);
          }
        }
        // 3. Debounce updating fleet trajectories to eliminate any lag or stutter
        if (this.showFleetTrajectories) {
          clearTimeout(this._fleetTrajTimeout);
          this._fleetTrajTimeout = setTimeout(() => {
            this.cesium.showFleetTrajectories(this.filteredSatellites || this.satellites, this.simulationTime);
          }, 60);
        }
        this.cesium.viewer.scene.requestRender();
      }
    } finally {
      this._isUpdatingTime = false;
    }
  }

  formatSimulationTime(date, tz) {
    if (tz === 'UTC') {
      return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }
    try {
      if (!this._dtFormatters) this._dtFormatters = {};
      if (!this._dtFormatters[tz]) {
        const opts = {
          timeZone: tz === 'local' ? undefined : tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false
        };
        this._dtFormatters[tz] = new Intl.DateTimeFormat('en-GB', opts);
      }
      const parts = this._dtFormatters[tz].formatToParts(date);
      const m = {};
      parts.forEach(p => m[p.type] = p.value);
      const abbr = tz === 'Asia/Kolkata' ? 'IST (+5:30)' : (tz === 'local' ? 'LOCAL' : tz.split('/')[1] || tz);
      return `${m.year}-${m.month}-${m.day} ${m.hour}:${m.minute}:${m.second} ${abbr}`;
    } catch (e) {
      return date.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    }
  }

  updateSimulationUI(force = false) {
    const timeDisplay = document.getElementById('simTimeDisplay');
    const badge = document.getElementById('timeDiffBadge');
    const datePicker = document.getElementById('simDatePicker');
    const scrubber = document.getElementById('timeScrubber');

    timeDisplay.textContent = this.formatSimulationTime(this.simulationTime, this.currentTimezone);

    // Synchronize HTML datetime-local picker only when user is not focused/interacting with it
    if (datePicker && !this.isDatePickerActive && document.activeElement !== datePicker) {
      const localIso = new Date(this.simulationTime.getTime() - this.simulationTime.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
      if (datePicker.value !== localIso) {
        datePicker.value = localIso;
      }
    }

    // Check difference against real-time wall clock
    const diffSec = Math.abs(Date.now() - this.simulationTime.getTime()) / 1000;
    if (diffSec < 5 && this.simulationSpeed === 1.0) {
      badge.className = 'time-diff-badge live';
      badge.textContent = 'REAL-TIME';
    } else {
      badge.className = 'time-diff-badge';
      const hours = (diffSec / 3600).toFixed(1);
      const isPast = this.simulationTime.getTime() < Date.now();
      badge.textContent = `${isPast ? '-' : '+'}${hours}h SIMULATED`;
    }

    // Update scrubber position if user is not actively dragging it
    if (!this.isScrubbing && scrubber) {
      const offsetMs = this.simulationTime.getTime() - Date.now();
      const val = 500 + (offsetMs / (24 * 3600 * 1000)) * 500;
      scrubber.value = Math.max(0, Math.min(1000, Math.round(val)));
    }
  }

  /**
   * Main High-Performance Animation Loop (60 FPS)
   */
  animationLoop(currentTime) {
    const deltaMs = currentTime - this.lastFrameTime;
    this.lastFrameTime = currentTime;

    // 1. Advance simulation clock if playing
    if (this.isPlaying && deltaMs > 0 && deltaMs < 1000) {
      const advancedMs = deltaMs * this.simulationSpeed;
      this.simulationTime = new Date(this.simulationTime.getTime() + advancedMs);
    }

    // 2. Update Cesium satellite positions for current simulation time
    const activeFleet = (this.filteredSatellites && this.filteredSatellites.length > 0 && this.filteredSatellites.length < this.satellites.length)
      ? this.filteredSatellites 
      : this.satellites;
    if (activeFleet.length > 0) {
      const isHighSpeed = Math.abs(this.simulationSpeed) >= 60;
      this.cesium.updateSatellitePositions(activeFleet, this.simulationTime, isHighSpeed);
    }

    // 3. Update telemetry for selected satellite
    if (this.selectedSatellite) {
      this.ui.updateLiveTelemetry(this.selectedSatellite);
    }

    // 3b. Update inter-satellite distance & relative velocity if 2 or more satellites are followed
    if (this.cesium.followedSatellites.size >= 2) {
      const iter = this.cesium.followedSatellites.values();
      const satA = iter.next().value.satRecord;
      const satB = iter.next().value.satRecord;
      const metrics = window.orbitEngine.computeInterSatelliteMetrics(satA, satB, this.simulationTime);
      this.ui.updateConjunctionDistance(metrics);
    }

    // 4. Update Time Readout
    this.updateSimulationUI();

    // 5. FPS Counter Calculation
    this.frameCount++;
    if (currentTime - this.lastFpsUpdate >= 1000) {
      const fps = Math.round((this.frameCount * 1000) / (currentTime - this.lastFpsUpdate));
      document.getElementById('fpsVal').textContent = fps;
      this.frameCount = 0;
      this.lastFpsUpdate = currentTime;
    }

    requestAnimationFrame((t) => this.animationLoop(t));
  }
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  new App();
});

