/**
 * SatTrack - UI Manager
 * Controls interface panels, telemetry readouts, research tools, and modals.
 */

class UIManager {
  constructor() {
    this.currentSatellite = null;
    this.bookmarks = this.loadBookmarks();
    this.activeDrawerTab = 'fleetPanel';
    this.isDrawerOpen = false;

    this.onBookmarkChange = null;
    this.onSelectSatellite = null;
    this.onFilterChange = null;
    this.onKeyUpdated = null;
    this.onEpochJump = null;
    this.onToggleMultiFollow = null;
    this.onFrameAll = null;
    this.onClearAllFollow = null;
    this.onBackgroundFleetChange = null;
    this.currentBgMode = 'all';
    
    this.setupDrawer();
    this.setupSatPanel();
    this.setupModals();
    this.setupResearchTools();
    this.setupTimeMachine();
    this.setupFleetDock();
  }

  loadBookmarks() {
    try {
      const data = localStorage.getItem('sattrack_bookmarks');
      return data ? JSON.parse(data) : ['25544']; // ISS default
    } catch (e) {
      return ['25544'];
    }
  }

  saveBookmarks() {
    try {
      localStorage.setItem('sattrack_bookmarks', JSON.stringify(this.bookmarks));
      if (typeof this.onBookmarkChange === 'function') {
        this.onBookmarkChange(this.bookmarks);
      }
    } catch (e) {
      console.warn('Could not save bookmarks to localStorage');
    }
  }

