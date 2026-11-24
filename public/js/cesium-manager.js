/**
 * SatTrack - Cesium 3D Globe Manager
 * Integrates CesiumJS with high-resolution satellite imagery (Esri World Imagery),
 * geographic borders/labels, PointPrimitiveCollection for high-FPS satellite rendering,
 * and orbital trajectory visualization.
 */

class CesiumManager {
  constructor(containerId) {
    this.containerId = containerId;
    this.viewer = null;
    this.pointCollection = null;
    this.satPointMap = new Map(); // noradId -> PointPrimitive
    
    this.selectedSatellite = null;
    this.isTrackingSelected = false;
    this.followTargetSat = null;
    this.hasInitializedFollow = false;
    
    // Multi-Satellite Follow Map: noradId -> followData
    this.followedSatellites = new Map();
    this.followColorPalette = [
      '#00f0ff', // Electric Cyan
      '#ffd600', // Amber Gold
      '#ff3d71', // Neon Pink/Red
      '#00e676', // Emerald Green
      '#c084fc', // Neon Purple
      '#38bdf8', // Sky Blue
      '#ff9100', // Bright Orange
      '#f43f5e'  // Rose
    ];

    // Visibility toggles
    this.showFootprints = true;
    this.showGroundTracks = true;
    this.showTrajectories = true;
    
    // Dynamic visualization entities for primary selected
    this.trajectoryEntity = null;
    this.groundTrackEntity = null;
    this.nadirLineEntity = null;
    this.selectedMarkerEntity = null;
    this.searchLocationEntity = null;

    // Fleet Trajectory Visualization (for all filtered country/fleet satellites)
    this.fleetTrajectoryEntities = [];
    this.showFleetTrajectories = false;

    // Filtered Norad Set (null means all satellites allowed)
    this.filteredNoradSet = null;

    // Background Fleet Display: 'all' (100%), 'dim' (10% opacity, 90% dimmed), 'hide' (solo only)
    this.backgroundFleetMode = 'all';
    this.backgroundFleetOpacity = 1.0;

    // Layer references
    this.esriLayer = null;
    this.labelsLayer = null;

    // Performance optimization for large catalogs (50,000+ satellites)
    this.updateChunkIndex = 0;
    this.chunkSize = 3500;

    // Callbacks
    this.onSatelliteClick = null;
    this.onHover = null;
    
    this.initCesium();
  }

