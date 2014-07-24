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

"""Main page for the Google Compute Engine demo suite."""

from __future__ import with_statement

__author__ = 'kbrisbin@google.com (Kathryn Hurley)'

import lib_path
import logging
import google_cloud.gce as gce
import google_cloud.gce_appengine as gce_appengine
import google_cloud.oauth as oauth
import jinja2
import oauth2client.appengine as oauth2client
import time
import user_data
import webapp2

from google.appengine.ext import ndb
from google.appengine.api import users

DEMO_NAME = 'quick-start'

class Objective(ndb.Model):
  """ This data model keeps track of work in progress. """
  # Disable caching of objective.
  _use_memcache = False
  _use_cache = False

  # Desired number of VMs and start time. This will be >0 for a start
  # request or 0 for a reset/stop request.
  targetVMs = ndb.IntegerProperty()

  # Number of VMs started by last start request. This is handy when
  # recovering during a reset operation, so we can figure out how many 
  # instances to depict in the UI.
  startedVMs = ndb.IntegerProperty()

  # Epoch time when last/current request was stated.
  startTime = ndb.IntegerProperty()

def getObjective(project_id):
  key = ndb.Key("Objective", project_id)
  return key.get()

@ndb.transactional
def updateObjective(project_id, targetVMs):
  objective = getObjective(project_id)
  if not objective: 
    logging.info('objective not found, creating new, project=' + project_id)
    key = ndb.Key("Objective", project_id)
    objective = Objective(key=key)
  objective.targetVMs = targetVMs
  # Overwrite startedVMs only when starting, skip when stopping.
  if targetVMs > 0:
    objective.startedVMs = targetVMs 
  objective.startTime = int(time.time())
  objective.put()

def getUserDemoInfo(user):
  try:
    ldap = user.nickname().split('@')[0]
  except:
    ldap = 'unknown'
    logging.info('User without a nickname')

  gce_id = data_handler.stored_user_data[user_data.GCE_PROJECT_ID]
  demo_id = '%s-%s' % (DEMO_NAME, ldap)
  project_id = '%s-%s' % (gce_id, ldap)

  return dict(demo_id=demo_id, ldap=ldap, project_id=project_id)

jinja_environment = jinja2.Environment(loader=jinja2.FileSystemLoader(''))
oauth_decorator = oauth.decorator
parameters = [
  user_data.DEFAULTS[user_data.GCE_PROJECT_ID],
  user_data.DEFAULTS[user_data.GCE_ZONE_NAME]
]
data_handler = user_data.DataHandler(DEMO_NAME, parameters)


class QuickStart(webapp2.RequestHandler):
  """Show main Quick Start demo page."""

  @oauth_decorator.oauth_required
  @data_handler.data_required
  def get(self):
    """Displays the main page for the Quick Start demo. Auth required."""
    user_info = getUserDemoInfo(users.get_current_user())

    if not oauth_decorator.credentials.refresh_token:
      self.redirect(oauth_decorator.authorize_url() + '&approval_prompt=force')

    targetVMs = 5
    startedVMs = 5
    startTime = 0

    objective = getObjective(user_info['project_id'])
    if objective:
      (targetVMs, startedVMs, startTime) = (objective.targetVMs, 
        objective.startedVMs, objective.startTime)

    variables = {
      'demo_name': DEMO_NAME,
      'demo_id': user_info['demo_id'],
      'targetVMs': targetVMs,
      'startedVMs': startedVMs,
      'startTime': startTime,
    }
    template = jinja_environment.get_template(
        'demos/%s/templates/index.html' % DEMO_NAME)
    self.response.out.write(template.render(variables))


