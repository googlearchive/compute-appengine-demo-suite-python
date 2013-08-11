/**
 * @fileoverview Quick Start JavaScript.
 *
 * Initializes instances, updates UI display to show running time and number
 * of running instances. Stops running instances.
 */

$(document).ready(function() {
  var quickStart = new QuickStart();
  quickStart.initialize();
});

/**
 * Quick Start class.
 * @constructor
 */
var QuickStart = function() { };

var Recovering = false;

/**
 * Initialize the UI and check if there are instances already up.
 */
QuickStart.prototype.initialize = function() {
  var gce = new Gce('/' + DEMO_NAME + '/instance',
      '/' + DEMO_NAME + '/instance',
      '/' + DEMO_NAME + '/cleanup');
  gce.getInstanceStates(function(data) {
    var numInstances = parseInt($('#num-instances').val(), 10);
    var currentInstances = data['stateCount']['TOTAL'];
    if (currentInstances != 0) {
      // Instance are already running so we're in recovery mode. To draw 
      // grid, maintain counter, and start status polling, we simulate 
      // start click with running current number of instances requested.
      // We also set Recovering flag to true to inhibit sending of start 
      // request to GCE. 
      var startTime = parseInt($('#start-time').val(), 10);
      var currentTime = Math.round(new Date().getTime() / 1000)
      var elapsedTime = currentTime - startTime;

      $('#num-instances').val(currentInstances);
      Recovering = true;
      $('#start').click();
      Recovering = false;
      $('#num-instances').val(numInstances);

      // In recovery mode, resets are ok but don't let user resend start,
      // because duplicate starts can cause confusion and perf problems.
      $('#start').addClass('disabled');
      $('#reset').removeClass('disabled');

      // Alert user we're in recovery mode.
      if (numInstances == 0) {
        alert('Instances stopping, waiting for completion');
      } else {
        alert('Instances starting, waiting for completion');
      }
    }
  });

  this.counter_ = new Counter(document.getElementById('counter'), 'numRunning');
  this.timer_ = new Timer(document.getElementById('timer'));
  this.initializeButtons_(gce);
};

/**
 * Initialize UI controls.
 * @param {Object} gce Instance of Gce class.
 * @private
 */
QuickStart.prototype.initializeButtons_ = function(gce) {
  $('.btn').button();

  var that = this;
  $('#start').click(function() {
    // Get the number of instances entered by the user.
    var numInstances = parseInt($('#num-instances').val(), 10);
    if (numInstances > 1000) {
      alert('Max instances is 1000, starting 1000 instead.');
      numInstances = 1000;
    } else if (numInstances < 0) {
      alert('At least one instance needs to be started, starting 1 instead.');
      numInstances = 1;
    } else if (numInstances === 0) {
      return;
    }

    // Request started, disable start button to avoid user confusion.
    $('#start').addClass('disabled');

    var instanceNames = [];
    for (var i = 0; i < numInstances; i++) {
      instanceNames.push(DEMO_NAME + '-' + i);
    }

    // Initialize the squares, set the Gce options, and start the instances.
    var squares = new Squares(
        document.getElementById('instances'), instanceNames, {
          drawOnStart: true
        });
    that.counter_.targetState = 'RUNNING';
    gce.setOptions({
      squares: squares,
      counter: that.counter_,
      timer: that.timer_
    });
    gce.startInstances(numInstances, {
      data: {'num_instances': numInstances},
      callback: function() {
        $('#reset').removeClass('disabled');
      }
    });
  });

  // Initialize reset button click event to stop instances.
  $('#reset').click(function() {
    that.counter_.targetState = 'TOTAL';
    $('#num-instances').val(0);
    gce.stopInstances(function() {
      $('#start').removeClass('disabled');
      $('#reset').addClass('disabled');
    });
  });
};
