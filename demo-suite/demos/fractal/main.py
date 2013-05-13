# Copyright 2012 Google Inc. All Rights Reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Fractal demo."""

from __future__ import with_statement

__author__ = 'kbrisbin@google.com (Kathryn Hurley)'

import json
import os
import logging

import lib_path
import google_cloud.gce as gce
import google_cloud.gce_appengine as gce_appengine
import google_cloud.oauth as oauth
import jinja2
import oauth2client.appengine as oauth2client
import user_data
import webapp2

from google.appengine.api import urlfetch

DEMO_NAME = 'fractal'
CUSTOM_IMAGE = 'fractal-demo-image'
MACHINE_TYPE='n1-highcpu-2'
FIREWALL = 'www-fractal'
FIREWALL_DESCRIPTION = 'Fractal Demo Firewall'
GCE_SCOPE = 'https://www.googleapis.com/auth/compute'
HEALTH_CHECK_TIMEOUT = 2

VM_FILES = os.path.join(os.path.dirname(__file__), 'vm_files')
STARTUP_SCRIPT = os.path.join(VM_FILES, 'startup.sh')
GO_PROGRAM = os.path.join(VM_FILES, 'mandelbrot.go')
GO_ARGS = '--portBase=80 --numPorts=1'
GO_TILESERVER_FLAG = '--tileServers='

# TODO: Update these values with your project and LB IP/destinations.
LB_PROJECT = 'your-project'
LB_SERVERS = ['a.b.c.d']

jinja_environment = jinja2.Environment(loader=jinja2.FileSystemLoader(''))
oauth_decorator = oauth.decorator
parameters = [
    user_data.DEFAULTS[user_data.GCE_PROJECT_ID],
    user_data.DEFAULTS[user_data.GCE_ZONE_NAME]
]
data_handler = user_data.DataHandler(DEMO_NAME, parameters)


class RequestHandler(webapp2.RequestHandler):
  """Common request handler for the Fractal Demo."""
  def InstancePrefix(self):
    """Return a prefix based on a request/query params."""
    tag = self.request.get('tag')
    prefix = DEMO_NAME
    if tag:
      prefix = prefix + '-' + tag
    return prefix


class Fractal(webapp2.RequestHandler):
  """Show main page of Fractal demo."""

  @oauth_decorator.oauth_required
  @data_handler.data_required
  def get(self):
    """Show main page of Fractal demo."""

    template = jinja_environment.get_template(
        'demos/%s/templates/index.html' % DEMO_NAME)
    self.response.out.write(template.render({'demo_name': DEMO_NAME}))

class ServerVarsAggregator(object):
  """Aggregate stats across multiple servers and produce a summary."""

  def __init__(self):
    """Constructor for ServerVarsAggregator."""
    # A map of tile-size -> count
    self.tile_counts = {}
    # A map of tile-size -> time
    self.tile_times = {}

    # The uptime of the server that has been up and running the longest.
    self.max_uptime = 0

  def aggregate_vars(self, instance_vars):
    """Integrate instance_vars into the running aggregates.

    Args:
      instance_vars A parsed JSON object returned from /debug/vars
    """
    self._aggregate_map(instance_vars['tileCount'], self.tile_counts)
    self._aggregate_map(instance_vars['tileTime'], self.tile_times)
    self.max_uptime = max(self.max_uptime, instance_vars['uptime'])

  def _aggregate_map(self, src_map, dest_map):
    """Aggregate one map from src_map into dest_map."""
    for k, v in src_map.items():
      dest_map[k] = dest_map.get(k, 0L) + long(v)

  def get_aggregate(self):
    """Get the overall aggregate, including derived values."""
    tile_time_avg = {}
    result = {
      'tileCount': self.tile_counts.copy(),
      'tileTime': self.tile_times.copy(),
      'tileTimeAvgMs': tile_time_avg,
      'maxUptime': self.max_uptime,
    }
    for size, count in self.tile_counts.items():
      time = self.tile_times.get(size, 0)
      if time:
        # Compute average tile time in milliseconds.  The raw time is in
        # nanoseconds.
        tile_time_avg[size] = float(time / count) / float(1000*1000)
        logging.debug('tile-size: %s count: %d time: %d avg: %d', size, count, time, tile_time_avg[size])
    return result


