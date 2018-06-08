(function () {
  var ns = $.namespace('pskl.utils.serialization');

  ns.Deserializer = function (data, callback) {
    this.layersToLoad_ = 0;
    this.layersNormalToLoad_ = 0;
    this.data_ = data;
    this.callback_ = callback;
    this.piskel_ = null;
    this.layers_ = [];
  };

  ns.Deserializer.deserialize = function (data, onSuccess, onError) {
    try {
      var deserializer;
      if (data.modelVersion == Constants.MODEL_VERSION) {
        deserializer = new ns.Deserializer(data, onSuccess);
      } else if (data.modelVersion == 1) {
        deserializer = new ns.backward.Deserializer_v1(data, onSuccess);
      } else {
        deserializer = new ns.backward.Deserializer_v0(data, onSuccess);
      }
      deserializer.deserialize();
    } catch (e) {
      console.error(e);
      if (typeof onError === 'function') {
        onError(e);
      }
    }
  };

  ns.Deserializer.prototype.deserialize = function () {
    var data = this.data_;
    var piskelData = data.piskel;
    var name = piskelData.name || 'Deserialized piskel';
    var description = piskelData.description || '';

    var descriptor = new pskl.model.piskel.Descriptor(name, description);
    this.piskel_ = new pskl.model.Piskel(piskelData.width, piskelData.height, piskelData.fps, descriptor);

    this.layersToLoad_ = piskelData.layers.length;
    this.layersNormalToLoad_ = piskelData.layersNormal.length;

    piskelData.layers.forEach(this.deserializeLayerDiffuse.bind(this));
    this.layers_ = [];
    piskelData.layersNormal.forEach(this.deserializeLayerNormal.bind(this));
  };

  ns.Deserializer.prototype.deserializeLayerNormal = function (layerString, index) {
    this.deserializeLayer(layerString, index, true);
  }

  ns.Deserializer.prototype.deserializeLayerDiffuse = function (layerString, index) {
    this.deserializeLayer(layerString, index, false);
  }

  ns.Deserializer.prototype.deserializeLayer = function (layerString, index, isNormal) {
    var layerData = JSON.parse(layerString);
    var layer = new pskl.model.Layer(layerData.name);
    layer.setOpacity(layerData.opacity);

    // Backward compatibility: if the layerData is not chunked but contains a single base64PNG,
    // create a fake chunk, expected to represent all frames side-by-side.
    if (typeof layerData.chunks === 'undefined' && layerData.base64PNG) {
      this.normalizeLayerData_(layerData);
    }

    var chunks = layerData.chunks;

    // Prepare a frames array to store frame objects extracted from the chunks.
    var frames = [];
    Q.all(chunks.map(function (chunk) {
      // Create a promise for each chunk.
      var deferred = Q.defer();
      var image = new Image();
      // Load the chunk image in an Image object.
      image.onload = function () {
        // extract the chunkFrames from the chunk image
        var chunkFrames = pskl.utils.FrameUtils.createFramesFromChunk(image, chunk.layout);
        // add each image to the frames array, at the extracted index
        chunkFrames.forEach(function (chunkFrame) {
          frames[chunkFrame.index] = chunkFrame.frame;
        });
        deferred.resolve();
      };
      image.src = chunk.base64PNG;
      return deferred.promise;
    })).then(function () {
      frames.forEach(layer.addFrame.bind(layer));
      this.layers_[index] = layer;
      if (isNormal) {
        this.addNormalLayers();
      } else {
        this.addLayers();
      }
    }.bind(this)).catch(function (error) {
      console.error('Failed to deserialize layer');
      console.error(error);
    });

    return layer;
  };

  ns.Deserializer.prototype.addLayers = function () {
    this.layersToLoad_ = this.layersToLoad_ - 1;
    if (this.layersToLoad_ === 0) {
      this.layers_.forEach(function (layer) {
        this.piskel_.addLayer(layer);
      }.bind(this));
    }
    if (this.layersNormalToLoad_ === 0 && this.layersToLoad_ === 0) {
        this.callback_(this.piskel_);
    }
  };

  ns.Deserializer.prototype.addNormalLayers = function () {
    this.layersNormalToLoad_ = this.layersNormalToLoad_ - 1;
    if (this.layersNormalToLoad_ === 0) {
      this.layers_.forEach(function (layer, index) {
        this.piskel_.linkLayer(this.piskel_.getLayerAt(index),layer);
      }.bind(this));
    }
    if (this.layersNormalToLoad_ === 0 && this.layersToLoad_ === 0) {
        this.callback_(this.piskel_);
    }
  };

  /**
   * Backward comptibility only. Create a chunk for layerData objects that only contain
   * an single base64PNG without chunk/layout information.
   */
  ns.Deserializer.prototype.normalizeLayerData_ = function (layerData) {
    var layout = [];
    for (var i = 0 ; i < layerData.frameCount ; i++) {
      layout.push([i]);
    }
    layerData.chunks = [{
      base64PNG : layerData.base64PNG,
      layout : layout
    }];
  };
})();
