#!/bin/bash
IMAGE_VERSION=1
IMAGE_MARK=/var/fractal.image.$IMAGE_VERSION
if [ ! -e $IMAGE_MARK ];
then
  apt-get update
  apt-get install -y default-jre python-cherrypy3
  touch $IMAGE_MARK
fi
gsutil cp gs://gce-fractal-demo/input/mandelbrot.jar .
gsutil cp gs://gce-fractal-demo/input/image_handler.py .
python image_handler.py &