class Instance(RequestHandler):
  """Start and list instances."""

  @oauth_decorator.oauth_required
  @data_handler.data_required
  def get(self):
    """List instances.

    Uses app engine app identity to retrieve an access token for the app
    engine service account. No client OAuth required. External IP is used
    to determine if the instance is actually running.
    """

    gce_project = self._create_gce()
    instances = gce_appengine.GceAppEngine().run_gce_request(
        self,
        gce_project.list_instances,
        'Error listing instances: ',
        filter='name eq ^%s-.*' % self.InstancePrefix())

    # A map of instanceName -> RPC
    health_rpcs = {}

    # Convert instance info to dict and check server status.
    num_running = 0
    instance_dict = {}
    if instances:
      for instance in instances:
        instance_record = {}
        instance_dict[instance.name] = instance_record
        if instance.status:
          instance_record['status'] = instance.status
        else:
          instance_record['status'] = 'OTHER'
        ip = None
        for interface in instance.network_interfaces:
          for config in interface.get('accessConfigs', []):
            if 'natIP' in config:
              ip = config['natIP']
              instance_record['externalIp'] = ip
              break
          if ip: break

        # Ping the instance server. Grab stats from /debug/vars.
        if ip and instance.status == 'RUNNING':
          num_running += 1
          health_url = 'http://%s/debug/vars' % ip
          logging.debug('Health checking %s', health_url)
          rpc = urlfetch.create_rpc(deadline = HEALTH_CHECK_TIMEOUT)
          urlfetch.make_fetch_call(rpc, url=health_url)
          health_rpcs[instance.name] = rpc

    # Ping through a LBs too.  Only if we get success there do we know we are
    # really serving.
    loadbalancers = []
    lb_rpc = None
    if instances and len(instances) > 1:
      loadbalancers = self._get_lb_servers(gce_project)
    if num_running > 0 and loadbalancers:
      # Only health check the first LB for now.
      lb = loadbalancers[0]
      health_url = 'http://%s/health' % lb
      logging.debug('Health checking %s', health_url)
      rpc = urlfetch.create_rpc(deadline = HEALTH_CHECK_TIMEOUT)
      urlfetch.make_fetch_call(rpc, url=health_url)
      lb_rpc = rpc

    # wait for RPCs to complete and update dict as necessary
    vars_aggregator = ServerVarsAggregator()

    for (instance_name, rpc) in health_rpcs.items():
      result = None
      instance_record = instance_dict[instance_name]
      try:
        result = rpc.get_result()
        if result and "memstats" in result.content:
          logging.debug('%s healthy!', ip)
          instance_record['status'] = 'SERVING'
          instance_vars = {}
          try:
            instance_vars = json.loads(result.content)
            instance_record['vars'] = instance_vars
            vars_aggregator.aggregate_vars(instance_vars)
          except ValueError as error:
            logging.error('Error decoding vars json for %s: %s', ip, error)
        else:
          logging.debug('%s unhealthy.  Content: %s', ip, result.content)
      except urlfetch.Error:
        logging.debug('%s unhealthy', ip)

    loadbalancer_healthy = False
    if lb_rpc:
      result = None
      try:
        result = rpc.get_result()
        if result and "ok" in result.content:
          loadbalancer_healthy = True
      except urlfetch.Error:
        pass

    response_dict = {
      'instances': instance_dict,
      'vars': vars_aggregator.get_aggregate(),
      'loadbalancers': loadbalancers,
      'loadbalancer_healthy': loadbalancer_healthy,
    }
    self.response.headers['Content-Type'] = 'application/json'
    self.response.out.write(json.dumps(response_dict))

  @oauth_decorator.oauth_required
  @data_handler.data_required
  def post(self):
    """Start instances with the given startup script.

    Uses app engine app identity to retrieve an access token for the app
    engine service account. No client OAuth required.
    """

    gce_project = self._create_gce()

    # Create the firewall if it doesn't exist.
    firewalls = gce_project.list_firewalls()
    firewall_names = [firewall.name for firewall in firewalls]
    if not FIREWALL in firewall_names:
      firewall = gce.Firewall(
          name=FIREWALL,
          target_tags=[DEMO_NAME],
          description=FIREWALL_DESCRIPTION)
      gce_project.insert(firewall)

    image = self._get_image(gce_project)

    # Get the list of instances to insert.
    num_instances = int(self.request.get('num_instances'))
    instances = self._get_instance_list(
        gce_project, num_instances, image)

    gce_appengine.GceAppEngine().run_gce_request(
        self,
        gce_project.bulk_insert,
        'Error inserting instances: ',
        resources=instances)

  @oauth_decorator.oauth_required
  @data_handler.data_required
  def cleanup(self):
    """Stop instances using the gce_appengine helper class."""
    gce_project = self._create_gce()
    gce_appengine.GceAppEngine().delete_demo_instances(
        self, gce_project, self.InstancePrefix())

  def _get_lb_servers(self, gce_project):
    if gce_project.project_id == LB_PROJECT:
      return LB_SERVERS
    return []

  def _create_gce(self):
    gce_project_id = data_handler.stored_user_data[user_data.GCE_PROJECT_ID]
    gce_zone_name = data_handler.stored_user_data[user_data.GCE_ZONE_NAME]
    return gce.GceProject(oauth_decorator.credentials,
                          project_id=gce_project_id,
                          zone_name=gce_zone_name)

  def _get_image(self, gce_project):
    """Returns the appropriate image to use.  def _has_custom_image(self, gce_project):

    Args:
      gce_project: An instance of gce.GceProject

    Returns: (project, image_name) for the image to use.
    """
    images = gce_project.list_images(filter='name eq ^%s$' % CUSTOM_IMAGE)
    if images:
      return (gce_project.project_id, CUSTOM_IMAGE)
    return ('google', None)

  def _get_instance_metadata(self, gce_project, instance_names):
    """The metadata values to pass into the instance."""
    inline_values = {
      'goargs': GO_ARGS,
    }

    file_values = {
      'startup-script': STARTUP_SCRIPT,
      'goprog': GO_PROGRAM,
    }

    # Try and use LBs if we have any.  But only do that if we have more than one
    # instance.
    if instance_names and len(instance_names) > 1:
      tile_servers = self._get_lb_servers(gce_project)
      if not tile_servers:
        tile_servers = instance_names
      tile_servers = ','.join(tile_servers)
      inline_values['goargs'] += ' %s%s' %(GO_TILESERVER_FLAG, tile_servers)

    metadata = []
    for k, v in inline_values.items():
      metadata.append({'key': k, 'value': v})

    for k, fv in file_values.items():
      v = open(fv, 'r').read()
      metadata.append({'key': k, 'value': v})
    return metadata

  def _get_instance_list(self, gce_project, num_instances, image):
    """Get a list of instances to start.

    Args:
      gce_project: An instance of gce.GceProject.
      num_instances: The number of instances to start.
      image: tuple with (project_name, image_name) for the image to use.

    Returns:
      A list of gce.Instances.
    """

    image_project_id, image_name = image

    instance_names = []
    for i in range(num_instances):
      instance_names.append('%s-%02d' % (self.InstancePrefix(), i))

    instance_list = []
    for instance_name in instance_names:
      instance = gce.Instance(
          name=instance_name,
          machine_type_name=MACHINE_TYPE,
          image_name=image_name,
          image_project_id=image_project_id,
          tags=[DEMO_NAME, '%s-%d' % (DEMO_NAME, num_instances)],
          metadata=self._get_instance_metadata(gce_project, instance_names),
          service_accounts=gce_project.settings['cloud_service_account'])
      instance_list.append(instance)
    return instance_list


app = webapp2.WSGIApplication(
    [
        ('/%s' % DEMO_NAME, Fractal),
        ('/%s/instance' % DEMO_NAME, Instance),
        webapp2.Route('/%s/cleanup' % DEMO_NAME,
          handler=Instance, handler_method='cleanup',
          methods=['POST']),
        (data_handler.url_path, data_handler.data_handler),
    ], debug=True)
