const _webpack = require('webpack')
const ExtractTextPlugin = require('extract-text-webpack-plugin')
const OptimizeCssPlugin = require('optimize-css-assets-webpack-plugin')
const CSSSplitWebpackPlugin = require('../../lib')
const path = require('path')
const MemoryFileSystem = require('memory-fs')
const {expect} = require('chai')

const basic = path.join('.', 'basic', 'index.js')
const less = path.join('.', 'less', 'index.js')

const extract = ExtractTextPlugin.extract.length !== 1
  ? (a, b) => ExtractTextPlugin.extract(a, b)
  : (fallbackLoader, loader) => loader ? ExtractTextPlugin.extract({
    fallbackLoader,
    loader
  }) : ExtractTextPlugin.extract({
    loader: fallbackLoader
  })

const config = (options, entry = basic, extra = {devtool: 'source-map'}) => {
  const plugins = extra.plugins
  delete extra.plugins

  return Object.assign({
    entry: path.join(__dirname, '..', '..', 'example', entry),
    context: path.join(__dirname, '..', '..', 'example'),
    output: {
      path: path.join(__dirname, 'dist'),
      publicPath: '/foo',
      filename: 'bundle.js'
    },
    module: {
      loaders: [{
        test: /\.css$/,
        loader: extract(
          'style-loader',
          'css-loader?sourceMap'
        )
      }, {
        test: /\.less$/,
        loader: extract(
          'css?-url&-autoprefixer&sourceMap!less?sourceMap'
        )
      }]
    },
    plugins: [
      new ExtractTextPlugin('styles.css'),
      new CSSSplitWebpackPlugin(options),
    ].concat((plugins || [])),
  }, extra)
}

const webpack = (options, inst, extra) => {
  const configuration = config(options, inst, extra)
  const compiler = _webpack(configuration)
  compiler.outputFileSystem = new MemoryFileSystem()
  return new Promise((resolve) => {
    compiler.run((err, _stats) => {
      expect(err).to.be.null
      const stats = _stats.toJson()
      const files = {}
      stats.assets.forEach((asset) => {
        files[asset.name] = compiler.outputFileSystem.readFileSync(
          path.join(configuration.output.path, asset.name)
        )
      })
      resolve({stats, files})
    })
  })
}

describe('CSSSplitWebpackPlugin', () => {
  it('should split files when needed', () =>
    webpack({size: 3, imports: true}).then(({stats}) => {
      expect(stats).to.not.be.null
      expect(stats.assetsByChunkName).to.have.property('main')
        .to.contain('styles-2.css')
    })
  )
  it('should ignore files that do not need splitting', () =>
    webpack({size: 10, imports: true}).then(({stats}) => {
      expect(stats).to.not.be.null
      expect(stats.assetsByChunkName).to.have.property('main')
        .to.not.contain('styles-2.css')
    })
  )
  it('should generate an import file when requested', () =>
    webpack({size: 3, imports: true}).then(({stats}) => {
      expect(stats).to.not.be.null
      expect(stats.assetsByChunkName).to.have.property('main')
        .to.contain('styles.css')
    })
  )
  it('should remove the original asset when splitting', () =>
    webpack({size: 3, imports: false}).then(({stats}) => {
      expect(stats).to.not.be.null
      expect(stats.assetsByChunkName).to.have.property('main')
        .to.not.contain('styles.css')
    })
  )
  it('should allow customization of import name', () =>
    webpack({size: 3, imports: 'potato.css'}).then(({stats}) => {
      expect(stats).to.not.be.null
      expect(stats.assetsByChunkName).to.have.property('main')
        .to.contain('potato.css')
    })
  )
  it('should allow preservation of the original unsplit file', () =>
    webpack({size: 3, imports: false, preserve: true}).then(({stats}) => {
      expect(stats).to.not.be.null
      expect(stats.assetsByChunkName).to.have.property('main')
        .to.contain('styles.css')
    })
  )
  it('should give sensible names by default', () => {
    return webpack({size: 3, imports: true, preserve: true}).then(({stats}) => {
      expect(stats).to.not.be.null
      expect(stats.assetsByChunkName).to.have.property('main')
        .to.contain('styles-split.css')
    })
  })
  it('should handle cases when there are no source maps', () =>
    webpack({size: 3}, less, {devtool: null}).then(({files}) => {
      expect(files).to.not.have.property('styles-1.css.map')
    })
  )
  it('should fail with bad imports', () => {
    expect(() =>
      new CSSSplitWebpackPlugin({imports: () => {}})
    ).to.throw(TypeError)
  })
  describe('deferred emit', () => {
    it('should split css files when necessary', () =>
      webpack({size: 3, defer: true}).then(({stats, files}) => {
        expect(stats.assetsByChunkName)
          .to.have.property('main')
          .to.contain('styles-1.css')
          .to.contain('styles-2.css')
        expect(files).to.have.property('styles-1.css')
        expect(files).to.have.property('styles-2.css')
        expect(files).to.have.property('styles.css.map')
      })
    )
    it('should ignore files that do not need splitting', () =>
      webpack({size: 10, defer: true}).then(({stats, files}) => {
        expect(stats.assetsByChunkName)
          .to.have.property('main')
          .to.contain('styles.css')
          .to.not.contain('styles-1.css')
          .to.not.contain('styles-2.css')
        expect(files).to.have.property('styles.css')
        expect(files).to.not.have.property('styles-1.css')
        expect(files).to.not.have.property('styles-2.css')
      })
    )
    it('should handle cases when there are no source maps', () =>
      webpack({
        size: 3,
        defer: true
      }, basic, {
        devtool: null,
        plugins: [
          new OptimizeCssPlugin()
        ]
      }).then(({stats, files}) => {
        expect(files).to.not.have.property('styles-1.css.map')
        expect(stats.assetsByChunkName)
          .to.have.property('main')
          .to.contain('styles-1.css')
      })
    )
  })
})