  initCesium() {
    // Disable Cesium Ion default warning if no ion key is provided
    Cesium.Ion.defaultAccessToken = '';

    // Initialize Cesium Viewer with baseLayer: false to prevent Ion default asset loading
    this.viewer = new Cesium.Viewer(this.containerId, {
      baseLayer: false,
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      showRenderLoopErrors: false,
      creditContainer: 'cesiumCredit'
    });

    // Add Base Imagery Provider (Esri World Imagery - High-Resolution True Color)
    // UrlTemplateImageryProvider avoids any uninitialized Resource objects
    try {
      const esriImagery = new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri, Maxar, Earthstar Geographics, USDA, USGS, AeroGRID, IGN',
        maximumLevel: 19
      });
      this.esriLayer = this.viewer.imageryLayers.addImageryProvider(esriImagery);
    } catch (e) {
      console.warn('[CesiumManager] Could not initialize Esri imagery layer:', e);
    }

    // Add Second Layer: Esri Reference Country Borders & Geographic Labels (Watermark-Free)
    try {
      const labelsProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        credit: 'Esri, HERE, Garmin, OpenStreetMap contributors',
        maximumLevel: 19
      });
      this.labelsLayer = this.viewer.imageryLayers.addImageryProvider(labelsProvider);
    } catch (e) {
      console.warn('[CesiumManager] Could not initialize labels layer:', e);
    }

    // Configure Atmospheric & Lighting Effects
    const scene = this.viewer.scene;
    scene.backgroundColor = Cesium.Color.BLACK;
    const globe = scene.globe;
    globe.baseColor = Cesium.Color.BLACK;
    globe.enableLighting = false; // Real-time sun lighting toggleable
    globe.showGroundAtmosphere = true;
    globe.depthTestAgainstTerrain = true; // Occlude objects and lines on the other side of Earth

    // Add high-performance PointPrimitiveCollection for satellite fleet
    this.pointCollection = scene.primitives.add(new Cesium.PointPrimitiveCollection({
      blendOption: Cesium.BlendOption.OPAQUE_AND_TRANSLUCENT
    }));

    // Setup User Interaction Handlers
    this.setupInteractionHandlers();

    // Default Camera Framing over Earth
    this.viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(-30.0, 20.0, 22000000.0)
    });
  }

  setupInteractionHandlers() {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);

    // Click on 3D Object
    handler.setInputAction((click) => {
      const pickedObject = this.viewer.scene.pick(click.position);
      if (Cesium.defined(pickedObject) && pickedObject.primitive && pickedObject.primitive._noradId) {
        const noradId = pickedObject.primitive._noradId;
        if (typeof this.onSatelliteClick === 'function') {
          this.onSatelliteClick(noradId);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // Hover Tooltip
    handler.setInputAction((movement) => {
      const pickedObject = this.viewer.scene.pick(movement.endPosition);
      if (Cesium.defined(pickedObject) && pickedObject.primitive && pickedObject.primitive._satRecord) {
        if (typeof this.onHover === 'function') {
          this.onHover(pickedObject.primitive._satRecord, movement.endPosition);
        }
      } else {
        if (typeof this.onHover === 'function') {
          this.onHover(null, null);
        }
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
  }

  /**
   * Populate the PointPrimitiveCollection with all satellites in the catalog
   * Styled according to official KeepTrack space surveillance radar standards:
   * - Payloads / Active: Vibrant Neon Green (#00ff66, 2.0px)
   * - Rocket Bodies (R/B): Vibrant Coral Red (#ff3b30, 1.8px)
   * - Debris (DEB): Fine Cosmic Silver Dust (#94a3b8, 1.4px, 0.65 alpha)
   * - Space Stations (ISS, Tiangong): Amber Gold (#ffd600, 3.2px)
   * - Distance scaling: gracefully scale to tiny pinpricks when zooming into deep space
   */
  loadSatellites(satRecords, simulationDate) {
    this.pointCollection.removeAll();
    this.satPointMap.clear();

    const date = simulationDate || new Date();

    satRecords.forEach(sat => {
      const pos = window.orbitEngine.computePosition(sat, date);
      const cartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);

      const style = window.orbitEngine.getKeepTrackColor(sat);
      const cesiumColor = Cesium.Color.fromCssColorString(style.hex);
      if (style.category === 'debris') {
        cesiumColor.alpha = 0.65;
      }

      const point = this.pointCollection.add({
        position: cartesian,
        pixelSize: style.baseSize,
        color: cesiumColor,
        outlineColor: Cesium.Color.fromCssColorString('#050b14'),
        outlineWidth: 1.2,
        scaleByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 4.5e7, 0.38),
        translucencyByDistance: new Cesium.NearFarScalar(1.5e6, 1.0, 6.0e7, 0.82)
      });

      point._noradId = sat.noradId;
      point._satRecord = sat;
      point._baseColor = cesiumColor;
      point._baseSize = style.baseSize;
      point._category = style.category;
      this.satPointMap.set(sat.noradId, point);
    });

    this.applyFleetVisibility();
  }

  /**
   * Set filtered set of NORAD IDs to display on the 3D globe (null = all allowed)
   */
  setFilteredNorads(noradSet) {
    this.filteredNoradSet = noradSet;
    this.applyFleetVisibility();
  }

  /**
   * Set background fleet display mode ('all' | 'dim' | 'hide') and opacity (0.0 to 1.0)
   * 'dim' lowers opacity by 90% (to 0.10)
   * 'hide' completely hides all non-tracked satellites (solo focus)
   */
  setBackgroundFleetDisplay(mode, opacity) {
    if (mode) this.backgroundFleetMode = mode;
    if (opacity !== undefined) {
      this.backgroundFleetOpacity = opacity;
    } else {
      if (this.backgroundFleetMode === 'all') this.backgroundFleetOpacity = 1.0;
      else if (this.backgroundFleetMode === 'dim') this.backgroundFleetOpacity = 0.10; // 90% dimmed
      else if (this.backgroundFleetMode === 'hide') this.backgroundFleetOpacity = 0.0;
    }
    this.applyFleetVisibility();
  }

  /**
   * Apply visibility & opacity across all satellites in pointCollection
   */
  applyFleetVisibility() {
    if (!this.pointCollection) return;
    const mode = this.backgroundFleetMode;
    const opacity = (this.backgroundFleetOpacity !== undefined) ? this.backgroundFleetOpacity : 1.0;

    // 1. If mode is 'hide' or opacity is near zero:
    // Completely hide the 50,000 background point collection instantly.
    // Selected and followed satellites remain visible via their individual Cesium entities.
    if (mode === 'hide' || opacity <= 0.01) {
      this.pointCollection.show = false;
      return;
    }

    // 2. Otherwise ensure the background point collection is visible
    this.pointCollection.show = true;
    if (this.satPointMap.size === 0) return;

    const activeNorads = new Set();
    if (this.selectedSatellite) {
      activeNorads.add(this.selectedSatellite.noradId);
    }
    for (const [noradId] of this.followedSatellites) {
      activeNorads.add(noradId);
    }

    const hasFilter = this.filteredNoradSet !== null && this.filteredNoradSet !== undefined;
    const isDim = (mode === 'dim' || opacity < 0.95);
    const effectiveAlpha = isDim ? Math.max(0.06, opacity) : 1.0;
    const effectiveSize = isDim ? Math.max(2, Math.round(4 * opacity)) : 5;

    this.satPointMap.forEach((point, noradId) => {
      const isTracked = activeNorads.has(noradId);
      const isAllowedByFilter = !hasFilter || this.filteredNoradSet.has(noradId);

      if (!isAllowedByFilter) {
        // Satellite does NOT match active country or filter - HIDE IT 100%!
        point.show = false;
        point.color = Cesium.Color.TRANSPARENT;
        point.pixelSize = 0;
      } else if (isTracked) {
        point.show = true;
        if (this.selectedSatellite && noradId === this.selectedSatellite.noradId) {
          point.color = Cesium.Color.fromCssColorString('#ffd600');
          point.pixelSize = 8.5;
          point.outlineColor = Cesium.Color.WHITE;
          point.outlineWidth = 2.0;
        } else if (this.followedSatellites.has(noradId)) {
          const followData = this.followedSatellites.get(noradId);
          point.color = followData.cesiumColor;
          point.pixelSize = 7.0;
          point.outlineColor = Cesium.Color.fromCssColorString('#050b14');
          point.outlineWidth = 1.5;
        } else {
          point.color = point._baseColor;
          point.pixelSize = point._baseSize || 5.5;
          point.outlineColor = Cesium.Color.fromCssColorString('#050b14');
          point.outlineWidth = 1.2;
        }
      } else {
        // Satellite matches active country/filter - bold & prominent over land!
        point.show = true;
        if (isDim) {
          const base = point._baseColor;
          point.color = base.withAlpha(effectiveAlpha);
          point.pixelSize = Math.max(2.5, (point._baseSize || 5.5) * opacity);
          point.outlineColor = Cesium.Color.TRANSPARENT;
          point.outlineWidth = 0;
        } else {
          point.color = point._baseColor;
          point.pixelSize = point._baseSize || 5.5;
          point.outlineColor = Cesium.Color.fromCssColorString('#050b14');
          point.outlineWidth = 1.2;
        }
      }
    });
  }

  /**
   * Update positions of satellites for current simulation date/time
   * Uses interleaved chunk updating for large catalogs (50,000+) to sustain 60 FPS
   */
  updateSatellitePositions(satRecords, simulationDate, isHighSpeed = false) {
    if (!this.pointCollection || satRecords.length === 0) return;
    const date = simulationDate || new Date();

    // 1. ALWAYS update the active selected satellite at 60 FPS
    if (this.selectedSatellite) {
      const pos = window.orbitEngine.computePosition(this.selectedSatellite, date);
      const point = this.satPointMap.get(this.selectedSatellite.noradId);
      if (point && this.pointCollection.show) {
        point.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
      }
      this.updateSelectedSatelliteVisuals(this.selectedSatellite, pos, date);
    }

    // 1b. Update all multi-followed satellites markers & footprints
    if (this.followedSatellites.size > 0) {
      this.updateFollowedVisuals(date);
    }

    // If background fleet is hidden, skip propagating 50,000 background points for peak FPS
    if (!this.pointCollection.show) {
      return;
    }

    // 2. Interleaved slice update for the satellite fleet
    const total = satRecords.length;
    if (total <= 3500) {
      for (let i = 0; i < total; i++) {
        const sat = satRecords[i];
        const point = this.satPointMap.get(sat.noradId);
        if (point && point.show) {
          const pos = window.orbitEngine.computePosition(sat, date);
          point.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
        }
      }
    } else if (isHighSpeed) {
      // During fast-forward simulation (100x+), update every 2nd or 3rd satellite
      const step = 2;
      for (let i = 0; i < total; i += step) {
        const sat = satRecords[i];
        const point = this.satPointMap.get(sat.noradId);
        if (point && point.show) {
          const pos = window.orbitEngine.computePosition(sat, date);
          point.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
        }
      }
    } else {
      // Chunked 3,500 points per frame -> takes ~2ms per frame, ensuring steady 60 FPS
      const start = this.updateChunkIndex;
      const end = Math.min(start + this.chunkSize, total);
      for (let i = start; i < end; i++) {
        const sat = satRecords[i];
        const point = this.satPointMap.get(sat.noradId);
        if (point && point.show) {
          const pos = window.orbitEngine.computePosition(sat, date);
          point.position = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
        }
      }
      this.updateChunkIndex = (end >= total) ? 0 : end;
    }
  }

  /**
   * Highlight and render trajectory for selected satellite
   */
  selectSatellite(satRecord, simulationDate) {
    if (this.selectedSatellite && this.selectedSatellite.noradId !== satRecord.noradId) {
      const prevPoint = this.satPointMap.get(this.selectedSatellite.noradId);
      if (prevPoint) prevPoint.show = true;
    }
    this.selectedSatellite = satRecord;
    const currentPoint = this.satPointMap.get(satRecord.noradId);
    if (currentPoint) currentPoint.show = false; // Hide 2D background dot so 3D model is clean

    const date = simulationDate || new Date();
    const pos = window.orbitEngine.computePosition(satRecord, date);

    // Apply fleet visibility with current background mode & highlights
    this.applyFleetVisibility();

    // Render Trajectory, Ground Track, and Nadir Line
    this.renderOrbitVisuals(satRecord, date);
    this.updateSelectedSatelliteVisuals(satRecord, pos, date);
  }

  /**
   * Deselect current satellite and clear its trajectory/visuals
   */
  deselectSatellite() {
    if (this.selectedSatellite) {
      const prevPoint = this.satPointMap.get(this.selectedSatellite.noradId);
      if (prevPoint) prevPoint.show = true;
    }
    this.selectedSatellite = null;
    if (this.trajectoryEntity) {
      this.viewer.entities.remove(this.trajectoryEntity);
      this.trajectoryEntity = null;
    }
    if (this.groundTrackEntity) {
      this.viewer.entities.remove(this.groundTrackEntity);
      this.groundTrackEntity = null;
    }
    if (this.nadirLineEntity) {
      this.viewer.entities.remove(this.nadirLineEntity);
      this.nadirLineEntity = null;
    }
    if (this.selectedMarkerEntity) {
      this.viewer.entities.remove(this.selectedMarkerEntity);
      this.selectedMarkerEntity = null;
    }
    if (this.footprintEntity) {
      this.viewer.entities.remove(this.footprintEntity);
      this.footprintEntity = null;
    }
    this.stopFollowing();
    this.applyFleetVisibility();
    const ktHud = document.getElementById('ktTargetOverlay');
    if (ktHud) ktHud.style.display = 'none';
    this.viewer.scene.requestRender();
  }

  /**
   * Render 3D orbital trajectory and ground track
   */
  renderOrbitVisuals(satRecord, date) {
    // Clear previous visuals
    if (this.trajectoryEntity) {
      this.viewer.entities.remove(this.trajectoryEntity);
      this.trajectoryEntity = null;
    }
    if (this.groundTrackEntity) {
      this.viewer.entities.remove(this.groundTrackEntity);
      this.groundTrackEntity = null;
    }
    if (this.nadirLineEntity) {
      this.viewer.entities.remove(this.nadirLineEntity);
      this.nadirLineEntity = null;
    }

    const orbitPoints = window.orbitEngine.computeOrbitTrajectory(satRecord, date, 96);
    
    // 1. 3D Orbital Trajectory Polyline - Complete 360-degree closed orbit path
    const trajectoryCartesians = orbitPoints.map(p => 
      Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * 1000)
    );
    if (trajectoryCartesians.length > 2) {
      trajectoryCartesians.push(trajectoryCartesians[0]);
    }

    this.trajectoryEntity = this.viewer.entities.add({
      polyline: {
        positions: trajectoryCartesians,
        width: 1.8,
        material: new Cesium.ColorMaterialProperty(
          Cesium.Color.fromCssColorString('#ffd600').withAlpha(0.95)
        )
      }
    });

    // 2. Surface Ground Track Polyline (ellipsoid surface) - only if enabled
    const showGroundTrack = document.getElementById('layerGroundTrack')?.checked ?? false;
    if (showGroundTrack) {
      const groundTrackCartesians = orbitPoints.map(p => 
        Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1200.0) // slightly above surface to prevent clipping
      );

      this.groundTrackEntity = this.viewer.entities.add({
        polyline: {
          positions: groundTrackCartesians,
          width: 1.2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#ff9100').withAlpha(0.85),
            dashLength: 12.0
          })
        }
      });
    }
  }

  /**
   * Render 3D orbital trajectories for all filtered satellites (fleet paths)
   * High performance: safely capped at 300 to sustain steady 60 FPS
   * Uses KeepTrack authentic color-coded paths (Green for payloads, Red for rocket bodies, Gold for stations)
   * @param {Array} satRecords - Filtered satellites (e.g. all 202 Indian satellites)
   * @param {Date} simulationDate - Current simulation date
   * @returns {number} Number of trajectories successfully rendered
   */
  showFleetTrajectories(satRecords, simulationDate) {
    this.clearFleetTrajectories();
    if (!satRecords || satRecords.length === 0) return 0;

    const date = simulationDate || new Date();
    const maxTrajectories = 250;
    const targets = satRecords.slice(0, maxTrajectories);

    // Suspend entity change events to batch add with zero stutter
    this.viewer.entities.suspendEvents();

    try {
      for (let i = 0; i < targets.length; i++) {
        const sat = targets[i];
        try {
          const orbitPoints = window.orbitEngine.computeOrbitTrajectory(sat, date, 36);
          if (!orbitPoints || orbitPoints.length < 2) continue;

          const cartesians = orbitPoints.map(p => 
            Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * 1000)
          );
          if (cartesians.length > 2) {
            cartesians.push(cartesians[0]);
          }

          const style = window.orbitEngine.getKeepTrackColor(sat);
          const baseCesiumColor = Cesium.Color.fromCssColorString(style.hex);
          const color = baseCesiumColor.withAlpha(style.category === 'debris' ? 0.40 : 0.65);
          const depthColor = baseCesiumColor.withAlpha(style.category === 'debris' ? 0.12 : 0.18);

          const entity = this.viewer.entities.add({
            polyline: {
              positions: cartesians,
              width: (sat.orbitClass === 'GEO') ? 1.5 : 1.2,
              material: new Cesium.ColorMaterialProperty(color)
            }
          });

          this.fleetTrajectoryEntities.push(entity);
        } catch (err) {
          // ignore single sat error
        }
      }
    } finally {
      this.viewer.entities.resumeEvents();
    }

    this.showFleetTrajectories = true;
    this.viewer.scene.requestRender();
    return this.fleetTrajectoryEntities.length;
  }

  /**
   * Clear all rendered fleet orbital trajectories
   */
  clearFleetTrajectories() {
    if (this.fleetTrajectoryEntities && this.fleetTrajectoryEntities.length > 0) {
      this.viewer.entities.suspendEvents();
      try {
        for (let i = 0; i < this.fleetTrajectoryEntities.length; i++) {
          this.viewer.entities.remove(this.fleetTrajectoryEntities[i]);
        }
        this.fleetTrajectoryEntities = [];
      } finally {
        this.viewer.entities.resumeEvents();
      }
    }
    this.showFleetTrajectories = false;
    this.viewer.scene.requestRender();
  }

  /**
   * Update moving marker and nadir line for the selected satellite
   * KeepTrack style: crisp yellow dot with glowing white halo and distance-attenuated label
   */
  updateSelectedSatelliteVisuals(satRecord, pos, date) {
    const satCartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
    const groundCartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 0);

    // Selected Target Reticle Marker & 3D Spacecraft Model
    if (!this.selectedMarkerEntity) {
      this.selectedMarkerEntity = this.viewer.entities.add({
        position: satCartesian,
        model: {
          uri: 'models/satellite.glb',
          minimumPixelSize: 130, // Big, prominent, clearly visible 3D satellite
          maximumScale: 150000,
          scale: 1500.0,
          silhouetteColor: Cesium.Color.fromCssColorString('#00f0ff').withAlpha(0.65),
          silhouetteSize: 1.5,
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 25000000) // Clearly visible from orbit up to 25,000 km
        },
        label: {
          text: ` ${satRecord.name} `,
          font: 'bold 22px Inter, Rajdhani, -apple-system, sans-serif',
          scale: 0.55,
          fillColor: Cesium.Color.fromCssColorString('#ffd600'),
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('rgba(7, 10, 19, 0.88)'),
          backgroundPadding: new Cesium.Cartesian2(8, 4),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 1.5,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -42),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1.8e7)
        }
      });
    } else {
      this.selectedMarkerEntity.position = satCartesian;
      if (this.selectedMarkerEntity.label) {
        this.selectedMarkerEntity.label.text = ` ${satRecord.name} `;
      }
      this.selectedMarkerEntity.show = true;
    }

    // Orient 3D satellite model with Earth-pointing and velocity frame
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(satCartesian);
    const rotMat = Cesium.Matrix4.getMatrix3(transform, new Cesium.Matrix3());
    this.selectedMarkerEntity.orientation = Cesium.Quaternion.fromRotationMatrix(rotMat);

    // Nadir Line (from satellite to Earth surface directly below)
    if (!this.nadirLineEntity) {
      this.nadirLineEntity = this.viewer.entities.add({
        polyline: {
          positions: [satCartesian, groundCartesian],
          width: 1,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('#ff9100').withAlpha(0.7),
            dashLength: 8.0
          })
        }
      });
    } else {
      this.nadirLineEntity.polyline.positions = [satCartesian, groundCartesian];
    }

    // If Camera Tracking is locked onto satellite:
    // Update transform without overwriting camera offset, allowing user full zoom in/out freedom!
    if (this.isTrackingSelected && this.followTargetSat && this.followTargetSat.noradId === satRecord.noradId) {
      const transform = Cesium.Transforms.eastNorthUpToFixedFrame(satCartesian);
      if (!this.hasInitializedFollow) {
        const initialRange = Math.max(1200000, pos.alt * 1000 * 3.5);
        this.viewer.camera.lookAtTransform(
          transform,
          new Cesium.HeadingPitchRange(0.0, -Cesium.Math.PI_OVER_FOUR, initialRange)
        );
        this.hasInitializedFollow = true;
      } else {
        // Updating ONLY the transform keeps user's mouse-wheel zoom distance intact!
        this.viewer.camera.lookAtTransform(transform);
      }
    }
  }

  /**
   * Start following a satellite with complete freedom to zoom in/out and rotate
   */
  startFollowing(satRecord, date) {
    if (!satRecord) return;
    this.isTrackingSelected = true;
    this.followTargetSat = satRecord;
    this.hasInitializedFollow = false;
    const pos = window.orbitEngine.computePosition(satRecord, date || new Date());
    const satCartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
    const initialRange = Math.max(1200000, pos.alt * 1000 * 3.5);
    const transform = Cesium.Transforms.eastNorthUpToFixedFrame(satCartesian);
    this.viewer.camera.lookAtTransform(
      transform,
      new Cesium.HeadingPitchRange(0.0, -Cesium.Math.PI_OVER_FOUR, initialRange)
    );
    this.hasInitializedFollow = true;
  }

  /**
   * Stop camera tracking
   */
  stopFollowing() {
    this.isTrackingSelected = false;
    this.followTargetSat = null;
    this.hasInitializedFollow = false;
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  }

  /**
   * Multi-Satellite Follow: Add satellite to multi-tracking list
   */
  addFollowedSatellite(satRecord, date) {
    if (!satRecord || this.followedSatellites.has(satRecord.noradId)) return;
    const dateObj = date || new Date();
    const colorHex = this.followColorPalette[this.followedSatellites.size % this.followColorPalette.length];
    const cesiumColor = Cesium.Color.fromCssColorString(colorHex);

    // 1. 3D Orbital Trajectory - Complete 360-degree closed orbit path
    const orbitPoints = window.orbitEngine.computeOrbitTrajectory(satRecord, dateObj, 96);
    const trajectoryCartesians = orbitPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt * 1000));
    if (trajectoryCartesians.length > 2) {
      trajectoryCartesians.push(trajectoryCartesians[0]);
    }

    const trajectoryEntity = this.viewer.entities.add({
      polyline: {
        positions: trajectoryCartesians,
        width: 2.2,
        material: new Cesium.ColorMaterialProperty(cesiumColor.withAlpha(0.95))
      }
    });

    // 2. Surface Ground Track (only if enabled)
    let groundTrackEntity = null;
    const showGroundTrack = document.getElementById('layerGroundTrack')?.checked ?? false;
    if (showGroundTrack) {
      const groundTrackCartesians = orbitPoints.map(p => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1000.0));
      groundTrackEntity = this.viewer.entities.add({
        polyline: {
          positions: groundTrackCartesians,
          width: 2,
          material: new Cesium.PolylineDashMaterialProperty({
            color: cesiumColor,
            dashLength: 14.0
          })
        }
      });
    }

    // 3. Moving Marker with Tag Label
    const curPos = window.orbitEngine.computePosition(satRecord, dateObj);
    const curCartesian = Cesium.Cartesian3.fromDegrees(curPos.lon, curPos.lat, curPos.alt * 1000);
    const groundCartesian = Cesium.Cartesian3.fromDegrees(curPos.lon, curPos.lat, 0);

    const markerEntity = this.viewer.entities.add({
      position: curCartesian,
      point: {
        pixelSize: 10,
        color: cesiumColor,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },
      label: {
        text: ` ${satRecord.name} `,
        font: 'bold 22px Inter, Rajdhani, sans-serif',
        scale: 0.55,
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(10, 16, 28, 0.88)'),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14)
      }
    });

    // 4. Nadir Ground Line
    const nadirEntity = this.viewer.entities.add({
      polyline: {
        positions: [curCartesian, groundCartesian],
        width: 1,
        material: new Cesium.PolylineDashMaterialProperty({
          color: cesiumColor.withAlpha(0.6),
          dashLength: 8.0
        })
      }
    });

    // 5. Ground Footprint / Coverage Ellipse
    const footprintRadius = window.orbitEngine.computeFootprintRadiusMeters(curPos.alt);
    const footprintEntity = this.viewer.entities.add({
      position: groundCartesian,
      ellipse: {
        semiMajorAxis: footprintRadius,
        semiMinorAxis: footprintRadius,
        material: cesiumColor.withAlpha(0.12),
        outline: true,
        outlineColor: cesiumColor.withAlpha(0.55),
        height: 100.0
      },
      show: this.showFootprints
    });

    this.followedSatellites.set(satRecord.noradId, {
      satRecord,
      color: colorHex,
      cesiumColor,
      trajectoryEntity,
      groundTrackEntity,
      markerEntity,
      nadirEntity,
      footprintEntity,
      lastPos: curPos
    });

    this.applyFleetVisibility();
  }

  /**
   * Multi-Satellite Follow: Remove satellite from multi-tracking list
   */
  removeFollowedSatellite(noradId) {
    const data = this.followedSatellites.get(noradId);
    if (!data) return;
    if (data.trajectoryEntity) this.viewer.entities.remove(data.trajectoryEntity);
    if (data.groundTrackEntity) this.viewer.entities.remove(data.groundTrackEntity);
    if (data.markerEntity) this.viewer.entities.remove(data.markerEntity);
    if (data.nadirEntity) this.viewer.entities.remove(data.nadirEntity);
    if (data.footprintEntity) this.viewer.entities.remove(data.footprintEntity);
    this.followedSatellites.delete(noradId);

    if (this.followTargetSat && this.followTargetSat.noradId === noradId) {
      this.stopFollowing();
    }

    this.applyFleetVisibility();
  }

  /**
   * Clear all followed satellites
   */
  clearFollowedSatellites() {
    const allData = Array.from(this.followedSatellites.values());
    for (let i = 0; i < allData.length; i++) {
      const data = allData[i];
      if (data.trajectoryEntity) this.viewer.entities.remove(data.trajectoryEntity);
      if (data.groundTrackEntity) this.viewer.entities.remove(data.groundTrackEntity);
      if (data.markerEntity) this.viewer.entities.remove(data.markerEntity);
      if (data.nadirEntity) this.viewer.entities.remove(data.nadirEntity);
      if (data.footprintEntity) this.viewer.entities.remove(data.footprintEntity);
    }
    this.followedSatellites.clear();
    this.stopFollowing();
    this.applyFleetVisibility();
  }

  /**
   * Update all followed satellites visuals
   */
  updateFollowedVisuals(date) {
    const dateObj = date || new Date();
    for (const [noradId, data] of this.followedSatellites) {
      const pos = window.orbitEngine.computePosition(data.satRecord, dateObj);
      data.lastPos = pos;
      const curCartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
      const groundCartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, 0);

      if (data.markerEntity) data.markerEntity.position = curCartesian;
      if (data.nadirEntity) data.nadirEntity.polyline.positions = [curCartesian, groundCartesian];
      if (data.footprintEntity) {
        data.footprintEntity.position = groundCartesian;
        const radius = window.orbitEngine.computeFootprintRadiusMeters(pos.alt);
        data.footprintEntity.ellipse.semiMajorAxis = radius;
        data.footprintEntity.ellipse.semiMinorAxis = radius;
        data.footprintEntity.show = this.showFootprints;
      }
    }
  }

  /**
   * Frame all followed satellites together in camera view
   */
  frameAllFollowedSatellites(date) {
    if (this.followedSatellites.size === 0) {
      this.resetView();
      return;
    }
    this.stopFollowing();
    const dateObj = date || new Date();
    const cartesians = [];
    for (const [noradId, data] of this.followedSatellites) {
      const pos = window.orbitEngine.computePosition(data.satRecord, dateObj);
      cartesians.push(Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000));
    }

    if (cartesians.length === 1) {
      const single = Array.from(this.followedSatellites.values())[0].satRecord;
      this.flyToSatellite(single, dateObj);
      return;
    }

    const sphere = Cesium.BoundingSphere.fromPoints(cartesians);
    sphere.radius = Math.max(sphere.radius * 1.5, 6378137 * 1.5);
    this.viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.8,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
    });
  }

  /**
   * Toggle sensor footprint circles
   */
  toggleFootprints(show) {
    this.showFootprints = show;
    for (const [noradId, data] of this.followedSatellites) {
      if (data.footprintEntity) {
        data.footprintEntity.show = show;
      }
    }
  }

  /**
   * Fly camera to target satellite
   */
  flyToSatellite(satRecord, date) {
    if (!satRecord) return;
    const pos = window.orbitEngine.computePosition(satRecord, date || new Date());
    const cartesian = Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, pos.alt * 1000);
    
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(pos.lon, pos.lat, (pos.alt + 3500) * 1000),
      duration: 1.8,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
    });
  }

  /**
   * Fly camera to geographic coordinates or search result
   */
  flyToLocation(lat, lon, height = 800000, label = 'Target Location') {
    // Drop target marker pin
    if (this.searchLocationEntity) {
      this.viewer.entities.remove(this.searchLocationEntity);
    }

    this.searchLocationEntity = this.viewer.entities.add({
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 10,
        color: Cesium.Color.fromCssColorString('#ff3d71'),
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 2
      },
      label: {
        text: ` ${label} `,
        font: 'bold 22px Inter, Rajdhani, sans-serif',
        scale: 0.55,
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('rgba(10, 16, 28, 0.88)'),
        backgroundPadding: new Cesium.Cartesian2(6, 3),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1.5,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -14)
      }
    });

    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, height),
      duration: 2.0,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
    });
  }

  /**
   * Reset Camera to full Earth overview
   */
  resetView() {
    this.isTrackingSelected = false;
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(-30.0, 20.0, 22000000.0),
      duration: 1.5,
      easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
    });
  }

  /**
   * Toggle 2D / 2.5D / 3D Scene Mode
   */
  cycleSceneMode() {
    const scene = this.viewer.scene;
    if (scene.mode === Cesium.SceneMode.SCENE3D) {
      scene.morphToColumbusView(1.5);
    } else if (scene.mode === Cesium.SceneMode.COLUMBUS_VIEW) {
      scene.morphTo2D(1.5);
    } else {
      scene.morphTo3D(1.5);
    }
  }

  /**
   * Toggle Map Layers
   */
  setLayerVisibility(layerName, visible) {
    if (layerName === 'esri' && this.esriLayer) {
      this.esriLayer.show = visible;
    } else if (layerName === 'labels' && this.labelsLayer) {
      this.labelsLayer.show = visible;
    } else if (layerName === 'atmosphere') {
      this.viewer.scene.globe.showGroundAtmosphere = visible;
    } else if (layerName === 'lighting') {
      this.viewer.scene.globe.enableLighting = visible;
    } else if (layerName === 'trajectory' && this.trajectoryEntity) {
      this.trajectoryEntity.show = visible;
    } else if (layerName === 'groundTrack' && this.groundTrackEntity) {
      this.groundTrackEntity.show = visible;
    }
  }
}

