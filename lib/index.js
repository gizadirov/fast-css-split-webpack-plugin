'use strict'

const path = require('path')
const split = require('css-split')
const { RawSource } = require('webpack-sources')
const { interpolateName } = require('loader-utils')

/**
 * Detect if a file should be considered for CSS splitting.
 * @param {String} name Name of the file.
 * @returns {Boolean} True if to consider the file, false otherwise.
 */
const isCSS = (name) => /\.css$/.test(name)

/**
 * Remove the trailing `/` from URLs.
 * @param {String} str The url to strip the trailing slash from.
 * @returns {String} The stripped url.
 */
const strip = (str) => str.replace(/\/$/, '')

/**
 * Create a function that generates names based on some input. This uses
 * webpack's name interpolator under the hood, but since webpack's argument
 * list is all funny this exists just to simplify things.
 * @param {String} input Name to be interpolated.
 * @returns {Function} Function to do the interpolating.
 */
const nameInterpolator = (input) => ({ file, content, index }) => {
  const res = interpolateName({
    context: '/',
    resourcePath: `/${file}`
  }, input, {
    content
  }).replace(/\[part\]/g, index + 1)
  return res
}

/**
 * Normalize the `imports` argument to a function.
 * @param {Boolean|String} input The name of the imports file, or a boolean
 * to use the default name.
 * @param {Boolean} preserve True if the default name should not clash.
 * @returns {Function} Name interpolator.
 */
const normalizeImports = (input, preserve) => {
  switch (typeof input) {
    case 'string':
      return nameInterpolator(input)
    case 'boolean':
      if (input) {
        if (preserve) {
          return nameInterpolator('[name]-split.[ext]')
        }
        return ({ file }) => file
      }
      return () => false
    default:
      throw new TypeError()
  }
}

/**
 * Webpack plugin to split CSS assets into multiple files. This is primarily
 * used for dealing with IE <= 9 which cannot handle more than ~4000 rules
 * in a single stylesheet.
 */
class FastCSSSplitWebpackPlugin {
  /**
   * Create new instance of FastCSSSplitWebpackPlugin.
   * @param {Number} size Maximum number of rules for a single file.
   * @param {Boolean|String} imports Truish to generate an additional import
   * asset. When a boolean use the default name for the asset.
   * @param {String} filename Control the generated split file name.
   * @param {Boolean} defer Defer splitting until the `emit` phase. Normally
   * only needed if something else in your pipeline is mangling things at
   * the emit phase too.
   * @param {Boolean} preserve True to keep the original unsplit file.
   */
  constructor ({
    size = 4000,
    imports = false,
    filename = '[name]-[part].[ext]',
    preserve,
    defer = false
  }) {
    this.options = {
      size,
      imports: normalizeImports(imports, preserve),
      filename: nameInterpolator(filename),
      preserve,
      defer
    }
  }

  /**
   * Generate the split chunks for a given CSS file.
   * @param {String} key Name of the file.
   * @param {Object} asset Valid webpack Source object.
   * @returns {Promise} Promise generating array of new files.
   */
  file (key, asset) {
    const input = {
      source: asset.source()
    }
    const dirname = path.dirname(key)
    const getName = (i) => this.options.filename(Object.assign({}, asset, {
      content: input.source,
      file: key,
      index: i
    }))

    const chunks = split(input.source, this.options.size).map((part, i) => {
      const result = new RawSource(part.content)
      result.name = getName(i)
      result.fullname = dirname && dirname !== '.' ? `${dirname}/${result.name}` : result.name
      return result
    })

    return {
      dirname,
      file: key,
      chunks
    }
  }

  chunksMapping (compilation, chunks, done) {
    const assets = compilation.assets
    const publicPath = strip(compilation.options.output.publicPath || './')

    chunks.map((chunk) => {
      const input = chunk.files.filter(isCSS)
      const entries = input.map((name) => this.file(name, assets[name]))

      entries.forEach((entry) => {
        // imports file will be always generated, unless imports == false
        let importsFile
        if (entry.chunks.length === 1) {
          // if no need split, then use the original chunk as imports entry file
          importsFile = entry.chunks[0]
        } else {
          // Inject the new files into the chunk.
          // - {name}-1.css
          // - {name}-2.css
          // - ...
          entry.chunks.forEach((file) => {
            assets[file.fullname] = file
            chunk.files.push(file.fullname)
          })

          // generate imports file content
          const content = entry.chunks.map((file) => {
            // if publicPath is relative path, then use "./{name}"
            if (publicPath.startsWith('.')) {
              return `@import "./${file.name}";`
            } else {
              return `@import "${publicPath}/${file.fullname}";`
            }
          }).join('\n')
          importsFile = new RawSource(content)
        }

        // if chunks.length == 1, the original chunk will be always preserved
        if (entry.chunks.length > 1 && !this.options.preserve) {
          chunk.files.splice(chunk.files.indexOf(entry.file), 1)
          delete assets[entry.file]
        }

        // generate imports entry file if imports != false
        // - {name}-split.css
        let imports = this.options.imports(Object.assign({}, entry, {
          content: importsFile._value
        }))
        if (imports) {
          if (entry.dirname && entry.dirname !== '.') {
            imports = `${entry.dirname}/${imports}`
          }
          assets[imports] = importsFile
          chunk.files.push(imports)
        }
      })
    })

    done()
  }

  /**
   * Run the plugin against a webpack compiler instance. Roughly it walks all
   * the chunks searching for CSS files and when it finds one that needs to be
   * split it does so and replaces the original file in the chunk with the split
   * ones. If the `imports` option is specified the original file is replaced
   * with an empty CSS file importing the split files, otherwise the original
   * file is removed entirely.
   * @param {Object} compiler Compiler instance
   * @returns {void}
   */
  apply (compiler) {
    // for webpack 4
    if (compiler.hooks) {
      const plugin = {
        name: 'FastCssSplitPlugin'
      }

      if (this.options.defer) {
        // Run on `emit` when user specifies the compiler phase
        // Due to the incorrect css split + optimization behavior
        // Expected: css split should happen after optimization
        compiler.hooks.emit.tapAsync(plugin, (compilation, done) => {
          this.chunksMapping(compilation, compilation.chunks, done)
        })
      } else {
        // use compilation instead of this-compilation, just like other plugins do
        compiler.hooks.compilation.tap(plugin, compilation => {
          compilation.hooks.optimizeChunkAssets.tapAsync(plugin, (chunks, done) => {
            this.chunksMapping(compilation, chunks, done)
          })
        })
      }
    } else {
      if (this.options.defer) {
        // Run on `emit` when user specifies the compiler phase
        // Due to the incorrect css split + optimization behavior
        // Expected: css split should happen after optimization
        compiler.plugin('emit', (compilation, done) => {
          return this.chunksMapping(compilation, compilation.chunks, done)
        })
      } else {
        // use compilation instead of this-compilation, just like other plugins do
        compiler.plugin('compilation', (compilation) => {
          compilation.plugin('optimize-chunk-assets', (chunks, done) => {
            return this.chunksMapping(compilation, chunks, done)
          })
        })
      }
    }
  }
}

module.exports = FastCSSSplitWebpackPlugin
