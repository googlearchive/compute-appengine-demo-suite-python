/**
 * @fileoverview Fractal demo JavaScript code.
 *
 * Displays zoomable, panable fractal images, comparing tile load of 1
 * instance to 16.
 */

$(document).ready(function() {
  $('.btn').button();
  var mapsContainer = document.getElementById('maps');
  var fractal = new Fractal(mapsContainer);
  configSpinner();
  fractal.initialize();
});

/**
 * Configure spinner to show when there is an outstanding Ajax request.
 *
 * This really helps to show that something is going on.  It is the 
 * simplest blinking light that we can add.
 */
function configSpinner() {
  $('#spinner')
    .css('visibility', 'hidden')
    .ajaxStart(function() {
        $('#spinner').css('visibility', '');
    })
    .ajaxStop(function() {
        $('#spinner').css('visibility', 'hidden');
    })
  ;
}

/**
 * Fractal class.
 * @param {Element} mapsContainer HTML element in which to display the maps.
 * @constructor
 */
var Fractal = function(mapsContainer) {
  this.mapsContainer_ = mapsContainer;
};

/**
 * HTML element in which to display the maps.
 * @type {Element}
 * @private
 */
Fractal.prototype.mapsContainer_ = null;

/**
 * Total number of instances to start for the 'slow' map. A perfect square
 * value is required.
 * @type {number}
 * @private
 */
Fractal.prototype.NUM_SLOW_MAP_INSTANCES_ = 1;

/**
 * Extra addition to the instance name(s) of the 'slow' map instance(s).
 * @type {string}
 * @private
 */
Fractal.prototype.SLOW_MAP_INSTANCE_TAG_ = '-slow';

/**
 * Total number of instances to start for the 'fast' map. A perfect square
 * value is required.
 * @type {number}
 * @private
 */
Fractal.prototype.NUM_FAST_MAP_INSTANCES_ = 16;

/**
 * Extra addition to the instance name(s) of the 'fast' map instance(s).
 * @type {string}
 * @private
 */
Fractal.prototype.FAST_MAP_INSTANCE_TAG_ = '-fast';

/**
 * The map center latitude.
 * @type {number}
 * @private
 */
Fractal.prototype.LATITUDE_ = 85;

/**
 * The map center longitude.
 * @type {number}
 * @private
 */
Fractal.prototype.LONGITUDE_ = -179.6;

/**
 * Initialize the UI and check if there are instances already up.
 */
Fractal.prototype.initialize = function() {
  // TAG is set in the index.html template file.
  this.gce = new Gce('/' + TAG + '/instance',
      '/' + TAG + '/instance',
      '/' + TAG + '/cleanup');

  var that = this;
  $('#start').click(function() {
    that.gce.checkIfRunning(function(data, numRunning) {
      var total = that.NUM_SLOW_MAP_INSTANCES_ + that.NUM_FAST_MAP_INSTANCES_;
      if (numRunning == total) {
        that.mapIt_(data);
      } else {
        that.startInstances_()
      }
    })
  })
  
  $('#reset').click(function() {
    that.stopMap_()
    that.gce.stopInstances()
  })
}

Fractal.prototype.startInstances_ = function() {
  var total = this.NUM_SLOW_MAP_INSTANCES_ + this.NUM_FAST_MAP_INSTANCES_;
  var that = this
  this.gce.startInstances(total, {
    data: {
      'num_slow_map_instances': that.NUM_SLOW_MAP_INSTANCES_,
      'slow_map_instance_tag': TAG + that.SLOW_MAP_INSTANCE_TAG_,
      'num_fast_map_instances': that.NUM_FAST_MAP_INSTANCES_,
      'fast_map_instance_tag': TAG + that.FAST_MAP_INSTANCE_TAG_
    },
    callback: function(data) {
      that.mapIt_(data);
    }
  })
}

/**
 * Try to cleanup/delete any running map
 */
Fractal.prototype.stopMap_ = function() {
  if (this.slowMap) {
    this.slowMap.unbindAll()
    delete this.slowMap
  }
  if (this.fastMap) {
    this.fastMap.unbindAll()
    delete this.fastMap
  }
  $(this.mapsContainer_).empty()  
}

/**
 * Get external IPs, create maps, add listeners to maps.
 * @param {Object} data Data returned from the list instances call to GCE.
 * @private
 */
