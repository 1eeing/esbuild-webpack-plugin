import os from 'os';

import cacache from 'cacache';
import findCacheDir from 'find-cache-dir';
import serialize from 'serialize-javascript';

export default class Webpack4Cache {
  private cacheDir: string

  constructor(compilation: any, options: any) {
    this.cacheDir =
      options.cache === true
        ? Webpack4Cache.getCacheDirectory()
        : options.cache;
  }

  static getCacheDirectory() {
    return findCacheDir({ name: 'esbuild-minimizer-webpack-plugin' }) || os.tmpdir();
  }

  isEnabled() {
    return Boolean(this.cacheDir);
  }

  get(task: any) {
    task.cacheIdent = task.cacheIdent || serialize(task.cacheKeys);

    return cacache
      .get(this.cacheDir, task.cacheIdent)
      .then(({ data }: {data: any}) => JSON.parse(data));
  }

  store(task: any, data: any) {
    return cacache.put(this.cacheDir, task.cacheIdent, JSON.stringify(data));
  }
}
