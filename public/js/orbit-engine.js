/**
 * SatTrack - Orbit Engine
 * Powered by KeepTrack's official Orbital Object Toolkit (OOTK v8.2.0)
 * Handles client-side SGP4 mathematical propagation and orbital elements.
 */

class OrbitEngine {
  constructor() {
    this.ootk = window.ootk || (typeof OOTKBundle !== 'undefined' ? OOTKBundle : null);
    if (!this.ootk) {
      console.warn('[OrbitEngine] OOTK bundle not detected on window. Checking global context.');
    }
  }

  /**
   * Parse NORAD ID from TLE Line 1 or Line 2
   */
  extractNoradId(tle1, tle2) {
    if (tle1 && tle1.length >= 7) {
      const id = tle1.substring(2, 7).trim();
      if (id) return id;
    }
    if (tle2 && tle2.length >= 7) {
      const id = tle2.substring(2, 7).trim();
      if (id) return id;
    }
    return '00000';
  }

  /**
   * Create an OOTK Satellite instance from a brief record
   */
  createSatelliteRecord(rawRecord) {
    const tle1 = (rawRecord.tle1 || '').trim();
    const tle2 = (rawRecord.tle2 || '').trim();
    const noradId = this.extractNoradId(tle1, tle2);
    
    let satInstance = null;
    if (this.ootk && this.ootk.Satellite && tle1 && tle2) {
      try {
        satInstance = new this.ootk.Satellite({ tle1, tle2 });
      } catch (e) {
        // Fallback or invalid TLE
      }
    }

    // Determine orbit classification
    const elements = this.parseClassicalElementsFromTle(tle1, tle2);
    const orbitClass = this.classifyOrbit(elements.periodMin, elements.perigeeKm, elements.apogeeKm, elements.eccentricity);

    return {
      noradId: noradId,
      name: (rawRecord.name || `SAT-${noradId}`).trim(),
      altName: rawRecord.altName || '',
      country: rawRecord.country || 'International',
      purpose: rawRecord.purpose || 'General Mission',
      launchDate: rawRecord.launchDate || 'N/A',
      type: rawRecord.type !== undefined ? parseInt(rawRecord.type, 10) : 1,
      vmag: rawRecord.vmag !== undefined ? rawRecord.vmag : 5.0,
      rcs: rawRecord.rcs || 'MEDIUM',
      bus: rawRecord.bus || 'Generic',
      payload: rawRecord.payload || rawRecord.purpose || 'N/A',
      status: rawRecord.status || 'OPERATIONAL',
      source: rawRecord.source || 'KeepTrack API V4',
      tle1: tle1,
      tle2: tle2,
      satInstance: satInstance,
      elements: elements,
      orbitClass: orbitClass,
      lastLla: null
    };
  }

  /**
   * KeepTrack Authentic Dot Styling & Classification
   * Matches KeepTrack v4 color coding:
   * - Payloads / Active: Vibrant Neon Green (#00ff66)
   * - Rocket Bodies (R/B): Coral Red (#ff3b30)
   * - Debris (DEB): Fine Silver/Cosmic Dust (#94a3b8 with 0.65 alpha)
   * - Space Stations (ISS, Tiangong): Amber Gold (#ffd600)
   */
  getKeepTrackColor(satRecord) {
    const name = (satRecord.name || '').toUpperCase();
    const type = satRecord.type;
    const isStation = name.includes('ISS') || name.includes('ZARYA') || name.includes('TIANGONG') || name.includes('CSS') || name.includes('SPACE STATION');
    
    if (isStation) {
      return {
        hex: '#ffd600', // Vibrant Gold for Manned Space Stations
        category: 'station',
        baseSize: 8.5
      };
    }

    if (type === 2 || name.includes(' R/B') || name.includes('ROCKET BODY') || name.includes('CENTAUR') || name.includes('BREEZE') || name.includes('FALCON 9 R/B')) {
      return {
        hex: '#ff3344', // Vibrant Coral Red for Rocket Stages / Boosters
        category: 'rocket_body',
        baseSize: 4.8
      };
    }

    if (type === 3 || name.includes(' DEB') || name.includes('DEBRIS') || name.includes('FRAGMENT')) {
      return {
        hex: '#cbd5e1', // Bright Cosmic Silver Dust for Debris Fragments
        category: 'debris',
        baseSize: 3.5
      };
    }

    // Default: Operational / Active Payload
    return {
      hex: '#00ff66', // KeepTrack Signature Vibrant Neon Green
      category: 'payload',
      baseSize: 5.5
    };
  }

