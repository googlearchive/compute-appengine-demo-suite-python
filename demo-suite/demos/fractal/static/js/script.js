/**
 * Copyright 2012 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @fileoverview Fractal demo JavaScript code.
 *
 * Displays zoomable, panable fractal images, comparing tile load of 1
 * instance to 16.
 */

var fractal1;
var fractal16;

$(document).ready(function() {
  $('.btn').button();
  configSpinner();
  var fractal16 = new Fractal($('#fractal16'), FAST_MAP_INSTANCE_TAG,
  NUM_FAST_MAP_INSTANCES);
  fractal16.initialize();
  fractal1 = new Fractal($('#fractal1'), SLOW_MAP_INSTANCE_TAG,
  NUM_SLOW_MAP_INSTANCES, fractal16);
  fractal1.initialize();

  $('#start').click(function() {
    fractal1.start();
    fractal16.start();
  });
  $('#reset').click(function() {
    fractal1.reset();
    fractal16.reset();
  });
  $('#clearVars').click(function() {
    fractal1.clear_vars();
    fractal16.clear_vars();
  })
  $('#randomPoi').click(gotoRandomPOI)
});

/**
 * Total number of instances to start for the 'slow' map.
 * @type {number}
 * @constant
 */
var NUM_SLOW_MAP_INSTANCES = 1;

/**
 * Name for 'slow' map.
 * @type {string}
 * @constant
 */
var SLOW_MAP_INSTANCE_TAG = 'map1';

/**
 * Total number of instances to start for the 'slow' map.
 * @type {number}
 * @constant
 */
var NUM_FAST_MAP_INSTANCES = 16;

/**
 * Name for 'slow' map.
 * @type {string}
 * @constant
 */
var FAST_MAP_INSTANCE_TAG = 'map16';


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
  });
}

var POINTS_OF_INTEREST = [
  { x: -56.18426015515269, y: 87.95310974121094, z: 13 },
  { x: -55.06490220044015, y: 83.02677154541016, z: 12 },
  { x: -56.20683602602539, y: 87.77841478586197, z: 18 },
  { x: -56.18445122198682, y: 87.96031951904297, z: 18 },
  { x: 4.041501376702832, y: 187.31689453125, z: 12 },
  { x: 39.91121803996906, y: 204.35609936714172, z: 21 },
];

/**
 * Go to a random point of interest on the maps.
 */
function gotoRandomPOI () {
  poi = POINTS_OF_INTEREST[Math.floor(Math.random() * POINTS_OF_INTEREST.length)];
  fractal1.map.setCenter(new google.maps.LatLng(poi.x, poi.y, true));
  fractal1.map.setZoom(poi.z);
}

/**
 * Fractal class.
 * @param {Element} container HTML element in which to display the map.
 * @param {string} tag A unique string ('single') used to identify instances
 * @param {number} num_instances Number of instances to start
 * @param {Fractal} slave_fractal Another fractal instance to sync map
 *  position and zoom to.
 * @constructor
 */
var Fractal = function(container, tag, num_instances, slave_fractal) {
  /**
   * An HTML object that will contain this fractal map.
   * @type {Element}
   * @private
   */
  this.container_ = container;

  /**
   * The element that holds the map itself.
   * @type {Element}
   * @private
   */
  this.mapContainer_ = null;

  /**
   * The squares object that will track the state of the VMs.
   * @type {Squares}
   * @private
   */
  this.squares_ = null;

  /**
   * A unique string to use for naming instances. Also used as a user visible
   *  label on the map.
   * @type {string}
   * @private
   */
  this.tag_ = tag;

  /**
   * The GCE control object.
   * @type {GCE}
   * @private
   */
  this.gce_ = null;

  /**
   * The Map control object
   * @type {Map}
   */
  this.map = null;

  /**
   * The number of instances to launch for this map.
   * @type {[type]}
   * @private
   */
  this.num_instances_ = num_instances;

  /**
   * The other Fractal instance to sync our zoom/position to.
   * @type {Fractal}
   */
  this.slave_fractal_ = slave_fractal;

  /**
   * The list of IPs that are serving.
   * @type {Array}
   */
  this.ips_ = [];

  /**
   * The last data returned from the server.  Useful for async actions that must
   * interact with individual servers directly.
   * @type {Object}
   */
  this.last_data_ = {};
};

/**
 * The map center latitude.
 * @type {number}
 * @private
 */
