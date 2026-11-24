/**
 * SatTrack - Global Search Manager
 * Unified search for Satellite Names, NORAD IDs, Countries, Cities, and Coordinates.
 */

class SearchManager {
  constructor(inputElement, dropdownElement, clearBtn) {
    this.input = inputElement;
    this.dropdown = dropdownElement;
    this.clearBtn = clearBtn;
    this.satellites = [];
    
    this.onSelectSatellite = null;
    this.onSelectLocation = null;
    this.onToggleFollow = null;
    this.isSatelliteFollowed = null;
    
    this.debounceTimer = null;
    this.highlightedIndex = -1;
    this.currentResults = [];

    // Built-in Spaceports, Countries, and Major Cities database for instant offline flyTo
    this.knownLocations = [
      // Spaceports
      { name: 'Cape Canaveral Space Force Station', type: 'Spaceport', country: 'US', lat: 28.4889, lon: -80.5778, height: 400000 },
      { name: 'Kennedy Space Center (KSC)', type: 'Spaceport', country: 'US', lat: 28.5728, lon: -80.6490, height: 400000 },
      { name: 'Vandenberg Space Force Base', type: 'Spaceport', country: 'US', lat: 34.7420, lon: -120.5724, height: 400000 },
      { name: 'Starbase Boca Chica', type: 'Spaceport', country: 'US', lat: 25.9972, lon: -97.1561, height: 350000 },
      { name: 'Baikonur Cosmodrome', type: 'Spaceport', country: 'KZ/RU', lat: 45.9646, lon: 63.3052, height: 400000 },
      { name: 'Guiana Space Centre (Kourou)', type: 'Spaceport', country: 'FR/EU', lat: 5.2372, lon: -52.7606, height: 400000 },
      { name: 'Tanegashima Space Center', type: 'Spaceport', country: 'JP', lat: 30.4000, lon: 130.9700, height: 400000 },
      { name: 'Satish Dhawan Space Centre (Sriharikota)', type: 'Spaceport', country: 'IN', lat: 13.7200, lon: 80.2300, height: 400000 },
      { name: 'Jiuquan Satellite Launch Center', type: 'Spaceport', country: 'CN', lat: 40.9606, lon: 100.2983, height: 400000 },
      { name: 'Wenchang Space Launch Site', type: 'Spaceport', country: 'CN', lat: 19.6145, lon: 110.9511, height: 400000 },
      { name: 'Plesetsk Cosmodrome', type: 'Spaceport', country: 'RU', lat: 62.9271, lon: 40.5761, height: 400000 },

      // Countries
      { name: 'United States', type: 'Country', country: 'US', lat: 39.8283, lon: -98.5795, height: 5000000 },
      { name: 'China', type: 'Country', country: 'CN', lat: 35.8617, lon: 104.1954, height: 5000000 },
      { name: 'Russia', type: 'Country', country: 'RU', lat: 61.5240, lon: 105.3188, height: 6000000 },
      { name: 'India', type: 'Country', country: 'IN', lat: 20.5937, lon: 78.9629, height: 4000000 },
      { name: 'Japan', type: 'Country', country: 'JP', lat: 36.2048, lon: 138.2529, height: 2500000 },
      { name: 'United Kingdom', type: 'Country', country: 'UK', lat: 55.3781, lon: -3.4360, height: 1800000 },
      { name: 'France', type: 'Country', country: 'FR', lat: 46.2276, lon: 2.2137, height: 1800000 },
      { name: 'Germany', type: 'Country', country: 'DE', lat: 51.1657, lon: 10.4515, height: 1800000 },
      { name: 'Canada', type: 'Country', country: 'CA', lat: 56.1304, lon: -106.3468, height: 5500000 },
      { name: 'Australia', type: 'Country', country: 'AU', lat: -25.2744, lon: 133.7751, height: 5000000 },
      { name: 'Brazil', type: 'Country', country: 'BR', lat: -14.2350, lon: -51.9253, height: 5000000 },

      // Cities
      { name: 'Houston (NASA JSC)', type: 'City', country: 'US', lat: 29.5587, lon: -95.0900, height: 500000 },
      { name: 'Tokyo', type: 'City', country: 'JP', lat: 35.6762, lon: 139.6503, height: 500000 },
      { name: 'London', type: 'City', country: 'UK', lat: 51.5074, lon: -0.1278, height: 500000 },
      { name: 'Paris', type: 'City', country: 'FR', lat: 48.8566, lon: 2.3522, height: 500000 },
      { name: 'New York', type: 'City', country: 'US', lat: 40.7128, lon: -74.0060, height: 500000 },
      { name: 'Moscow', type: 'City', country: 'RU', lat: 55.7558, lon: 37.6173, height: 500000 },
      { name: 'Beijing', type: 'City', country: 'CN', lat: 39.9042, lon: 116.4074, height: 500000 },
      { name: 'Sydney', type: 'City', country: 'AU', lat: -33.8688, lon: 151.2093, height: 500000 }
    ];

    this.setupListeners();
  }