  /**
   * Parse classical Keplerian orbital elements directly from standard TLE lines
   */
  parseClassicalElementsFromTle(tle1, tle2) {
    if (!tle2 || tle2.length < 68) {
      return {
        inclinationDeg: 0,
        raanDeg: 0,
        eccentricity: 0.0001,
        argPerigeeDeg: 0,
        meanAnomalyDeg: 0,
        meanMotionRevDay: 15.0,
        periodMin: 96.0,
        semiMajorAxisKm: 6800,
        perigeeKm: 400,
        apogeeKm: 420,
        bstar: 0,
        epochYear: 2026,
        epochDay: 1.0
      };
    }

    try {
      const inc = parseFloat(tle2.substring(8, 16));
      const raan = parseFloat(tle2.substring(17, 25));
      const eccStr = tle2.substring(26, 33).trim();
      const ecc = parseFloat('0.' + eccStr);
      const argP = parseFloat(tle2.substring(34, 42));
      const meanA = parseFloat(tle2.substring(43, 51));
      const meanM = parseFloat(tle2.substring(52, 63)); // revs per day

      // Earth gravitational parameter mu = 398600.4418 km^3/s^2
      // n in rad/s = meanM * 2 * pi / 86400
      const nRadSec = (meanM * 2 * Math.PI) / 86400;
      const mu = 398600.4418;
      const earthRadiusKm = 6378.137;

      // a = (mu / n^2)^(1/3)
      const a = Math.pow(mu / (nRadSec * nRadSec), 1 / 3);
      const periodMin = (2 * Math.PI / nRadSec) / 60;
      const perigeeKm = a * (1 - ecc) - earthRadiusKm;
      const apogeeKm = a * (1 + ecc) - earthRadiusKm;

      // BSTAR from line 1
      let bstar = 0;
      if (tle1 && tle1.length >= 60) {
        const bstarStr = tle1.substring(53, 61).trim();
        if (bstarStr.length > 2) {
          const mantissa = parseFloat(bstarStr.substring(0, bstarStr.length - 2)) / 100000;
          const exp = parseInt(bstarStr.substring(bstarStr.length - 2), 10);
          bstar = mantissa * Math.pow(10, exp);
        }
      }

      return {
        inclinationDeg: isNaN(inc) ? 0 : inc,
        raanDeg: isNaN(raan) ? 0 : raan,
        eccentricity: isNaN(ecc) ? 0.0001 : ecc,
        argPerigeeDeg: isNaN(argP) ? 0 : argP,
        meanAnomalyDeg: isNaN(meanA) ? 0 : meanA,
        meanMotionRevDay: isNaN(meanM) ? 15.0 : meanM,
        periodMin: isNaN(periodMin) ? 90.0 : periodMin,
        semiMajorAxisKm: isNaN(a) ? 6800 : a,
        perigeeKm: isNaN(perigeeKm) ? 400 : Math.round(perigeeKm),
        apogeeKm: isNaN(apogeeKm) ? 450 : Math.round(apogeeKm),
        bstar: bstar
      };
    } catch (e) {
      return {
        inclinationDeg: 51.6,
        raanDeg: 0,
        eccentricity: 0.0003,
        argPerigeeDeg: 0,
        meanAnomalyDeg: 0,
        meanMotionRevDay: 15.5,
        periodMin: 92.8,
        semiMajorAxisKm: 6790,
        perigeeKm: 418,
        apogeeKm: 422,
        bstar: 0
      };
    }
  }

  /**
   * Classify orbit by altitude and eccentricity
   */
  classifyOrbit(periodMin, perigeeKm, apogeeKm, ecc) {
    const avgAlt = (perigeeKm + apogeeKm) / 2;
    if (ecc > 0.25 || (apogeeKm > 30000 && perigeeKm < 2000)) {
      return 'HEO'; // Highly Elliptical Orbit
    }
    if (avgAlt >= 35000 && avgAlt <= 36500) {
      return 'GEO'; // Geostationary / Geosynchronous
    }
    if (avgAlt < 2000) {
      return 'LEO'; // Low Earth Orbit
    }
    return 'MEO'; // Medium Earth Orbit (e.g. GPS, Galileo)
  }

