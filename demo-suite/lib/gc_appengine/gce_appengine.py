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

"""Gce App Engine helper methods to work with Compute Engine."""

__author__ = 'kbrisbin@google.com (Kathryn Hurley)'

import copy
import logging

import lib_path
import gcelib.gce_v1beta13 as gcelib
import oauth2client.appengine as oauth2client
import oauth2client.client as client

import gce_exception as error

from google.appengine.api import users
from google.appengine.ext import deferred

DEFAULT_PROJECT_ID = 'compute-engine-demo'
DEFAULT_IMAGE = 'projects/google/images/gcel-12-04-v20121106'
DEFAULT_MACHINE_TYPE = 'n1-standard-1'
DEFAULT_ZONE = 'us-east1-a'
DEFAULT_NETWORK = 'default'


class GceAppEngineHelper(object):
  """Some helpful methods for starting, listing, and stopping instances.

  Attributes:
    credentials: An oauth2client.client.Credentials object. This is required
        when deleting instances.
    instance_tag: A string tag identifying that is a substring of the instance
        names. This is required for listing and deleting instances for your
        specific demo.
    default_project_id: A string name for the Compute Engine project.
    default_image: A string name for the default image. If None, a random
        image from the google project will be selected when inserting
        instances.
    default_machine_type: A string name for the machine type. If None, a
        random  machine type from the given project will be selected when
        inserting instances.
    default_zone: A string name for the zone. If None, a random zone from the
        given project will be selected when inserting instances.
    default_network: A string name for the network.
  """

  def __init__(self,
               credentials=None,
               instance_tag=None,
               default_project_id=None,
               default_image=None,
               default_machine_type=None,
               default_zone=None,
               default_network=None):
    """Initializes the GceAppEngineHelper class.

    Sets default values for class attributes.

    Args:
      credentials: An oauth2client.client.Credentials object. This is required
          when deleting instances.
      instance_tag: A string tag identifying that is a substring of the instance
          names. This is required for listing and deleting instances for your
          specific demo.
      default_project_id: A string name for the Compute Engine project.
      default_image: A string name for the default image. If None, a random
          image from the google project will be selected when inserting
          instances.
      default_machine_type: A string name for the machine type. If None, a
          random  machine type from the given project will be selected when
          inserting instances.
      default_zone: A string name for the zone. If None, a random zone from the
          given project will be selected when inserting instances.
      default_network: A string name for the network.
    """

    self.credentials = credentials
    self.instance_tag = instance_tag
    self.default_project_id = default_project_id
    self.default_image = default_image
    self.default_machine_type = default_machine_type
    self.default_zone = default_zone
    self.default_network = default_network

    self.__api = None

  def insert_instances(self, instances):
    """Insert instances using an App Engine deferred queue.

    First checks default_image, default_machine_type, and default_zone for
    null values. If null, defaults are assigned according to resources
    available for the project (using the API).

    Args:
      instances: A list of string instance names, json objects representing
          instances, or gcelib.Instances.

    Raises:
      GcelibError: An error occurred when sending API request.
      AccessTokenRefreshError: If the token can not be refreshed.
    """

    if not self.default_image:
      self.default_image = self._get_image()

    if not self.default_machine_type:
      self.default_machine_type = self._get_machine_type()

    if not self.default_zone:
      self.default_zone = self._get_zone()

    api = self.construct_api()

    try:
      api.insert_instances(instances, blocking=False)
    except ValueError, e:
      logging.error(e.message)
      raise error.GcelibError(e.message)
    except client.AccessTokenRefreshError, ae:
      logging.error(ae.message)
      raise

  def list_instances(self, *required_instance_info):
    """Get a list of all instances containing the provided tag name.

    This method uses gcelib to retrieve a list of all instances. For each
    instance in the returned list, the instance name is mapped to the
    requested values. externalIP is a special case, this searches the
    networkInterfaces for the first accessConfig containing natIp value
    and returns this as the externalIp.

    Returns:
      A dictionary mapping instance name to a dictionary of requested values.

    Raises:
      GceError: Raised when required attributes are not present.
      GcelibError: An error occurred when sending API request.
      AccessTokenRefreshError: If the token can not be refreshed.
    """

    if not self.instance_tag:
      raise error.GceError('Instance tag required for listing instances!')

    api = self.construct_api()
    try:
      instances = api.all_instances(
          filter='name eq ^%s.*' % self.instance_tag)
    except ValueError, e:
      logging.error(e.message)
      raise error.GcelibError(e.message)
    except client.AccessTokenRefreshError, ae:
      logging.error(ae.message)
      raise

    instance_info = {}
    for instance in instances:
      instance_info[instance.name] = {}
      for info in required_instance_info:
        if info == 'externalIp':
          ip = None
          for interface in instance.networkInterfaces:
            for config in interface.accessConfigs:
              ip = config.natIP
              break
            if ip: break
          instance_info[instance.name]['externalIp'] = ip
        else:
          instance_info[instance.name][info] = gcelib.Instance.to_json(
              instance)[info]

    return instance_info

  def delete_instances(self):
    """Stop instances using an App Engine deferred queue."""

    deferred.defer(
        deferred_stop, self.credentials, self.default_project_id,
        self.instance_tag)

  def construct_api(self,
                    project_id=None,
                    image=None,
                    machine_type=None,
                    zone=None,
                    network=None):
    """Construct an instance of gcelib.GoogleComputeEngine.

    Args:
      project_id: A string name for the Compute Engine project.
      image: A string name for the image.
      machine_type: A string name for the machine type.
      zone: A string name for the zone.
      network: A string name for the network.

    Returns:
      An instance of gcelib.GoogleComputeEninge.

    Raises:
      GceError: Required parameters are not present.
    """

    if not self.__api:
      if not self.credentials:
        current_user = users.get_current_user()
        if current_user:
          user_id = current_user.user_id()
          self.credentials = oauth2client.StorageByKeyName(
              oauth2client.CredentialsModel, user_id, 'credentials').get()
        else:
          raise error.GceError(
              ('No user object present to retrieve credentials. Credentials '
               'are required in some cases, for ex., when using the deferred '
               'queue to delete instances.'))

      project_id = project_id or self.default_project_id or DEFAULT_PROJECT_ID
      image = image or self.default_image or DEFAULT_IMAGE
      machine_type = (machine_type or self.default_machine_type or
                      DEFAULT_MACHINE_TYPE)
      zone = zone or self.default_zone or DEFAULT_ZONE
      network = network or self.default_network or DEFAULT_NETWORK

      self.__api = gcelib.GoogleComputeEngine(
          self.credentials,
          default_project=project_id,
          default_zone=zone,
          default_image=image,
          default_machine_type=machine_type,
          default_network=network,
          logging_level=logging.WARNING)

    else:
      # Update API defaults if they have changed.
      if self.__api.default_project != self.default_project_id:
        self.__api.default_project = self.default_project_id
      if self.__api.default_image != self.default_image:
        self.__api.default_image = self.default_image
      if self.__api.default_machine_type != self.default_machine_type:
        self.__api.default_machine_type = self.default_machine_type
      if self.__api.default_zone != self.default_zone:
        self.__api.default_zone = self.default_zone
      if self.__api.default_network != self.default_network:
        self.__api.default_network = self.default_network

    return self.__api

  def _get_image(self):
    """Get the last image in the list of available images.

    Returns:
      The string name of the last image.
    """

    api = self.construct_api()
    original_project = api.default_project
    api.default_project = 'google'

    image = None
    try:
      images = api.all_images()
      image = images[-1].name
    except:
      return DEFAULT_IMAGE
    finally:
      api.default_project = original_project

    return image

  def _get_machine_type(self):
    """Get the first machine type in the list of available machine types.

    Returns:
      The string name of the first machine type.
    """

    api = self.construct_api()
    machine_type = None
    try:
      machine_types = api.all_machine_types()
      machine_type = machine_types[0].name
    except:
      return DEFAULT_MACHINE_TYPE

    return machine_type

  def _get_zone(self):
    """Get an available zone that has a status of UP.

    Returns:
      The string name of the zone.
    """

    api = self.construct_api()
    zone = None
    try:
      zones = api.all_zones()
      for gce_zone in zones:
        if gce_zone.status == 'UP':
          zone = gce_zone.name
    except:
      return DEFAULT_ZONE

    if not zone:
      return DEFAULT_ZONE

    return zone


def deferred_stop(credentials, project_id, instance_tag):
  """Stop instances containing the instance tag.

  Args:
    credentials: An oauth2client.client.Credentials object.
    project_id: A string name for the Compute Engine project.
    instance_tag: A string name found in all instance names, used to find
          instances specific to a demo.
  """

  if not instance_tag:
    raise error.GceError('Instance tag required for deleting instances!')

  api = gcelib.GoogleComputeEngine(credentials, default_project=project_id)
  try:
    instances = api.all_instances(filter='name eq ^%s.*' % instance_tag)
  except ValueError, e:
    logging.error('Could not get list of instances')
    logging.error(e.message)

  for instance in instances:
    logging.info('Stopping: ' + instance.name)
    instance.delete(blocking=False)