  setSatellites(satellites) {
    this.satellites = satellites;
  }

  setupListeners() {
    this.input.addEventListener('input', (e) => {
      const query = e.target.value.trim();
      this.clearBtn.style.display = query ? 'block' : 'none';

      clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => {
        this.performSearch(query);
      }, 150);
    });

    this.clearBtn.addEventListener('click', () => {
      this.input.value = '';
      this.clearBtn.style.display = 'none';
      this.closeDropdown();
      this.input.focus();
    });

    // Keyboard Navigation
    this.input.addEventListener('keydown', (e) => {
      if (!this.dropdown.classList.contains('active') || this.currentResults.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.highlightedIndex = (this.highlightedIndex + 1) % this.currentResults.length;
        this.updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.highlightedIndex = (this.highlightedIndex - 1 + this.currentResults.length) % this.currentResults.length;
        this.updateHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (this.highlightedIndex >= 0 && this.highlightedIndex < this.currentResults.length) {
          this.selectResult(this.currentResults[this.highlightedIndex]);
        }
      } else if (e.key === 'Escape') {
        this.closeDropdown();
      }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
      if (!this.input.contains(e.target) && !this.dropdown.contains(e.target)) {
        this.closeDropdown();
      }
    });
  }

  /**
   * Parse numeric or formatted coordinates from query
   */
  parseCoordinates(query) {
    // Standard "lat, lon" e.g., "28.57, -80.64" or "28.5728 -80.6490"
    const coordRegex = /^\s*([+-]?\d+(?:\.\d+)?)\s*[,;\s]\s*([+-]?\d+(?:\.\d+)?)\s*$/;
    const match = query.match(coordRegex);
    if (match) {
      const lat = parseFloat(match[1]);
      const lon = parseFloat(match[2]);
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon, label: `Coordinates: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°` };
      }
    }

    // Directional "28.5N, 80.6W"
    const dirRegex = /^\s*(\d+(?:\.\d+)?)\s*([NSns])\s*[,;\s]\s*(\d+(?:\.\d+)?)\s*([EWew])\s*$/;
    const dirMatch = query.match(dirRegex);
    if (dirMatch) {
      let lat = parseFloat(dirMatch[1]);
      if (dirMatch[2].toUpperCase() === 'S') lat = -lat;
      let lon = parseFloat(dirMatch[3]);
      if (dirMatch[4].toUpperCase() === 'W') lon = -lon;
      if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) {
        return { lat, lon, label: `Coordinates: ${lat.toFixed(4)}°, ${lon.toFixed(4)}°` };
      }
    }

    return null;
  }

  /**
   * Execute Search across Satellites, Locations, and Coordinates
   */
  performSearch(query) {
    if (!query) {
      this.closeDropdown();
      return;
    }

    const q = query.toLowerCase();
    const results = [];

    // 1. Check for Coordinate Input
    const coords = this.parseCoordinates(query);
    if (coords) {
      results.push({
        category: 'Coordinates',
        title: coords.label,
        sub: 'Fly directly to geographical position',
        badge: 'GEO COORD',
        data: coords,
        isCoord: true
      });
    }

    // 2. Search Satellite Fleet (Name, NORAD ID, Country, Purpose)
    const matchingSats = [];
    for (let i = 0; i < this.satellites.length; i++) {
      const sat = this.satellites[i];
      if (
        sat.name.toLowerCase().includes(q) ||
        sat.noradId.includes(q) ||
        sat.country.toLowerCase() === q
      ) {
        matchingSats.push(sat);
        if (matchingSats.length >= 8) break; // Limit top 8 sats
      }
    }

    matchingSats.forEach(sat => {
      results.push({
        category: 'Satellites',
        title: sat.name,
        sub: `NORAD: ${sat.noradId} • ${sat.country} • ${sat.orbitClass} • ${sat.purpose}`,
        badge: sat.orbitClass,
        data: sat,
        isSat: true
      });
    });

    // 3. Search Known Locations (Spaceports, Countries, Cities)
    const matchingLocs = this.knownLocations.filter(loc => 
      loc.name.toLowerCase().includes(q) ||
      loc.country.toLowerCase() === q ||
      loc.type.toLowerCase().includes(q)
    ).slice(0, 4);

    matchingLocs.forEach(loc => {
      results.push({
        category: 'Locations',
        title: loc.name,
        sub: `${loc.type} (${loc.country}) • ${loc.lat.toFixed(2)}°, ${loc.lon.toFixed(2)}°`,
        badge: loc.type.toUpperCase(),
        data: loc,
        isLoc: true
      });
    });

    this.currentResults = results;
    this.renderDropdown(results);
  }

  renderDropdown(results) {
    if (results.length === 0) {
      this.dropdown.innerHTML = `<div style="padding: 12px; font-size: 12px; color: var(--text-muted); text-align: center;">No matching satellites, countries, cities, or coordinates found.</div>`;
      this.dropdown.classList.add('active');
      return;
    }

    let html = '';
    let currentCategory = '';

    results.forEach((res, idx) => {
      if (res.category !== currentCategory) {
        currentCategory = res.category;
        html += `<div class="search-result-group-title">${currentCategory.toUpperCase()}</div>`;
      }

      let rightHtml = `<span class="search-item-badge">${res.badge}</span>`;
      if (res.isSat) {
        const isFollowed = typeof this.isSatelliteFollowed === 'function' ? this.isSatelliteFollowed(res.data.noradId) : false;
        rightHtml = `
          <div class="search-item-right">
            <span class="search-item-badge">${res.badge}</span>
            <button class="search-follow-btn ${isFollowed ? 'following' : ''}" data-idx="${idx}" title="Toggle Follow">
              <i class="fa-solid ${isFollowed ? 'fa-check' : 'fa-plus'}"></i>
              <span>${isFollowed ? 'Following' : 'Follow'}</span>
            </button>
          </div>
        `;
      }

      html += `
        <div class="search-item" data-index="${idx}">
          <div class="search-item-main">
            <span class="search-item-title">${this.escapeHtml(res.title)}</span>
            <span class="search-item-sub">${this.escapeHtml(res.sub)}</span>
          </div>
          ${rightHtml}
        </div>
      `;
    });

    this.dropdown.innerHTML = html;
    this.dropdown.classList.add('active');
    this.highlightedIndex = 0;
    this.updateHighlight();

    // Click handler on results
    this.dropdown.querySelectorAll('.search-item').forEach(el => {
      el.addEventListener('click', (e) => {
        // If clicking follow button, don't trigger item selection
        if (e.target.closest('.search-follow-btn')) return;
        const idx = parseInt(el.dataset.index, 10);
        this.selectResult(this.currentResults[idx]);
      });
    });

    // Follow button click handlers
    this.dropdown.querySelectorAll('.search-follow-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx, 10);
        const item = this.currentResults[idx];
        if (item && item.isSat && typeof this.onToggleFollow === 'function') {
          const nowFollowed = this.onToggleFollow(item.data);
          btn.classList.toggle('following', nowFollowed);
          btn.innerHTML = `<i class="fa-solid ${nowFollowed ? 'fa-check' : 'fa-plus'}"></i> <span>${nowFollowed ? 'Following' : 'Follow'}</span>`;
        }
      });
    });
  }

  updateHighlight() {
    const items = this.dropdown.querySelectorAll('.search-item');
    items.forEach((item, idx) => {
      if (idx === this.highlightedIndex) {
        item.classList.add('highlighted');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('highlighted');
      }
    });
  }

  selectResult(result) {
    if (!result) return;
    this.closeDropdown();
    this.input.value = result.title;

    if (result.isSat && typeof this.onSelectSatellite === 'function') {
      this.onSelectSatellite(result.data);
    } else if (result.isCoord && typeof this.onSelectLocation === 'function') {
      this.onSelectLocation(result.data.lat, result.data.lon, 600000, result.title);
    } else if (result.isLoc && typeof this.onSelectLocation === 'function') {
      this.onSelectLocation(result.data.lat, result.data.lon, result.data.height, result.data.name);
    }
  }

  closeDropdown() {
    this.dropdown.classList.remove('active');
    this.highlightedIndex = -1;
  }

  escapeHtml(str) {
    return (str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }
}