class Instance(webapp2.RequestHandler):
  """List or start instances."""

  @oauth_decorator.oauth_required
  @data_handler.data_required
  def get(self):
    """List instances using the gce_appengine helper class.

    Return the results as JSON mapping instance name to status.
    """
    user_info = getUserDemoInfo(users.get_current_user())

    gce_project_id = data_handler.stored_user_data[user_data.GCE_PROJECT_ID]
    gce_zone_name = data_handler.stored_user_data[user_data.GCE_ZONE_NAME]
    gce_project = gce.GceProject(
        oauth_decorator.credentials, project_id=gce_project_id,
        zone_name=gce_zone_name)
    gce_appengine.GceAppEngine().list_demo_instances(
        self, gce_project, user_info['demo_id'])

  @data_handler.data_required
  def post(self):
    """Start instances using the gce_appengine helper class."""
    user_info = getUserDemoInfo(users.get_current_user())
    
    gce_project_id = data_handler.stored_user_data[user_data.GCE_PROJECT_ID]
    gce_zone_name = data_handler.stored_user_data[user_data.GCE_ZONE_NAME]
    user_id = users.get_current_user().user_id()
    credentials = oauth2client.StorageByKeyName(
        oauth2client.CredentialsModel, user_id, 'credentials').get()
    gce_project = gce.GceProject(credentials, project_id=gce_project_id,
        zone_name=gce_zone_name)

    # Create a user specific route. We will apply this route to all 
    # instances without an IP address so their requests are routed
    # through the first instance acting as a proxy. 
    # gce_project.list_routes()
    proxy_instance = gce.Instance(name='%s-0' % user_info['demo_id'],
                                  zone_name=gce_zone_name)
    proxy_instance.gce_project = gce_project
    route_name = '%s-0' % user_info['demo_id']
    gce_route = gce.Route(name=route_name,
                          network_name='default',
                          destination_range='0.0.0.0/0',
                          next_hop_instance=proxy_instance,
                          priority=200,
                          tags=['qs-%s' % user_info['ldap']])
    response = gce_appengine.GceAppEngine().run_gce_request(
        self,
        gce_project.insert,
        'Error inserting route: ',
        resource=gce_route)

    # Define a network interfaces list here that requests an ephemeral
    # external IP address. We will apply this configuration to the first
    # VM started by quick start. All other VMs will take the default
    # network configuration, which requests no external IP address.
    network = gce.Network('default')
    network.gce_project = gce_project
    ext_net = [{ 'network': network.url,
                 'accessConfigs': [{ 'name': 'External IP access config',
                                     'type': 'ONE_TO_ONE_NAT'
                                   }] 
               }]
    num_instances = int(self.request.get('num_instances'))
    instances = [ gce.Instance('%s-%d' % (user_info['demo_id'], i), 
                               zone_name=gce_zone_name,
                               network_interfaces=(ext_net if i == 0 else None),
                               metadata=([{
                                    'key': 'startup-script', 
                                    'value': user_data.STARTUP_SCRIPT % 'false'
                                 }] if i==0 else [{
                                    'key': 'startup-script',
                                    'value': user_data.STARTUP_SCRIPT % 'true'
                                 }]),
                               service_accounts=[{'email': 'default', 
                                 'scopes': ['https://www.googleapis.com/auth/compute']}],
                               disk_mounts=[gce.DiskMount(
                                 init_disk_name='%s-%d' % (user_info['demo_id'], i), boot=True)],
                               can_ip_forward=(True if i == 0 else False),
                               tags=(['qs-proxy'] if i == 0 else ['qs-%s' % user_info['ldap']]))
                    for i in range(num_instances) ]
    response = gce_appengine.GceAppEngine().run_gce_request(
        self,
        gce_project.bulk_insert,
        'Error inserting instances: ',
        resources=instances)

    # Record objective in datastore so we can recover work in progress.
    updateObjective(user_info['project_id'], num_instances)

    if response:
      self.response.headers['Content-Type'] = 'text/plain'
      self.response.out.write('starting cluster')


class Cleanup(webapp2.RequestHandler):
  """Stop instances."""

  @data_handler.data_required
  def post(self):
    """Stop instances using the gce_appengine helper class."""
    user_info = getUserDemoInfo(users.get_current_user())
    gce_project_id = data_handler.stored_user_data[user_data.GCE_PROJECT_ID]
    gce_zone_name = data_handler.stored_user_data[user_data.GCE_ZONE_NAME]
    user_id = users.get_current_user().user_id()
    credentials = oauth2client.StorageByKeyName(
        oauth2client.CredentialsModel, user_id, 'credentials').get()
    gce_project = gce.GceProject(credentials, project_id=gce_project_id,
        zone_name=gce_zone_name)
    gce_appengine.GceAppEngine().delete_demo_instances(
        self, gce_project, user_info['demo_id'])

    # Record reset objective in datastore so we can recover work in progress.
    updateObjective(user_info['project_id'], 0)

    gce_appengine.GceAppEngine().delete_demo_route(
        self, gce_project, '%s-0' % user_info['demo_id'])

app = webapp2.WSGIApplication(
    [
        ('/%s' % DEMO_NAME, QuickStart),
        ('/%s/instance' % DEMO_NAME, Instance),
        ('/%s/cleanup' % DEMO_NAME, Cleanup),
        (data_handler.url_path, data_handler.data_handler),
    ],
    debug=True)