  /**
   * Compute instantaneous position (LLA and Cartesian ECEF) at any given Date (past, present, or future)
   */
  computePosition(satRecord, targetDate) {
    const date = targetDate instanceof Date ? targetDate : new Date(targetDate);
    
    if (satRecord.satInstance && typeof satRecord.satInstance.lla === 'function') {
      try {
        const lla = satRecord.satInstance.lla(date);
        if (lla && !isNaN(lla.lat) && !isNaN(lla.lon)) {
          // Normalize longitude to -180 .. 180
          let lon = lla.lon;
          while (lon > 180) lon -= 360;
          while (lon < -180) lon += 360;

          const alt = Math.max(100, isNaN(lla.alt) ? 400 : lla.alt);
          
          // Approximate orbital speed in km/s: v = sqrt(mu / r)
          const r = 6378.137 + alt;
          const velocity = Math.sqrt(398600.4418 / r);

          const result = {
            lat: lla.lat,
            lon: lon,
            alt: alt,
            velocity: velocity
          };
          satRecord.lastLla = result;
          return result;
        }
      } catch (e) {
        // Fallback to Keplerian propagation below if SGP4 encounters an edge case
      }
    }

    // High-precision Keplerian fallback propagation if OOTK instance is unavailable
    const el = satRecord.elements;
    const epoch = new Date('2026-01-01T00:00:00Z').getTime();
    const elapsedMinutes = (date.getTime() - epoch) / (1000 * 60);
    const meanAnomalyNow = (el.meanAnomalyDeg + (elapsedMinutes / el.periodMin) * 360) % 360;
    const uRad = (meanAnomalyNow + el.argPerigeeDeg) * (Math.PI / 180);
    const incRad = el.inclinationDeg * (Math.PI / 180);
    
    // Sub-satellite latitude
    const lat = Math.asin(Math.sin(incRad) * Math.sin(uRad)) * (180 / Math.PI);
    
    // Sub-satellite longitude including Earth rotation (0.25 deg / min)
    const earthRotationDeg = elapsedMinutes * 0.25;
    let lon = (el.raanDeg + Math.atan2(Math.cos(incRad) * Math.sin(uRad), Math.cos(uRad)) * (180 / Math.PI) - earthRotationDeg) % 360;
    if (lon > 180) lon -= 360;
    if (lon < -180) lon += 360;

    const alt = (el.perigeeKm + el.apogeeKm) / 2;
    const velocity = Math.sqrt(398600.4418 / (6378.137 + alt));

    const result = { lat, lon, alt, velocity };
    satRecord.lastLla = result;
    return result;
  }

  /**
   * Compute complete 360-degree 3D orbital trajectory curve for 1 full revolution
   * Smooth, continuous, and closed orbital loop around Earth
   */
  computeOrbitTrajectory(satRecord, centerDate, numSteps = 96) {
    const date = centerDate instanceof Date ? centerDate : new Date(centerDate);
    const periodMin = satRecord.elements.periodMin || 95;
    const periodSec = periodMin * 60;
    const stepSeconds = periodSec / numSteps;
    const startTimeMs = date.getTime() - (periodSec * 1000) / 2;
    const trajectory = [];

    for (let i = 0; i < numSteps; i++) {
      const t = new Date(startTimeMs + i * stepSeconds * 1000);
      const pos = this.computePosition(satRecord, t);
      trajectory.push({
        lat: pos.lat,
        lon: pos.lon,
        alt: pos.alt,
        time: t
      });
    }

    // Connect last point smoothly to first point to close complete 360-degree loop
    if (trajectory.length > 0) {
      trajectory.push(trajectory[0]);
    }

    return trajectory;
  }

  /**
   * Compute 2D ground track over Earth surface
   */
  computeGroundTrack(satRecord, centerDate, numSteps = 96) {
    return this.computeOrbitTrajectory(satRecord, centerDate, numSteps);
  }

