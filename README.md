# esbuild-minimizer-webpack-plugin

This plugin uses [esbuild](https://github.com/evanw/esbuild) to minify your JavaScript.


## Getting Started
To begin, you'll need to install `esbuild-minimizer-webpack-plugin`

```bash
npm install esbuild-minimizer-webpack-plugin --save-dev
```

Then add the plugin to your webpack config. For example:

**webpack.config.js**
```js
const ESBuildPlugin = require('esbuild-minimizer-webpack-plugin').default;

module.exports = {
  optimization: {
    minimize: true,
    minimizer: [
      new ESBuildPlugin()
    ]
  }
}
```

And run `webpack` via your preferred method.


## Options
### cache
Type: `Boolean|String` Default: `true`

### parallel
Type: `Boolean|Number` Default: `true`
