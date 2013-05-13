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

  // All tiles that we know about. These might be loading, loaded or queued.
  this.tiles = {};

  // All tiles that are current loading.
  this.loadingTiles = {};

  // The loadQueue is an ordered list of tiles to load.  If a tile is no longer
  // needed, it will be removed from this.tiles but not from loadQueue.  So when
  // processing the queue, we must first check to see if the tile is still
  // needed by also checking this.tiles.
  this.loadQueue = [];
}

ThrottledImageMap.prototype.getTile = function(tileCoord, zoom, ownerDocument) {
  var tileUrl = this.getTileUrl(tileCoord, zoom);

  if (tileUrl in this.tiles) {
    console.log('Returning existing tile: ' + tileUrl);
    return this.tiles[tileUrl];
  }

  var tileDiv = ownerDocument.createElement('div');
  tileDiv.tileUrl = tileUrl;
  tileDiv.style.width = this.tileSize.width + 'px';
  tileDiv.style.height = this.tileSize.height + 'px';

  this.tiles[tileUrl] = tileDiv;

  this.addTileToQueue_(tileDiv);
  this.processQueue_();

  return tileDiv;
};

ThrottledImageMap.prototype.releaseTile = function(tileDiv) {
  var tileUrl = tileDiv.tileUrl;
  if (tileUrl in this.tiles) {
    divFromMap = this.tiles[tileUrl];
    if (divFromMap !== tileDiv) {
      console.log('Error: tile release doesn\'t match tile being loaded: '
                  + tileUrl);
      console.log('  releasedTile: ', tileDiv);
      console.log('  tileFromMap: ', divFromMap);
    }
    console.log('Releasing tile: ' + tileUrl)
    delete this.tiles[tileUrl];

    $(divFromMap).empty();
  }
};

ThrottledImageMap.prototype.addTileToQueue_ = function(tileDiv) {
  console.log('Queuing load of tile: ' + tileDiv.tileUrl);
  this.loadQueue.push(tileDiv);
};

ThrottledImageMap.prototype.processQueue_ = function() {
  while (this.loadQueue.length > 0 && Object.keys(this.loadingTiles).length < this.maxDownloading) {
    var tileDiv = this.loadQueue.shift();
    var tileUrl = tileDiv.tileUrl;

    if (!(tileUrl in this.tiles)) {
      // This tile is no longer needed so just forget about it and continue.
      console.log('Ignoring no longer needed: ' + tileUrl);
      continue;
    }

    var img = tileDiv.ownerDocument.createElement('img');
    img.style.width = this.tileSize.width + 'px';
    img.style.height = this.tileSize.height + 'px';
    img.onload = this.onImageLoaded_.bind(this, tileUrl);
    img.onerror = this.onImageError_.bind(this, tileUrl);
    console.log('Loading tile: ' + tileUrl);
    img.src = tileUrl;
    tileDiv.appendChild(img);
    this.loadingTiles[tileDiv.tileUrl] = tileDiv;
  }
};

ThrottledImageMap.prototype.onImageLoaded_ = function(tileUrl) {
  console.log('Tile loaded: ' + tileUrl);
  delete this.loadingTiles[tileUrl];
  this.processQueue_();
};

ThrottledImageMap.prototype.onImageError_ = function(tileUrl) {
  console.log('Tile error: ' + tileUrl);
  delete this.loadingTiles[tileUrl];
  this.processQueue_();
};
