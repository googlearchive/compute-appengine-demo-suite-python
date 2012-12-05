/**
 * @fileoverview GCE JavaScript functions.
 *
 * Start, stop, or cleanup instances. Set UI controls.
 *
 */

/**
 * Gce class starts, stops instances and controls UI.
 * @constructor
 * @param {string} startInstanceUrl The URL to start instances.
 * @param {string} listInstanceUrl The URL to list instances.
 * @param {string} stopInstanceUrl The URL to stop instances.
 * @param {Object} gceUiOptions UI options for GCE.
 */
var Gce = function(startInstanceUrl, listInstanceUrl, stopInstanceUrl,
    gceUiOptions) {
  this.startInstanceUrl_ = startInstanceUrl;
  this.listInstanceUrl_ = listInstanceUrl;
  this.stopInstanceUrl_ = stopInstanceUrl;
  this.setOptions(gceUiOptions);
};

/**
 * The URL to start instances.
 * @type {string}
 * @private
 */
Gce.prototype.startInstanceUrl_ = null;

/**
 * The URL to list instances.
 * @type {string}
 * @private
 */
Gce.prototype.listInstanceUrl_ = null;

/**
 * The URL to stop instances.
 * @type {string}
 * @private
 */
Gce.prototype.stopInstanceUrl_ = null;

/**
 * The heartbeat timeout time in milliseconds.
 * @const
 * @type {number}
 * @private
 */
Gce.prototype.HEARTBEAT_TIMEOUT_TIME_ = 2000;

/**
 * Sets the GCE UI options. Options include colored squares to indicate
 * status, timer, and counter.
 * @param {Object} gceUiOptions UI options for demos.
 */
Gce.prototype.setOptions = function(gceUiOptions) {
  this.gceUiOptions = gceUiOptions;
};

/**
 * Send the Ajax request to start instances. Init UI controls with start method.
 * @param {number} numInstances The number of instances to start.
 * @param {Object} startOptions Consists of startOptions.data and
 *     startOptions.callback.
 */
Gce.prototype.startInstances = function(numInstances, startOptions) {
  for (var gceUi in this.gceUiOptions) {
    if (this.gceUiOptions[gceUi].start) {
      this.gceUiOptions[gceUi].start();
    }
  }

  if (startOptions.data) {
    $.ajax({
      type: 'POST',
      url: this.startInstanceUrl_,
      data: startOptions.data,
      dataType: 'json'
    });
  } else {
    $.ajax({
      type: 'POST',
      url: this.startInstanceUrl_,
      dataType: 'json'
    });
  }
  if (this.gceUiOptions || startOptions.callback) {
    this.heartbeat_(numInstances, startOptions.callback);
  }
};

/**
 * Send the Ajax request to stop instances.
 * @param {function} callback A callback function to call when instances
 *     have stopped.
 */
Gce.prototype.stopInstances = function(callback) {
  $.ajax({
    type: 'POST',
    url: this.stopInstanceUrl_
  });
  if (this.gceUiOptions || callback) {
    this.heartbeat_(0, callback);
  }
};

/**
 * Check for running instances.
 * @param {function} callback A function to call when AJAX request completes.
 * @param {Object} optionalData Optional data to send with the request.
 * @param {function} optionalError An optional function to call if there is an
 *     error in the AJAX request.
 */
Gce.prototype.checkIfRunning = function(callback, optionalData, optionalError) {
  var that = this;
  var results = function(data) {
    var numRunning = that.numRunning_(data);
    callback(data, numRunning);
  };
  this.getStatuses_(results, optionalData, optionalError);
};

/**
 * Check for instances that are in any state.
 * @param {function} callback A function to call when AJAX request completes.
 * @param {Object} optionalData Optional data to send with the request.
 * @param {function} optionalError An optional function to call if there is an
 *     error in the AJAX request.
 */
Gce.prototype.checkIfAlive = function(callback, optionalData, optionalError) {
  var that = this;
  var results = function(data) {
    var numAlive = that.numAlive_(data);
    callback(data, numAlive);
  };
  this.getStatuses_(results, optionalData, optionalError);
};

/**
 * Send the Ajax request to start instances. Update UI controls with an update
 * method.
 * @param {number} numInstances The number of instances that are starting.
 * @param {function} callback A callback function to call when instances
 *     have started or stopped.
 * @private
 */
Gce.prototype.heartbeat_ = function(numInstances, callback) {
  var that = this;
  var success = function(data) {
    var numRunning = null;

    // If doing a shutdown (numInstances == 0), check the
    // number alive rather than the number running. We want
    // them all completely shutdown.
    if (numInstances) {
      numRunning = that.numRunning_(data);
    } else {
      numRunning = that.numAlive_(data);
    }

    for (var gceUi in that.gceUiOptions) {
      if (that.gceUiOptions[gceUi].update) {
        that.gceUiOptions[gceUi].update({
          'numRunning': numRunning,
          'data': data
        });
      }
    }

    if (numRunning == numInstances) {
      for (var gceUi in that.gceUiOptions) {
        if (that.gceUiOptions[gceUi].stop) {
          that.gceUiOptions[gceUi].stop();
        }
      }

      if (callback) {
        callback(data);
      }
    } else {
      setTimeout(function() {
        that.getStatuses_(success);
      }, that.HEARTBEAT_TIMEOUT_TIME_);
    }
  };

  var that = this;
  setTimeout(function() {
    that.getStatuses_(success);
  }, this.HEARTBEAT_TIMEOUT_TIME_);
};

/**
 * Send Ajax request to get instance information.
 * @param {function} success Function to call if request is successful.
 * @param {Object} optionalData Optional data to send with the request. The data
 *     is added as URL parameters.
 * @param {function} error Function to call if request is not successful.
 * @private
 */
Gce.prototype.getStatuses_ = function(success, optionalData, optionalError) {
  if (!optionalError) {
    optionalError = function(jqXHR, textStatus, errorThrown) {
      alert('Access token expired. Refresh the page to authorize.');
    };
  }

  if (optionalData) {
    $.ajax({
      type: 'GET',
      url: this.listInstanceUrl_,
      dataType: 'json',
      data: optionalData,
      success: success,
      error: optionalError
    });
  } else {
    $.ajax({
      type: 'GET',
      url: this.listInstanceUrl_,
      dataType: 'json',
      success: success,
      error: optionalError
    });
  }
};

/**
 * Count the number of running instances.
 * @param {Object} data Data returned from GCE API formatted in a dictionary
 *     mapping instance name to a dictionary with a status parameter.
 * @private
 * @return {number} The number of running instances.
 */
Gce.prototype.numRunning_ = function(data) {
  var numRunning = 0;
  for (var instance in data) {
    if (data[instance]['status'] == 'RUNNING') {
      numRunning++;
    }
  }
  return numRunning;
};

/**
 * Count the number of instances with any status.
 * @param {Object} data Data returned from GCE API formatted in a dictionary
 *     mapping instance name to a dictionary of instance information.
 * @private
 * @return {number} The number of instances that are up.
 */
Gce.prototype.numAlive_ = function(data) {
  var numAlive = 0;
  for (var instance in data) {
    numAlive++;
  }
  return numAlive;
};
