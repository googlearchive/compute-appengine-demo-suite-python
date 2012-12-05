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

"""Simple image server to run on instances."""

import subprocess

import cherrypy

PORT = 80


class Fractals(object):
  """Handles requests to server."""

  @cherrypy.expose
  def health(self):
    """Health check of the server responds OK to HTTP requests.

    Returns:
      The simple response string 'ok'.
    """
    response = cherrypy.response
    response.headers['Content-Type'] = 'text/plain'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return 'ok'

  @cherrypy.expose
  def tile(self, zoom=None, x=None, y=None):
    """Handle requests for tile images.

    URL format: http://<ip>/?zoom=<zoom>&x=<x>&y=<y>

    Args:
      zoom: The string value of the map zoom level.
      x: The string value of the x map tile coordinate.
      y: The string value of the y map tile coordinate.

    Returns:
      The string contents of the tile image created by the mandelbrot jar.
    """
    response = cherrypy.response
    subprocess.call(['java', '-jar', 'mandelbrot.jar', zoom, x, y],
                    shell=False)
    file_name = 'image-%s-%s-%s.png' % (zoom, x, y)
    image_file = open(file_name, 'rb')
    file_contents = image_file.read()
    image_file.close()
    response.headers['Content-Type'] = 'image/png'
    response.headers['Access-Control-Allow-Origin'] = '*'
    return file_contents


if __name__ == '__main__':
  cherrypy.server.socket_port = 80
  cherrypy.server.socket_host = '0.0.0.0'
  cherrypy.quickstart(Fractals())
