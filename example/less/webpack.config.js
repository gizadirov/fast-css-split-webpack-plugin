var ExtractTextPlugin = require('extract-text-webpack-plugin')
var FastCSSSplitWebpackPlugin = require('../../')

module.exports = {
  entry: './index.js',
  context: __dirname,
  output: {
    path: __dirname + '/dist',
    publicPath: '/foo',
    filename: 'bundle.js'
  },
  module: {
    loaders: [{
      test: /\.less$/,
      loader: ExtractTextPlugin.extract(
        'css?-url&-autoprefixer&sourceMap!less?sourceMap'
      )
    }]
  },
  devtool: 'source-map',
  plugins: [
    new ExtractTextPlugin('styles.css'),
    new FastCSSSplitWebpackPlugin({size: 3})
  ]
}