  setupDrawer() {
    const leftDrawer = document.getElementById('leftDrawer');
    const navTabs = document.querySelectorAll('.nav-tab');
    const closeBtn = document.getElementById('closeDrawerBtn');

    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const panelId = tab.dataset.panel;
        
        // If clicking the currently active tab while open, close drawer
        if (this.isDrawerOpen && this.activeDrawerTab === panelId) {
          leftDrawer.classList.remove('open');
          this.isDrawerOpen = false;
          tab.classList.remove('active');
          return;
        }

        navTabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        document.querySelectorAll('.drawer-tab-content').forEach(p => p.classList.remove('active'));
        const targetPanel = document.getElementById(panelId);
        if (targetPanel) targetPanel.classList.add('active');

        // Set title
        const titleEl = document.getElementById('drawerTitle');
        const icon = tab.querySelector('i').className;
        const label = tab.querySelector('.nav-label').textContent;
        titleEl.innerHTML = `<i class="${icon}"></i> ${label}`;

        leftDrawer.classList.add('open');
        this.isDrawerOpen = true;
        this.activeDrawerTab = panelId;
      });
    });

    closeBtn.addEventListener('click', () => {
      leftDrawer.classList.remove('open');
      this.isDrawerOpen = false;
      navTabs.forEach(t => t.classList.remove('active'));
    });

    // Orbit filter chips
    document.querySelectorAll('.filter-chip[data-filter]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip[data-filter]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (typeof this.onFilterChange === 'function') {
          this.onFilterChange();
        }
      });
    });

    // Purpose filter chips
    document.querySelectorAll('.filter-chip[data-purpose]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip[data-purpose]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        if (typeof this.onFilterChange === 'function') {
          this.onFilterChange();
        }
      });
    });

    // Country filter chips
    document.querySelectorAll('.filter-chip[data-country]').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip[data-country]').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const countrySelect = document.getElementById('fleetCountrySelect');
        if (countrySelect) {
          if (chip.dataset.country === 'all') {
            countrySelect.value = 'all';
          } else {
            const opt = countrySelect.querySelector(`option[value="${chip.dataset.country}"]`);
            if (opt) countrySelect.value = chip.dataset.country;
            else countrySelect.value = 'all';
          }
        }
        if (typeof this.onFilterChange === 'function') {
          this.onFilterChange();
        }
      });
    });

    // Country select dropdown
    const countrySelect = document.getElementById('fleetCountrySelect');
    if (countrySelect) {
      countrySelect.addEventListener('change', () => {
        const val = countrySelect.value;
        let matched = false;
        document.querySelectorAll('.filter-chip[data-country]').forEach(c => {
          const isMatch = (c.dataset.country === val);
          c.classList.toggle('active', isMatch);
          if (isMatch) matched = true;
        });
        if (!matched && val !== 'all') {
          document.querySelectorAll('.filter-chip[data-country]').forEach(c => c.classList.remove('active'));
        }
        if (typeof this.onFilterChange === 'function') {
          this.onFilterChange();
        }
      });
    }

    // Background Fleet Display Mode chips (in Layers panel)
    document.querySelectorAll('.filter-chip[data-bg-mode]').forEach(chip => {
      chip.addEventListener('click', () => {
        const mode = chip.dataset.bgMode;
        this.updateBackgroundFleetState(mode);
      });
    });

    // Background Fleet Opacity Slider (in Layers panel)
    const opacitySlider = document.getElementById('bgOpacitySlider');
    const opacityVal = document.getElementById('bgOpacityVal');
    if (opacitySlider && opacityVal) {
      opacitySlider.addEventListener('input', () => {
        const val = parseInt(opacitySlider.value, 10);
        opacityVal.textContent = `${val}%`;
        const frac = val / 100;
        let mode = 'all';
        if (frac <= 0.01) mode = 'hide';
        else if (frac < 0.95) mode = 'dim';
        this.currentBgMode = mode;
        this.syncFocusModeUI(mode, val);
        if (typeof this.onBackgroundFleetChange === 'function') {
          this.onBackgroundFleetChange(mode, frac);
        }
      });
    }
  }

  setupSatPanel() {
    const panel = document.getElementById('satDetailPanel');
    const closeBtn = document.getElementById('closeSatPanelBtn');
    const bookmarkBtn = document.getElementById('bookmarkToggleBtn');
    const copyTleBtn = document.getElementById('copyTleBtn');

    closeBtn.addEventListener('click', () => {
      panel.classList.add('collapsed');
      const ktHud = document.getElementById('ktTargetOverlay');
      if (ktHud) ktHud.style.display = 'none';
      if (window.app) {
        window.app.deselectSatellite();
      }
    });

    bookmarkBtn.addEventListener('click', () => {
      if (!this.currentSatellite) return;
      const norad = this.currentSatellite.noradId;
      const idx = this.bookmarks.indexOf(norad);
      if (idx >= 0) {
        this.bookmarks.splice(idx, 1);
        bookmarkBtn.classList.remove('active');
        bookmarkBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
      } else {
        this.bookmarks.push(norad);
        bookmarkBtn.classList.add('active');
        bookmarkBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
      }
      this.saveBookmarks();
    });

    copyTleBtn.addEventListener('click', () => {
      if (!this.currentSatellite) return;
      const text = `${this.currentSatellite.tle1}\n${this.currentSatellite.tle2}`;
      navigator.clipboard.writeText(text).then(() => {
        copyTleBtn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
        setTimeout(() => {
          copyTleBtn.innerHTML = '<i class="fa-regular fa-copy"></i> Copy TLE to Clipboard';
        }, 2000);
      });
    });

    // Satellite Panel Tabs
    document.querySelectorAll('.sat-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sat-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.sat-tab-pane').forEach(p => p.classList.remove('active'));
        
        btn.classList.add('active');
        const pane = document.getElementById(btn.dataset.tab);
        if (pane) pane.classList.add('active');

        // Lazy load API specifications if Specs or OMM tab is clicked
        if (btn.dataset.tab === 'tabSpecs' && this.currentSatellite) {
          this.fetchKeepTrackSpecs(this.currentSatellite.noradId);
        } else if (btn.dataset.tab === 'tabOmm' && this.currentSatellite) {
          this.fetchKeepTrackOmm(this.currentSatellite.noradId);
        }
      });
    });
  }

  setupModals() {
    // API Key Modal
    const apiKeyBtn = document.getElementById('apiKeyBtn');
    const apiKeyModal = document.getElementById('apiKeyModal');
    const closeApiKeyModal = document.getElementById('closeApiKeyModal');
    const testSaveKeyBtn = document.getElementById('testSaveKeyBtn');
    const apiKeyInput = document.getElementById('apiKeyInput');
    const statusMsg = document.getElementById('apiKeyStatusMsg');

    if (apiKeyBtn) {
      apiKeyBtn.addEventListener('click', () => {
        statusMsg.style.display = 'none';
        apiKeyModal.classList.add('active');
        apiKeyInput.focus();
      });
    }

    if (closeApiKeyModal) {
      closeApiKeyModal.addEventListener('click', () => {
        apiKeyModal.classList.remove('active');
      });
    }

    testSaveKeyBtn.addEventListener('click', async () => {
      const key = apiKeyInput.value.trim();
      if (!key) {
        statusMsg.className = 'modal-alert error';
        statusMsg.textContent = 'Please enter a valid KeepTrack API Key.';
        statusMsg.style.display = 'block';
        return;
      }

      testSaveKeyBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Verifying with KeepTrack...';
      try {
        const resp = await fetch('/api/config/key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key })
        });
        const res = await resp.json();
        
        if (res.success) {
          statusMsg.className = 'modal-alert success';
          statusMsg.textContent = res.message;
          statusMsg.style.display = 'block';
          const ind = document.getElementById('apiStatusIndicator');
          const txt = document.getElementById('apiStatusText');
          if (ind) ind.className = 'status-dot active';
          if (txt) txt.textContent = 'Key Active';
          if (typeof this.onKeyUpdated === 'function') {
            this.onKeyUpdated();
          }
          setTimeout(() => {
            apiKeyModal.classList.remove('active');
          }, 1500);
        } else {
          statusMsg.className = 'modal-alert error';
          statusMsg.textContent = res.message;
          statusMsg.style.display = 'block';
        }
      } catch (e) {
        statusMsg.className = 'modal-alert error';
        statusMsg.textContent = `Error connecting to local server: ${e.message}`;
        statusMsg.style.display = 'block';
      } finally {
        testSaveKeyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Verify & Save Key';
      }
    });

    // About Modal
    const aboutBtn = document.getElementById('aboutBtn');
    const aboutModal = document.getElementById('aboutModal');
    const closeAboutModal = document.getElementById('closeAboutModal');
    const timeMachineModal = document.getElementById('timeMachineModal');

    aboutBtn.addEventListener('click', () => {
      aboutModal.classList.add('active');
    });
    closeAboutModal.addEventListener('click', () => {
      aboutModal.classList.remove('active');
    });

    // Close on overlay click
    [apiKeyModal, aboutModal, timeMachineModal].forEach(m => {
      if (!m) return;
      m.addEventListener('click', (e) => {
        if (e.target === m) m.classList.remove('active');
      });
    });
  }

  setupTimeMachine() {
    const openBtn = document.getElementById('openTimeMachineBtn');
    const modal = document.getElementById('timeMachineModal');
    const closeBtn = document.getElementById('closeTimeMachineBtn');
    const cancelBtn = document.getElementById('tmCancelBtn');
    const applyBtn = document.getElementById('tmApplyBtn');
    const nowBtn = document.getElementById('tmNowBtn');
    const dateInput = document.getElementById('tmDateInput');
    const timeInput = document.getElementById('tmTimeInput');

    const syncInputsWithSimTime = () => {
      const curTime = window.app && window.app.simulationTime ? window.app.simulationTime : new Date();
      const iso = curTime.toISOString();
      dateInput.value = iso.substring(0, 10);
      timeInput.value = iso.substring(11, 19);
    };

    openBtn.addEventListener('click', () => {
      syncInputsWithSimTime();
      modal.classList.add('active');
    });

    [closeBtn, cancelBtn].forEach(b => {
      if (b) b.addEventListener('click', () => modal.classList.remove('active'));
    });

    nowBtn.addEventListener('click', () => {
      const nowIso = new Date().toISOString();
      dateInput.value = nowIso.substring(0, 10);
      timeInput.value = nowIso.substring(11, 19);
    });

    // Preset buttons
    document.querySelectorAll('.tm-preset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const iso = btn.dataset.date;
        if (iso) {
          dateInput.value = iso.substring(0, 10);
          timeInput.value = iso.substring(11, 19);
        }
      });
    });

    // Offset buttons
    document.querySelectorAll('.tm-offset-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const offsetMs = parseInt(btn.dataset.offset, 10);
        let baseTime = new Date();
        if (dateInput.value && timeInput.value) {
          baseTime = new Date(`${dateInput.value}T${timeInput.value}Z`);
          if (isNaN(baseTime.getTime())) baseTime = new Date();
        }
        const targetTime = new Date(baseTime.getTime() + offsetMs);
        const iso = targetTime.toISOString();
        dateInput.value = iso.substring(0, 10);
        timeInput.value = iso.substring(11, 19);
      });
    });

    // Apply Epoch Jump
    applyBtn.addEventListener('click', () => {
      if (!dateInput.value || !timeInput.value) return;
      const targetIso = `${dateInput.value}T${timeInput.value}Z`;
      const targetDate = new Date(targetIso);
      if (isNaN(targetDate.getTime())) {
        alert('Invalid date or time format. Please check your inputs.');
        return;
      }

      if (typeof this.onEpochJump === 'function') {
        this.onEpochJump(targetDate);
      }
      modal.classList.remove('active');
    });
  }

  setupFleetDock() {
    const toggleDockBtn = document.getElementById('toggleFleetDockBtn');
    const dock = document.getElementById('multiFollowDock');
    const frameAllBtn = document.getElementById('frameAllBtn');
    const clearAllBtn = document.getElementById('clearAllFollowBtn');
    const multiFollowToggleBtn = document.getElementById('multiFollowToggleBtn');

    toggleDockBtn.addEventListener('click', () => {
      const isVisible = dock.style.display !== 'none';
      dock.style.display = isVisible ? 'none' : 'flex';
      toggleDockBtn.classList.toggle('active', !isVisible);
    });

    frameAllBtn.addEventListener('click', () => {
      if (typeof this.onFrameAll === 'function') {
        this.onFrameAll();
      }
    });

    clearAllBtn.addEventListener('click', () => {
      if (typeof this.onClearAllFollow === 'function') {
        this.onClearAllFollow();
      }
    });

    multiFollowToggleBtn.addEventListener('click', () => {
      if (this.currentSatellite && typeof this.onToggleMultiFollow === 'function') {
        this.onToggleMultiFollow(this.currentSatellite);
      }
    });

    // Dock Focus Mode chips (All | Dim 90% | Hide Others)
    document.querySelectorAll('.dock-focus-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const mode = chip.dataset.bgMode;
        this.updateBackgroundFleetState(mode);
      });
    });

    // Isolate Satellite button in details panel
    const isolateBtn = document.getElementById('isolateSatBtn');
    if (isolateBtn) {
      isolateBtn.addEventListener('click', () => {
        const nextMode = (this.currentBgMode === 'all') ? 'dim' : (this.currentBgMode === 'dim' ? 'hide' : 'all');
        this.updateBackgroundFleetState(nextMode);
      });
    }
  }

  updateBackgroundFleetState(mode) {
    this.currentBgMode = mode;
    let opacity = 1.0;
    let percent = 100;
    if (mode === 'dim') {
      opacity = 0.10; // 90% low opacity
      percent = 10;
    } else if (mode === 'hide') {
      opacity = 0.0;
      percent = 0;
    }

    this.syncFocusModeUI(mode, percent);
    if (typeof this.onBackgroundFleetChange === 'function') {
      this.onBackgroundFleetChange(mode, opacity);
    }
  }

  syncFocusModeUI(mode, percent) {
    // Dock chips
    document.querySelectorAll('.dock-focus-chip').forEach(c => {
      c.classList.toggle('active', c.dataset.bgMode === mode);
    });

    // Layers drawer chips
    document.querySelectorAll('.filter-chip[data-bg-mode]').forEach(c => {
      c.classList.toggle('active', c.dataset.bgMode === mode);
    });

    // Slider
    const opacitySlider = document.getElementById('bgOpacitySlider');
    const opacityVal = document.getElementById('bgOpacityVal');
    if (opacitySlider && percent !== undefined) {
      opacitySlider.value = percent;
    }
    if (opacityVal && percent !== undefined) {
      opacityVal.textContent = `${percent}%`;
    }

    // Isolate button in details panel
    const isolateBtn = document.getElementById('isolateSatBtn');
    if (isolateBtn) {
      if (mode === 'dim') {
        isolateBtn.className = 'btn-secondary active';
        isolateBtn.innerHTML = '<i class="fa-solid fa-eye-low-vision"></i> Dimmed (90%)';
        isolateBtn.style.color = 'var(--accent-yellow)';
      } else if (mode === 'hide') {
        isolateBtn.className = 'btn-secondary active';
        isolateBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i> Solo Track';
        isolateBtn.style.color = 'var(--accent-red)';
      } else {
        isolateBtn.className = 'btn-secondary';
        isolateBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Dim Others';
        isolateBtn.style.color = '';
      }
    }
  }

  renderFollowedPills(followedMap, activeNoradId) {
    const container = document.getElementById('followedPillsContainer');
    const countVal = document.getElementById('followCountVal');
    const headerCount = document.getElementById('headerFollowCount');
    const dock = document.getElementById('multiFollowDock');
    const conjCard = document.getElementById('conjunctionCard');
    const multiFollowBtn = document.getElementById('multiFollowToggleBtn');

    const total = followedMap.size;
    countVal.textContent = total;
    headerCount.textContent = total;

    // Show dock automatically when followed satellites exist
    if (total > 0 && dock.style.display === 'none') {
      dock.style.display = 'flex';
    }

    // Toggle Multi-Follow button state in satellite details panel
    if (this.currentSatellite) {
      const isFollowed = followedMap.has(this.currentSatellite.noradId);
      if (isFollowed) {
        multiFollowBtn.className = 'btn-secondary active';
        multiFollowBtn.innerHTML = '<i class="fa-solid fa-check"></i> In Follow Fleet';
      } else {
        multiFollowBtn.className = 'btn-secondary';
        multiFollowBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Multi-Follow';
      }
    }

    if (total === 0) {
      container.innerHTML = '<div class="dock-empty-hint">Use <strong>+ Follow</strong> in search or satellite panel to track multiple satellites together.</div>';
      conjCard.style.display = 'none';
      return;
    }

    let html = '';
    for (const [noradId, data] of followedMap) {
      const isActive = activeNoradId === noradId;
      html += `
        <div class="follow-pill ${isActive ? 'active' : ''}" data-norad="${noradId}">
          <span class="pill-dot" style="background-color: ${data.color}; color: ${data.color};"></span>
          <span class="pill-label">${data.satRecord.name} (${noradId})</span>
          <button class="pill-btn-remove" data-norad="${noradId}" title="Remove from fleet">✕</button>
        </div>
      `;
    }

    container.innerHTML = html;
    conjCard.style.display = (total >= 2) ? 'flex' : 'none';

    // Click on pill to focus satellite
    container.querySelectorAll('.follow-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        if (e.target.closest('.pill-btn-remove')) return;
        const norad = pill.dataset.norad;
        if (typeof this.onSelectSatellite === 'function') {
          this.onSelectSatellite(norad);
        }
      });
    });

    // Remove button on pill
    container.querySelectorAll('.pill-btn-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const norad = btn.dataset.norad;
        const satData = followedMap.get(norad);
        if (satData && typeof this.onToggleMultiFollow === 'function') {
          this.onToggleMultiFollow(satData.satRecord);
        }
      });
    });
  }

  updateConjunctionDistance(metric) {
    if (!metric) return;
    document.getElementById('conjDistanceVal').textContent = `${metric.distanceKm.toLocaleString()} km`;
    document.getElementById('conjRelVelVal').textContent = `Δv: ${metric.relativeVelocityKms.toFixed(2)} km/s`;
  }

  setupResearchTools() {
    const regionSelect = document.getElementById('regionSelect');
    const customBBox = document.getElementById('customBBoxFields');
    const analyzeBtn = document.getElementById('analyzePassesBtn');
    const exportSelectedBtn = document.getElementById('exportSelectedCsvBtn');
    const exportAllBtn = document.getElementById('exportAllCsvBtn');
    const exportQuickBtn = document.getElementById('exportCsvQuickBtn');

    regionSelect.addEventListener('change', () => {
      customBBox.style.display = (regionSelect.value === 'custom') ? 'grid' : 'none';
    });

    analyzeBtn.addEventListener('click', () => {
      this.runPassAnalysis();
    });

    exportSelectedBtn.addEventListener('click', () => {
      if (this.currentSatellite) {
        this.exportSatellitesToCsv([this.currentSatellite], `sattrack_${this.currentSatellite.noradId}.csv`);
      }
    });

    exportAllBtn.addEventListener('click', () => {
      if (window.app && window.app.satellites) {
        this.exportSatellitesToCsv(window.app.satellites, 'sattrack_complete_catalog.csv');
      }
    });

    exportQuickBtn.addEventListener('click', () => {
      if (window.app && window.app.getFilteredSatellites) {
        const filtered = window.app.getFilteredSatellites();
        this.exportSatellitesToCsv(filtered, 'sattrack_filtered_fleet.csv');
      }
    });
  }

  /**
   * Display selected satellite in right information panel
   */
  showSatelliteDetails(sat) {
    this.currentSatellite = sat;
    const panel = document.getElementById('satDetailPanel');
    panel.classList.remove('collapsed');

    // Header values
    document.getElementById('satOrbitBadge').textContent = sat.orbitClass;
    document.getElementById('satNameVal').textContent = sat.name;
    document.getElementById('satNoradVal').textContent = sat.noradId;
    document.getElementById('satCountryVal').textContent = sat.country;

    // KeepTrack Floating Target HUD Overlay
    const ktHud = document.getElementById('ktTargetOverlay');
    if (ktHud) {
      const flagMap = {
        'US': '🇺🇸', 'IN': '🇮🇳', 'IND': '🇮🇳', 'ISRO': '🇮🇳',
        'CN': '🇨🇳', 'PRC': '🇨🇳', 'RU': '🇷🇺', 'CIS': '🇷🇺', 'SU': '🇷🇺',
        'UK': '🇬🇧', 'GBR': '🇬🇧', 'JP': '🇯🇵', 'JPN': '🇯🇵',
        'FR': '🇫🇷', 'F': '🇫🇷', 'D': '🇩🇪', 'GER': '🇩🇪',
        'ESA': '🇪🇺', 'CA': '🇨🇦', 'IT': '🇮🇹', 'KR': '🇰🇷',
        'BR': '🇧🇷', 'AU': '🇦🇺', 'IL': '🇮🇱', 'IR': '🇮🇷', 'PK': '🇵🇰'
      };
      const flag = flagMap[(sat.country || '').toUpperCase().trim()] || '🛰️';
      document.getElementById('ktOverlayFlag').textContent = flag;
      document.getElementById('ktOverlayName').textContent = sat.name;
      document.getElementById('ktOverlayNorad').textContent = sat.noradId;
      const launchYear = (sat.launchDate && sat.launchDate.length >= 4) ? sat.launchDate.substring(0, 4) : 'N/A';
      document.getElementById('ktOverlayLaunch').textContent = launchYear;
      ktHud.style.display = 'block';
    }

    // Star icon state
    const bookmarkBtn = document.getElementById('bookmarkToggleBtn');
    const isBookmarked = this.bookmarks.includes(sat.noradId);
    bookmarkBtn.className = isBookmarked ? 'icon-btn-star active' : 'icon-btn-star';
    bookmarkBtn.innerHTML = isBookmarked ? '<i class="fa-solid fa-star"></i>' : '<i class="fa-regular fa-star"></i>';

    // Overview table
    document.getElementById('satPurposeVal').textContent = sat.purpose;
    document.getElementById('satLaunchVal').textContent = sat.launchDate;
    document.getElementById('satRcsVal').textContent = sat.rcs;
    document.getElementById('satVmagVal').textContent = `${sat.vmag} mag`;
    document.getElementById('satStatusVal').textContent = sat.status;
    document.getElementById('satBusVal').textContent = sat.bus;
    document.getElementById('satApogeeVal').textContent = `${sat.elements.apogeeKm} km`;
    document.getElementById('satPerigeeVal').textContent = `${sat.elements.perigeeKm} km`;
    document.getElementById('satSmaVal').textContent = `${Math.round(sat.elements.semiMajorAxisKm)} km`;
    document.getElementById('satEccVal').textContent = sat.elements.eccentricity.toFixed(5);

    // Orbital Elements Tab
    const el = sat.elements;
    document.getElementById('elInc').textContent = `${el.inclinationDeg.toFixed(4)}°`;
    document.getElementById('elRaan').textContent = `${el.raanDeg.toFixed(4)}°`;
    document.getElementById('elEcc').textContent = el.eccentricity.toFixed(6);
    document.getElementById('elArgP').textContent = `${el.argPerigeeDeg.toFixed(4)}°`;
    document.getElementById('elMeanA').textContent = `${el.meanAnomalyDeg.toFixed(4)}°`;
    document.getElementById('elMeanM').textContent = `${el.meanMotionRevDay.toFixed(6)} rev/day`;
    document.getElementById('elPeriod').textContent = `${el.periodMin.toFixed(2)} min`;
    document.getElementById('elBstar').textContent = el.bstar.toExponential(4);
    document.getElementById('elEpoch').textContent = 'Live Computed';

    // Raw TLE
    document.getElementById('rawTleDisplay').textContent = `${sat.tle1}\n${sat.tle2}`;

    // Reset Specs and OMM tabs
    document.getElementById('specsContent').innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Loading KeepTrack specifications...</div>';
    document.getElementById('ommContent').innerHTML = '<div class="loading-spinner"><i class="fa-solid fa-spinner fa-spin"></i> Loading CCSDS OMM record...</div>';

    // Update real-time telemetry readout
    this.updateLiveTelemetry(sat);
  }

  /**
   * Update dynamic telemetry numbers for the active satellite
   */
  updateLiveTelemetry(sat) {
    if (!sat || !sat.lastLla) return;
    const lla = sat.lastLla;
    document.getElementById('satLatVal').textContent = `${lla.lat >= 0 ? '+' : ''}${lla.lat.toFixed(4)}°`;
    document.getElementById('satLonVal').textContent = `${lla.lon >= 0 ? '+' : ''}${lla.lon.toFixed(4)}°`;
    document.getElementById('satAltVal').textContent = `${Math.round(lla.alt)} km`;
    document.getElementById('satVelVal').textContent = `${lla.velocity.toFixed(2)} km/s`;
    document.getElementById('satIncVal').textContent = `${sat.elements.inclinationDeg.toFixed(2)}°`;
    document.getElementById('satPeriodVal').textContent = `${sat.elements.periodMin.toFixed(1)} min`;
  }

  /**
   * Fetch KeepTrack GET /v4/sats/{id} specification details
   */
  async fetchKeepTrackSpecs(noradId) {
    const container = document.getElementById('specsContent');
    try {
      const resp = await fetch(`/api/sats/${noradId}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const spec = Array.isArray(data) ? data[0] : data;

      if (!spec) {
        container.innerHTML = '<p style="color: var(--text-dim);">No detailed specification available for this object.</p>';
        return;
      }

      let html = '<table class="info-table">';
      for (const [k, v] of Object.entries(spec)) {
        if (v && v !== 'UNKNOWN') {
          html += `<tr><td>${this.formatSpecLabel(k)}</td><td>${v}</td></tr>`;
        }
      }
      html += '</table>';
      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<p style="color: var(--accent-orange); font-size: 11px;">KeepTrack API specs endpoint responded: ${e.message}. Using catalog telemetry.</p>`;
    }
  }

  /**
   * Fetch KeepTrack GET /v4/sat/{id}/omm record
   */
  async fetchKeepTrackOmm(noradId) {
    const container = document.getElementById('ommContent');
    try {
      const resp = await fetch(`/api/sat/${noradId}/omm`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const omm = await resp.json();

      let html = '<table class="info-table mono">';
      for (const [k, v] of Object.entries(omm)) {
        html += `<tr><td>${k}</td><td>${typeof v === 'number' ? v.toFixed(6) : v}</td></tr>`;
      }
      html += '</table>';
      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = `<p style="color: var(--accent-orange); font-size: 11px;">CCSDS OMM record unavailable: ${e.message}</p>`;
    }
  }

  formatSpecLabel(k) {
    return k.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Populate Upcoming Launches List
   */
  renderLaunches(launches) {
    const list = document.getElementById('launchesList');
    if (!launches || launches.length === 0) {
      list.innerHTML = '<p class="section-desc">No upcoming launches currently reported.</p>';
      return;
    }

    let html = '';
    launches.forEach(l => {
      const d = l.net ? new Date(l.net) : null;
      const dateStr = d ? d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'TBD';
      const utcStr = d ? d.toUTCString().replace('GMT', 'UTC') : '';
      html += `
        <div class="launch-card">
          <div class="launch-title">${l.name}</div>
          <div class="launch-date"><i class="fa-regular fa-clock"></i> ${dateStr} <span style="font-size:10px; color:var(--text-muted);">(${utcStr})</span></div>
          <div class="launch-site"><i class="fa-solid fa-location-dot"></i> ${l.pad ? l.pad.name : 'Orbital Launch Complex'}</div>
          <div class="launch-desc">${l.mission ? l.mission.description : 'Payload deployment mission.'}</div>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  /**
   * Populate Predicted Reentries List
   */
  renderReentries(reentries) {
    const list = document.getElementById('reentriesList');
    if (!reentries || reentries.length === 0) {
      list.innerHTML = '<p class="section-desc">No critical atmospheric decays predicted.</p>';
      return;
    }

    let html = '';
    reentries.forEach(r => {
      const d = r.decayEpoch ? new Date(r.decayEpoch) : null;
      const epochStr = d ? d.toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) + ' IST' : 'Pending';
      html += `
        <div class="reentry-card ${r.highInterest ? 'high-interest' : ''}">
          <div class="reentry-header">
            <strong>${r.name}</strong>
            <span class="mono-badge">NORAD ${r.noradId}</span>
          </div>
          <div class="reentry-time"><i class="fa-solid fa-fire"></i> Estimated Decay: ${epochStr} (±${r.windowHours || 12}h)</div>
          <div class="reentry-sub">Inclination: ${r.incl || 'N/A'}° • Direction: ${r.direction || 'Uncertain'}</div>
        </div>
      `;
    });
    list.innerHTML = html;
  }

  /**
   * Run Regional Ground Track Pass Analysis
   */
  runPassAnalysis() {
    const resultsContainer = document.getElementById('passesResults');
    if (!this.currentSatellite) {
      resultsContainer.innerHTML = '<p style="color: var(--accent-orange); font-size: 11px;">Please select a satellite first to analyze passes.</p>';
      return;
    }

    const reg = document.getElementById('regionSelect').value;
    let bbox = { minLat: 24, maxLat: 50, minLon: -125, maxLon: -65 }; // North America default

    if (reg === 'eu') bbox = { minLat: 35, maxLat: 70, minLon: -10, maxLon: 40 };
    else if (reg === 'apac') bbox = { minLat: -10, maxLat: 45, minLon: 70, maxLon: 150 };
    else if (reg === 'latam') bbox = { minLat: -55, maxLat: 20, minLon: -85, maxLon: -35 };
    else if (reg === 'me_africa') bbox = { minLat: -35, maxLat: 37, minLon: -20, maxLon: 55 };
    else if (reg === 'custom') {
      bbox = {
        minLat: parseFloat(document.getElementById('minLat').value) || 0,
        maxLat: parseFloat(document.getElementById('maxLat').value) || 0,
        minLon: parseFloat(document.getElementById('minLon').value) || 0,
        maxLon: parseFloat(document.getElementById('maxLon').value) || 0
      };
    }

    const passes = window.orbitEngine.analyzeRegionalPasses(
      this.currentSatellite,
      window.app.simulationTime,
      bbox,
      24
    );

    if (passes.length === 0) {
      resultsContainer.innerHTML = `<div style="padding: 10px; font-size: 11px; color: var(--text-muted);">No ground track passes detected over this region in the next 24 hours.</div>`;
      return;
    }

    let html = `<div class="passes-summary">Detected <strong>${passes.length}</strong> pass(es) over region in next 24h:</div>`;
    passes.forEach((p, i) => {
      const startStr = p.startTime.toISOString().substring(11, 19);
      const endStr = p.endTime.toISOString().substring(11, 19);
      html += `
        <div class="pass-item">
          <div class="pass-item-title">Pass #${i+1} • Duration: ${p.durationMinutes} min</div>
          <div class="pass-item-time">${startStr} UTC → ${endStr} UTC</div>
          <div class="pass-item-sub">Peak Sub-Sat: ${p.peakLat.toFixed(2)}°, ${p.peakLon.toFixed(2)}° • Alt: ${Math.round(p.minAlt)} km</div>
        </div>
      `;
    });
    resultsContainer.innerHTML = html;
  }

  /**
   * Export satellites array to standard CSV
   */
  exportSatellitesToCsv(satList, filename) {
    if (!satList || satList.length === 0) return;

    const headers = [
      'Name',
      'NORAD_ID',
      'Country',
      'Purpose',
      'Orbit_Class',
      'Altitude_km',
      'Velocity_kms',
      'Inclination_deg',
      'Period_min',
      'Latitude',
      'Longitude',
      'TLE_Line_1',
      'TLE_Line_2',
      'Source',
      'Timestamp_UTC'
    ];

    const rows = [headers.join(',')];
    const nowIso = new Date().toISOString();

    satList.forEach(s => {
      const lla = s.lastLla || window.orbitEngine.computePosition(s, new Date());
      const el = s.elements;
      const cleanName = `"${(s.name || '').replace(/"/g, '""')}"`;
      const cleanPurpose = `"${(s.purpose || '').replace(/"/g, '""')}"`;

      const row = [
        cleanName,
        s.noradId,
        s.country,
        cleanPurpose,
        s.orbitClass,
        Math.round(lla.alt),
        lla.velocity.toFixed(2),
        el.inclinationDeg.toFixed(4),
        el.periodMin.toFixed(2),
        lla.lat.toFixed(6),
        lla.lon.toFixed(6),
        `"${s.tle1}"`,
        `"${s.tle2}"`,
        `"KeepTrack API V4"`,
        nowIso
      ];
      rows.push(row.join(','));
    });

    const csvContent = 'data:text/csv;charset=utf-8,' + encodeURIComponent(rows.join('\n'));
    const link = document.createElement('a');
    link.setAttribute('href', csvContent);
    link.setAttribute('download', filename || 'satellites_export.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

