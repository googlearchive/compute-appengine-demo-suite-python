/**
 * Copyright 2013 Google Inc. All Rights Reserved.
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
 * @fileoverview A throttlered image map.
 */

/**
 * A MapType object that throttles image requests
 * @param {Object} opts
 */
var ThrottledImageMap = function(opts) {
  this.alt = opts['alt'];
  this.tileSize = opts['tileSize'];
  this.name = opts['name'];
  this.minZoom = opts['minZoom'];
  this.maxZoom = opts['maxZoom'];
  this.maxDownloading = opts['maxDownloading'] || 5;
  this.getTileUrl = opts['getTileUrl'];

  this.loadingTiles = {};
  this.loadQueue = [];
}

ThrottledImageMap.prototype.getTile = function(tileCoord, zoom, ownerDocument) {
  var tileDiv = ownerDocument.createElement('div');
  var tileUrl = this.getTileUrl(tileCoord, zoom);
  tileDiv.tileUrl = tileUrl;
  tileDiv.style.width = this.tileSize.width + 'px';
  tileDiv.style.height = this.tileSize.height + 'px';

  this.addTileToQueue_(tileDiv);
  this.processQueue_();

  return tileDiv;
};

ThrottledImageMap.prototype.releaseTile = function(tile) {};

ThrottledImageMap.prototype.addTileToQueue_ = function(tileDiv) {
  this.loadQueue.push(tileDiv);
};

ThrottledImageMap.prototype.processQueue_ = function() {
  while (this.loadQueue.length > 0 && Object.keys(this.loadingTiles).length < this.maxDownloading) {
    var tileDiv = this.loadQueue.shift();
    var tileUrl = tileDiv.tileUrl;
    var img = tileDiv.ownerDocument.createElement('img');
    img.style.width = this.tileSize.width + 'px';
    img.style.height = this.tileSize.height + 'px';
    img.onload = this.onImageLoaded_.bind(this, tileUrl);
    img.onerror = this.onImageError_.bind(this, tileUrl);
    console.log('Loading image: ' + tileUrl);
    img.src = tileUrl;
    tileDiv.appendChild(img);
    this.loadingTiles[tileDiv.tileUrl] = tileDiv;
  }
};

ThrottledImageMap.prototype.onImageLoaded_ = function(tileUrl) {
  console.log('Image Loaded: ' + tileUrl);
  delete this.loadingTiles[tileUrl];
  this.processQueue_();
};

ThrottledImageMap.prototype.onImageError_ = function(tileUrl) {
  console.log('Image Error: ' + tileUrl);
  delete this.loadingTiles[tileUrl];
  this.processQueue_();
};