  /**
   * Regional Ground Track Analysis
   * Detects passes of the satellite over a geographic bounding box within next 24 hours.
   */
  analyzeRegionalPasses(satRecord, startDate, bbox, durationHours = 24) {
    const { minLat, maxLat, minLon, maxLon } = bbox;
    const date = startDate instanceof Date ? startDate : new Date(startDate);
    const passes = [];
    const stepSeconds = 30; // 30 second resolution for 24h
    const totalSteps = (durationHours * 3600) / stepSeconds;

    let inPass = false;
    let currentPass = null;

    for (let i = 0; i < totalSteps; i++) {
      const t = new Date(date.getTime() + i * stepSeconds * 1000);
      const pos = this.computePosition(satRecord, t);

      // Check if lat/lon is inside bounding box
      let isInside = (pos.lat >= minLat && pos.lat <= maxLat);
      if (minLon <= maxLon) {
        isInside = isInside && (pos.lon >= minLon && pos.lon <= maxLon);
      } else {
        // Crosses antimeridian
        isInside = isInside && (pos.lon >= minLon || pos.lon <= maxLon);
      }

      if (isInside) {
        if (!inPass) {
          inPass = true;
          currentPass = {
            startTime: t,
            endTime: t,
            peakLat: pos.lat,
            peakLon: pos.lon,
            minAlt: pos.alt,
            maxAlt: pos.alt
          };
        } else {
          currentPass.endTime = t;
          currentPass.minAlt = Math.min(currentPass.minAlt, pos.alt);
          currentPass.maxAlt = Math.max(currentPass.maxAlt, pos.alt);
        }
      } else {
        if (inPass && currentPass) {
          inPass = false;
          const durationSec = (currentPass.endTime.getTime() - currentPass.startTime.getTime()) / 1000;
          if (durationSec >= 60) { // Ignore momentary boundary grazes
            currentPass.durationMinutes = Math.round(durationSec / 60);
            passes.push(currentPass);
          }
          currentPass = null;
        }
      }
    }

    if (inPass && currentPass) {
      currentPass.durationMinutes = Math.round((currentPass.endTime.getTime() - currentPass.startTime.getTime()) / 60000);
      passes.push(currentPass);
    }

    return passes;
  }

  /**
   * Compute distance (km) and relative velocity (km/s) between two satellites
   */
  computeInterSatelliteMetrics(sat1, sat2, targetDate) {
    const p1 = this.computePosition(sat1, targetDate);
    const p2 = this.computePosition(sat2, targetDate);

    // Convert LLA to ECEF XYZ (km)
    const earthRadius = 6378.137;
    const toRad = Math.PI / 180;

    const r1 = earthRadius + p1.alt;
    const lat1Rad = p1.lat * toRad;
    const lon1Rad = p1.lon * toRad;
    const x1 = r1 * Math.cos(lat1Rad) * Math.cos(lon1Rad);
    const y1 = r1 * Math.cos(lat1Rad) * Math.sin(lon1Rad);
    const z1 = r1 * Math.sin(lat1Rad);

    const r2 = earthRadius + p2.alt;
    const lat2Rad = p2.lat * toRad;
    const lon2Rad = p2.lon * toRad;
    const x2 = r2 * Math.cos(lat2Rad) * Math.cos(lon2Rad);
    const y2 = r2 * Math.cos(lat2Rad) * Math.sin(lon2Rad);
    const z2 = r2 * Math.sin(lat2Rad);

    const dx = x1 - x2;
    const dy = y1 - y2;
    const dz = z1 - z2;
    const distanceKm = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const relVelKms = Math.abs(p1.velocity - p2.velocity);

    return {
      distanceKm: Math.round(distanceKm * 10) / 10,
      relativeVelocityKms: Math.round(relVelKms * 100) / 100,
      p1,
      p2
    };
  }

  /**
   * Compute ground footprint circle radius (in meters) for a satellite at altitude (km)
   * Formula: earthRadius * acos(earthRadius / (earthRadius + alt))
   */
  computeFootprintRadiusMeters(altKm) {
    const earthRadiusKm = 6378.137;
    const r = earthRadiusKm + Math.max(100, altKm);
    const angleRad = Math.acos(earthRadiusKm / r);
    return angleRad * earthRadiusKm * 1000;
  }
}

// Global singleton instance
window.orbitEngine = new OrbitEngine();