Fractal.prototype.LATITUDE_ = -78.35;

/**
 * The map center longitude.
 * @type {number}
 * @private
 */
Fractal.prototype.LONGITUDE_ = 157.5;

/**
 * The default tile size
 * @type {Number}
 */
Fractal.prototype.TILE_SIZE_ = 128;

/**
 * The minimum zoom on the map
 * @type {Number}
 */
Fractal.prototype.MIN_ZOOM_ = 0;

/**
 * The maximum zoom of the map.
 * @type {Number}
 */
Fractal.prototype.MAX_ZOOM_ = 30;

/**
 * Initialize the UI and check if there are instances already up.
 */
Fractal.prototype.initialize = function() {
  // Set up the DOM under container_
  var squaresRow = $('<div>').addClass('row-fluid').addClass('squares-row');
  var squaresContainer = $('<div>').addClass('span8').addClass('squares');
  squaresRow.append(squaresContainer);
  $(this.container_).append(squaresRow);

  var mapRow = $('<div>').addClass('row-fluid').addClass('map-row');
  $(this.container_).append(mapRow);

  // Initialize the squares
  var instanceNames = [];
  for (var i = 0; i < this.num_instances_; i++) {
    instanceNames.push(DEMO_NAME + '-' + this.tag_ + '-' + padNumber(i, 2));
  }

  this.squares_ = new Squares(
    squaresContainer.get(0), instanceNames, {
      cols: 8
    });
  this.squares_.drawSquares();

  var statContainer = $('<div>').addClass('span4');
  squaresRow.append(statContainer);
  this.statDisplay_ = new StatDisplay(statContainer, 'Avg Render Time', 'ms',
    function (data) {
      var vars = data['vars'] || {};
      var avg_render_time = vars['tileTimeAvgMs'] || {};
      return avg_render_time[this.TILE_SIZE_];
    }.bind(this));



  // DEMO_NAME is set in the index.html template file.
  this.gce_ = new Gce('/' + DEMO_NAME + '/instance',
    '/' + DEMO_NAME + '/instance',
    '/' + DEMO_NAME + '/cleanup',
  null, {
    'tag': this.tag_
  });
  this.gce_.setOptions({
    squares: this.squares_,
    statDisplay: this.statDisplay_,
  });

  this.gce_.startContinuousHeartbeat(this.heartbeat.bind(this))
}

Fractal.prototype.heartbeat = function(data) {
  this.last_data_ = data;
  this.ips_ = this.getIps_(data);
  if (data['stateCount']['SERVING'] == this.num_instances_) {
    this.mapIt_();
  } else {
    this.stopMap_();
  }
};

Fractal.prototype.clear_vars = function() {
  instances = this.last_data_['instances'] || {};
  for (var instanceName in instances) {
    ip = instances[instanceName]['externalIp'];
    if (ip) {
      $.ajax('http://' + ip + '/debug/vars/reset', {
        type: 'POST',
      });
    }
  }

};

/**
 * Start up the instances if necessary. When the instances are confirmed to be
 *  running then show the map.
 */
Fractal.prototype.start = function() {
  this.startInstances_();
};

/**
 * Reset the map.  Shut down the instances and clear the map.
 */
Fractal.prototype.reset = function() {
  this.gce_.stopInstances();
};

Fractal.prototype.startInstances_ = function() {
  var that = this;
  this.gce_.startInstances(that.num_instances_, {
    data: {
      'num_instances': that.num_instances_
    },
  })
}

/**
 * Try to cleanup/delete any running map
 */
Fractal.prototype.stopMap_ = function() {
  if (this.map) {
    this.map.unbindAll();
    this.map = null
  }
  if (this.mapContainer_) {
    $(this.mapContainer_).remove();
    this.mapContainer_ = null;
  }
}

/**
 * Create maps and add listeners to maps.
 * @private
 */
Fractal.prototype.mapIt_ = function() {
  if (!this.map) {
    this.stopMap_();
    this.map = this.prepMap_();
    this.addListeners_();
  }
};

/**
 * Set map options and draw a map on HTML page.
 * @param {Array.<string>} ips An array of IPs.
 * @return {google.maps.Map} Returns the map object.
 * @private
 */