Fractal.prototype.mapIt_ = function(data) {
  this.stopMap_();
  var ips = this.getIps_(data);
  this.slowMap = this.prepMap_(
      ips['slow_map_ips'], 30, 9, 256);
  this.fastMap = this.prepMap_(
      ips['fast_map_ips'], 30, 9, 256);
  this.addListeners_(this.slowMap, this.fastMap);
};

/**
 * Set map options and draw a map on HTML page.
 * @param {Array.<string>} ips An array of IPs.
 * @param {maxZoom} maxZoom The maximum zoom of the map.
 * @param {minZoom} minZoom The minimum zoom of the map.
 * @param {tileSize} tileSize The size of the tiles on the map.
 * @return {google.maps.Map} Returns the map object.
 * @private
 */
Fractal.prototype.prepMap_ = function(ips, maxZoom, minZoom, tileSize) {
  var numInstances = ips.length;

  var fractalTypeOptions = {
    getTileUrl: function(coord, zoom) {
      var url = ['http://'];
      if (ips.length > 1) {
        var ip = (coord.x * Math.sqrt(numInstances) + coord.y) % numInstances;
        ip = ip >= 0 ? ip : ip + numInstances - 1;
        url.push(ips[ip]);
      } else {
        url.push(ips[0]);
      }
      url.push('/tile?zoom=');
      url.push(zoom);
      url.push('&x=');
      url.push(coord.x);
      url.push('&y=');
      url.push(coord.y);
      return url.join('');
    },
    tileSize: new google.maps.Size(tileSize, tileSize),
    maxZoom: maxZoom,
    minZoom: minZoom,
    name: 'Fractal' + numInstances
  };

  var mapId = 'map-canvas' + numInstances;
  var mapElement = document.createElement('div');
  mapElement.id = mapId;
  mapElement.className = 'span6';
  $(this.mapsContainer_).append(mapElement);
  var map = this.drawMap_(document.getElementById(mapId),
      fractalTypeOptions, 'fractal' + numInstances);
  return map;
};

/**
 * Add listeners to maps so that they zoom and pan in unison.
 * @param {google.maps.Map} slowMap The slow Google Maps Instance.
 * @param {google.maps.Map} fastMap The fast Google Maps Instance.
 * @private
 */
Fractal.prototype.addListeners_ = function(slowMap, fastMap) {
  // Add listeners to the map on the left so that the zoom and center
  // is reflected on both maps.
  google.maps.event.addListener(slowMap, 'zoom_changed', function() {
    var zoom = slowMap.getZoom();
    fastMap.setZoom(zoom);
  });
  google.maps.event.addListener(slowMap, 'center_changed', function() {
    var center = slowMap.getCenter();
    fastMap.setCenter(center);
  });
};

/**
 * Get the external IPs of the instances from the returned data.
 * @param {Object} data Data returned from the list instances call to GCE.
 * @return {Object} The list of ips for the 'slow' and 'fast' maps.
 * @private
 */
Fractal.prototype.getIps_ = function(data) {
  var fastMapIps = [];
  var slowMapIps = [];
  for (var instanceName in data) {
    // If fast map tag has an index of 0 in the instance name, this is false.
    if (instanceName.search(TAG + this.FAST_MAP_INSTANCE_TAG_)) {
      slowMapIps.push(data[instanceName]['externalIp']);
    } else {
      fastMapIps.push(data[instanceName]['externalIp']);
    }
  }
  return {
    'fast_map_ips': fastMapIps,
    'slow_map_ips': slowMapIps
  };
};

/**
 * Draw the map.
 * @param {Element} canvas The HTML element in which to display the map.
 * @param {Object} fractalTypeOptions Options for displaying the map.
 * @param {string} mapTypeId A unique map type id.
 * @return {google.maps.Map} Returns the map object.
 * @private
 */
Fractal.prototype.drawMap_ = function(canvas, fractalTypeOptions, mapTypeId) {
  var fractalMapType = new google.maps.ImageMapType(fractalTypeOptions);

  var mapOptions = {
    center: new google.maps.LatLng(this.LATITUDE_, this.LONGITUDE_),
    zoom: 9,
    streetViewControl: false,
    mapTypeControlOptions: {
      mapTypeIds: [mapTypeId]
    },
    zoomControlOptions: {
      style: google.maps.ZoomControlStyle.SMALL
    }
  };

  var map = new google.maps.Map(canvas, mapOptions);
  map.mapTypes.set(mapTypeId, fractalMapType);
  map.setMapTypeId(mapTypeId);
  return map;
};
