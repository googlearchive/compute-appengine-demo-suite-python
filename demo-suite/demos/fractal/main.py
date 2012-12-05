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
import logging
import os

import lib_path
import gc_appengine.gce_appengine as gce_appengine
import gc_appengine.gce_exception as error
import gcelib.gce_v1beta13 as gcelib
import jinja2
import oauth2client.appengine as oauth2appengine
import webapp2

from google.appengine.api import urlfetch

jinja_environment = jinja2.Environment(loader=jinja2.FileSystemLoader(''))

DEMO_NAME = 'fractal'
IMAGE = 'fractal-demo-image'
FIREWALL = 'www-fractal'
GCE_SCOPE = 'https://www.googleapis.com/auth/compute'
VM_SCOPES = ['https://www.googleapis.com/auth/devstorage.full_control']
STARTUP_SCRIPT = os.path.join(os.path.dirname(__file__), 'startup.sh')


class Fractal(webapp2.RequestHandler):
  """Show main page of Fractal demo."""

  def get(self):
    """Show main page of Fractal demo."""
    template = jinja_environment.get_template(
        'demos/%s/templates/index.html' % DEMO_NAME)
    self.response.out.write(template.render({'tag': DEMO_NAME}))


class Instance(webapp2.RequestHandler):
  """Start and list instances."""

  def post(self):
    """Start instances with the given startup script.

    Uses app engine app identity to retrieve an access token for the app
    engine service account. No client OAuth required.
    """
    num_slow_map_instances = int(self.request.get('num_slow_map_instances'))
    slow_map_instance_tag = self.request.get('slow_map_instance_tag')
    slow_map_instances = self._get_instance_list(
        num_slow_map_instances, slow_map_instance_tag)
    num_fast_map_instances = int(self.request.get('num_fast_map_instances'))
    fast_map_instance_tag = self.request.get('fast_map_instance_tag')
    fast_map_instances = self._get_instance_list(
        num_fast_map_instances, fast_map_instance_tag)
    instances = slow_map_instances + fast_map_instances

    credentials = oauth2appengine.AppAssertionCredentials(scope=GCE_SCOPE)
    helper = gce_appengine.GceAppEngineHelper(credentials=credentials)

    # Get the images for the project and only use the IMAGE if it's present.
    api = helper.construct_api()
    try:
      images = api.all_images()
    except ValueError, e:
      logging.error(e.message)
      return
    image_names = [image.name for image in images]
    if IMAGE in image_names: helper.default_image = IMAGE

    # If the firewall is not present, add it to the default network.
    try:
      firewalls = api.all_firewalls()
    except ValueError, e:
      logging.error(e.message)
      return
    firewall_names = [firewall.name for firewall in firewalls]
    if not FIREWALL in firewall_names:
      firewall = gcelib.Firewall(
          name=FIREWALL,
          targetTags=[DEMO_NAME],
          allowed=[{
              'IPProtocol': 'tcp',
              'ports': '80'
              }],
          sourceRanges=['0.0.0.0/0'],
          description='Fractal Demo Firewall')
      try:
        api.insert_firewall(firewall)
      except ValueError, e:
        logging.error(e.message)
        return

    # Insert the instances.
    helper.insert_instances(instances)

  def _get_instance_list(self, num_instances, tag):
    """Get a list of instances to start.

    Args:
      num_instances: The number of instances to start.
      tag: A string tag to prepend to the instance name.

    Returns:
      A list of gcelib.Instances.
    """
    instances = []
    for i in range(num_instances):
      instance = gcelib.Instance(
          name='%s-%d' % (tag, i),
          tags=[DEMO_NAME],
          metadata={'items': [{
              'key': 'startup-script',
              'value': open(STARTUP_SCRIPT, 'r').read()
          }]},
          serviceAccounts=[{
              'email': 'default',
              'scopes': VM_SCOPES
          }])
      instances.append(instance)
    return instances

  def get(self):
    """List instances.

    Uses app engine app identity to retrieve an access token for the app
    engine service account. No client OAuth required. External IP is used
    to determine if the instance is actually running.
    """
    credentials = oauth2appengine.AppAssertionCredentials(scope=GCE_SCOPE)
    helper = gce_appengine.GceAppEngineHelper(
        credentials=credentials, instance_tag=DEMO_NAME)

    try:
      instances = helper.list_instances('status', 'externalIp')
    except error.GcelibError:
      self.response.set_status(500)
      self.response.headers['Content-Type'] = 'application/json'
      self.response.out.write({'error': 'Error getting instances.'})
      return

    for instance in instances:
      try:
        if instances[instance].get('externalIp'):
          ip = instances[instance].get('externalIp')
          result = urlfetch.fetch(url='http://%s/health' % ip, deadline=2)
          if result.content == 'ok':
            instances[instance]['status'] = 'RUNNING'
          else:
            instances[instance]['status'] = 'STAGING'
      except urlfetch.Error:
        instances[instance]['status'] = 'STAGING'

    json_instances = json.dumps(instances)
    self.response.headers['Content-Type'] = 'application/json'
    self.response.out.write(json_instances)


app = webapp2.WSGIApplication(
    [
        ('/%s' % DEMO_NAME, Fractal),
        ('/%s/instance' % DEMO_NAME, Instance)
    ], debug=True)