Fractal.prototype.prepMap_ = function() {
  var that = this;
  var fractalTypeOptions = {
    getTileUrl: function(coord, zoom) {
      var url = ['http://'];
      num_serving = that.ips_.length
      var instanceIdx =
        Math.abs(Math.round(coord.x * Math.sqrt(num_serving) + coord.y))
        % num_serving;
      url.push(that.ips_[instanceIdx]);

      var params = {
        z: zoom,
        x: coord.x,
        y: coord.y,
        'tile-size': that.TILE_SIZE_,
      };
      url.push('/tile?');
      url.push($.param(params));

      return url.join('');
    },
    tileSize: new google.maps.Size(this.TILE_SIZE_, this.TILE_SIZE_),
    maxZoom: this.MAX_ZOOM_,
    minZoom: this.MIN_ZOOM_,
    name: 'Mandelbrot',
  };

  this.mapContainer_ = $('<div>');
  this.mapContainer_.addClass('span12');
  this.mapContainer_.addClass('map-container');
  $(this.container_).find('.map-row').append(this.mapContainer_);
  var map = this.drawMap_(this.mapContainer_,
  fractalTypeOptions, 'Mandelbrot');
  return map;
};

/**
 * Add listeners to maps so that they zoom and pan in unison.
 * @private
 */
Fractal.prototype.addListeners_ = function() {
  // Add listeners to the map on the left so that the zoom and center
  // is reflected on both maps.
  if (this.slave_fractal_) {
    var that = this;
    google.maps.event.addListener(this.map, 'zoom_changed', function() {
      if (that.slave_fractal_.map) {
        var zoom = that.map.getZoom();
        that.slave_fractal_.map.setZoom(zoom);
      }
    });
    google.maps.event.addListener(this.map, 'center_changed', function() {
      if (that.slave_fractal_.map) {
        var center = that.map.getCenter();
        that.slave_fractal_.map.setCenter(center);
      }
    });
  }
};

/**
 * Get the external IPs of the instances from the returned data.
 * @param {Object} data Data returned from the list instances call to GCE.
 * @return {Object} The list of ips.
 * @private
 */
Fractal.prototype.getIps_ = function(data) {
  var ips = [];
  for (var instanceName in data['instances']) {
    ip = data['instances'][instanceName]['externalIp'];
    if (ip) {
      ips.push(ip);
    }
  }
  return ips;
};

/**
 * Draw the map.
 * @param {JQuery} canvas The HTML element in which to display the map.
 * @param {Object} fractalTypeOptions Options for displaying the map.
 * @param {string} mapTypeId A unique map type id.
 * @return {google.maps.Map} Returns the map object.
 * @private
 */
Fractal.prototype.drawMap_ = function(canvas, fractalTypeOptions, mapTypeId) {
  var fractalMapType = new ThrottledImageMap(fractalTypeOptions);

  var mapOptions = {
    center: new google.maps.LatLng(this.LATITUDE_, this.LONGITUDE_),
    zoom: this.MIN_ZOOM_,
    streetViewControl: false,
    mapTypeControlOptions: {
      mapTypeIds: [mapTypeId]
    },
    zoomControlOptions: {
      style: google.maps.ZoomControlStyle.SMALL
    }
  };

  var map = new google.maps.Map(canvas.get(0), mapOptions);
  map.mapTypes.set(mapTypeId, fractalMapType);
  map.setMapTypeId(mapTypeId);
  return map;
};


/**
 * Simply shows a summary stat.
 * @param {Node}   container    The container to render into.
 * @param {string} display_name User visible description
 * @param {string} units        Units of metric.
 * @param {function} stat_name  A function to return the stat value from a JSON data object.
 */
var StatDisplay = function(container, display_name, units, stat_func) {
  this.stat_func = stat_func;

  container = $(container);

  // Render the subtree
  var stat_container = $('<div>').addClass('stat-container');
  container.append(stat_container);

  var stat_name_div = $('<div>').addClass('stat-name').text(display_name);
  stat_container.append(stat_name_div);

  var value_row = $('<div>').addClass('stat-value-row');

  this.value_span = $('<span>').addClass('stat-value').text('--');
  value_row.append(this.value_span);

  var value_units = $('<span>').addClass('stat-units').text(units);
  value_row.append(value_units);

  stat_container.append(value_row);
}

StatDisplay.prototype.update = function(data) {
  value = this.stat_func(data);
  if (value == undefined) {
    value = '--';
  } else {
    value = value.toFixed(1);
  }
  this.value_span.text(value);
};



